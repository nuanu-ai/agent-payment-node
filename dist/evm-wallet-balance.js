import { networkPolicyBinding, x402Network } from "./x402-network.js";
import { ApnError } from "./errors.js";
import { EVM_NETWORKS, evmUint, publicEvmAsset } from "./evm-asset.js";
import { directEvmChain } from "./evm-direct-networks.js";
import { requireEvmRpc } from "./evm-direct.js";
import { formatAtomic } from "./money.js";
import { policyBinding } from "./profile-policy.js";
import { canonicalProfile } from "./wallet-policy.js";
export async function evmWalletBalance(context, profileInput, selection) {
    const profile = canonicalProfile(profileInput);
    const chainId = directEvmChain(selection.chainId);
    await context.ready();
    const profileHash = context.state.profileHash(profile);
    return await context.state.withLocks([`profile:${profileHash}`], async () => {
        const provider = await context.profileRepository?.load(profileHash);
        if (provider !== undefined && provider !== null && provider.provider_id !== "local")
            throw new ApnError("APN_PROVIDER_UNAVAILABLE", "Generic asset balance is not declared for this external wallet profile.");
        const wallet = await context.state.loadWallet(profileHash);
        if (wallet === null)
            throw new ApnError("APN_OPERATION_BLOCKED", "Wallet is not initialized.");
        const snapshot = await requireEvmRpc(context.requireRpc()).balance(wallet.address, selection);
        if (snapshot.address !== wallet.address || snapshot.asset.chainId !== selection.chainId)
            throw new ApnError("APN_ASSET_MISMATCH", "Asset balance belongs to a different wallet or chain.");
        const sharedNetwork = EVM_NETWORKS.find((network) => network.chainId === chainId);
        const policy = sharedNetwork === undefined ? undefined : await context.policy?.load(networkPolicyBinding(policyBinding(wallet), sharedNetwork.chainId));
        const x402Token = sharedNetwork === undefined ? undefined : x402Network(sharedNetwork.chainId).token;
        const limit = snapshot.asset.kind === "native" ? policy?.maxBalanceEthWei :
            snapshot.asset.address === x402Token ? policy?.maxBalanceUsdcAtomic : undefined;
        const atomic = evmUint(snapshot.assetAtomic), native = evmUint(snapshot.nativeAtomic);
        return {
            profile, funding_address: wallet.address, chain: `eip155:${snapshot.asset.chainId}`, asset: publicEvmAsset(snapshot.asset),
            balance: { atomic: atomic.toString(), decimal: formatAtomic(atomic.toString(), snapshot.asset.decimals) },
            native_gas_balance: { atomic: native.toString(), decimal: formatAtomic(native.toString(), 18), decimals: 18, symbol: "ETH" },
            provenance: { block_number_atomic: snapshot.blockNumberAtomic, block_hash: snapshot.blockHash, observed_at: snapshot.observedAt, rpc_origin: snapshot.rpcOrigin },
            funding_posture: { classification: limit === undefined ? "unassessed" : atomic > BigInt(limit) ? "overfunded" : "within_limit", asset_limit_atomic: limit ?? null, generic_unattended_permission_implied: false, inbound_balance_capped_by_apn: false },
            funding_guidance: { action: `Fund this address manually on eip155:${snapshot.asset.chainId} with the exact selected asset and native ETH for gas.`, warning: "Disposable local software wallet: no automatic funding, sweep, custody service or hardware backup." },
            proof_class: "chain_verified_public_read", next_actions: ["apn pay transfer prepare-asset --help"],
        };
    });
}
//# sourceMappingURL=evm-wallet-balance.js.map