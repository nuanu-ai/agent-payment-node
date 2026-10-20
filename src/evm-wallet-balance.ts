import { networkPolicyBinding, x402Asset, x402Network } from "./x402-network.js";
import { x402TokenUnit } from "./x402-token-unit.js";
import { ApnError } from "./errors.js";
import { EVM_NETWORKS, evmUint, publicEvmAsset, type EvmAssetSelection } from "./evm-asset.js";
import { directEvmChain, directEvmNetwork } from "./evm-direct-networks.js";
import { directRpcChain } from "./rpc-requirement.js";
import { requireEvmRpc } from "./evm-direct.js";
import { formatAtomic } from "./money.js";
import { policyBinding } from "./profile-policy.js";
import { selectedAssetFundingGuidance } from "./funding-guidance.js";
import type { RuntimeContext } from "./runtime.js";
import { canonicalProfile } from "./wallet-policy.js";

/**
 * One balance path for every EVM chain. The wallet and policy are read under the profile lock; the RPC read is not. A token
 * is assessed against the policy of its exact chain and token, the one x402 payment enforces (QA 0.5.54: a Sei USDC policy
 * read as absent while payment refused as overfunded). Native gas has no token of its own: only a legacy network's released
 * USDC policy carries it implicitly; elsewhere its cap lives in each token's policy and is read with that token.
 */
export async function evmWalletBalance(context: RuntimeContext, profileInput: string, selection: EvmAssetSelection): Promise<unknown> {
  const profile = canonicalProfile(profileInput);
  const chainId = directEvmChain(selection.chainId);
  const nativeSymbol = directEvmNetwork(chainId).nativeSymbol;
  const policyAsset = selection.token !== "native" ? x402Asset(chainId, selection.token)
    : EVM_NETWORKS.some((network) => network.chainId === chainId) ? x402Network(chainId) : undefined;
  await context.ready();
  const profileHash = context.state.profileHash(profile);
  const { wallet, policy } = await context.state.withLocks([`profile:${profileHash}`], async () => {
    const provider = await context.profileRepository?.load(profileHash);
    if (provider !== undefined && provider !== null && provider.provider_id !== "local") throw new ApnError("APN_PROVIDER_UNAVAILABLE", "Generic asset balance is not declared for this external wallet profile.");
    const loaded = await context.state.loadWallet(profileHash);
    if (loaded === null) throw new ApnError("APN_OPERATION_BLOCKED", "Wallet is not initialized.");
    return { wallet: loaded, policy: policyAsset === undefined ? undefined :
      await context.policy?.load(networkPolicyBinding(policyBinding(loaded), policyAsset)) };
  });
  const snapshot = await requireEvmRpc(context.requireRpc(directRpcChain(chainId))).balance(wallet.address, selection);
  if (snapshot.address !== wallet.address || snapshot.asset.chainId !== selection.chainId) throw new ApnError("APN_ASSET_MISMATCH", "Asset balance belongs to a different wallet or chain.");
  const limit = snapshot.asset.kind === "native" ? policy?.maxBalanceEthWei : policy?.maxBalanceUsdcAtomic;
  const atomic = evmUint(snapshot.assetAtomic), native = evmUint(snapshot.nativeAtomic);
  const unit = snapshot.asset.kind === "native" ? null : x402TokenUnit(chainId, snapshot.asset.address);
  const guidance = selectedAssetFundingGuidance({ chainId: snapshot.asset.chainId, kind: snapshot.asset.kind, decimals: snapshot.asset.decimals,
    nativeSymbol, assetAtomic: atomic, nativeAtomic: native, assetLimit: limit, nativeLimit: policy?.maxBalanceEthWei,
    tokenSymbol: unit?.symbol ?? null, nativeScope: policyAsset === undefined ? "token_policies" : "policy" });
  return {
    profile, funding_address: wallet.address, chain: `eip155:${snapshot.asset.chainId}`, asset: publicEvmAsset(snapshot.asset),
    balance: { atomic: atomic.toString(), decimal: formatAtomic(atomic.toString(), snapshot.asset.decimals) },
    native_gas_balance: { atomic: native.toString(), decimal: formatAtomic(native.toString(), 18), decimals: 18, symbol: nativeSymbol },
    provenance: { block_number_atomic: snapshot.blockNumberAtomic, block_hash: snapshot.blockHash, observed_at: snapshot.observedAt, rpc_origin: snapshot.rpcOrigin },
    funding_posture: { classification: limit === undefined ? "unassessed" : atomic > BigInt(limit) ? "overfunded" : "within_limit", asset_limit_atomic: limit ?? null, generic_unattended_permission_implied: false, inbound_balance_capped_by_apn: false },
    funding_guidance: guidance.funding_guidance,
    proof_class: "chain_verified_public_read", next_actions: guidance.next_actions,
  };
}
