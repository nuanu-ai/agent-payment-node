import { canonicalJson } from "./canonical.js";
import { assertChainFeePolicy, chainAsset, chainDecimal, chainUsage, sealChainPolicy } from "./chain-policy.js";
import { ChainPolicyStore } from "./chain-policy-store.js";
import { ApnError } from "./errors.js";
import { OperationService } from "./operation-service.js";
import { RailOperationRepository } from "./rail-operation-repository.js";
import { canonicalProfile } from "./wallet-policy.js";
import { assertWalletLifecycleAvailable } from "./wallet-lifecycle-guard.js";
export class ChainPolicyService {
    context;
    policies;
    records;
    operations;
    constructor(context) {
        this.context = context;
        this.policies = new ChainPolicyStore(context.state.root);
        this.records = new RailOperationRepository(context.state.root);
        this.operations = new OperationService(context.state, context.providerX402Repository, this.records);
    }
    adapter(rail, provider) {
        const matches = this.context.directRails.filter((port) => port.rail === rail && port.provider === provider);
        if (matches.length !== 1)
            throw new ApnError("APN_PROVIDER_UNAVAILABLE", "This direct rail and execution owner are unavailable.");
        return matches[0];
    }
    async assertProfileOwner(profile, provider) {
        const hash = this.context.state.profileHash(profile);
        const stored = await this.context.state.loadProviderProfile(hash);
        if (stored !== null && stored.provider_id !== (provider === "coinbase-awal" ? "coinbase-agentic-wallet" : provider)) {
            throw new ApnError("APN_PROFILE_DRIFT", "The existing profile has a different execution owner.");
        }
        if (stored === null && provider !== "local" && await this.context.state.loadWallet(hash) !== null) {
            throw new ApnError("APN_PROFILE_DRIFT", "The profile already belongs to a local wallet.");
        }
        if (this.context.chainAccounts !== undefined)
            for (const rail of ["solana", "tron"]) {
                const account = await this.context.chainAccounts.ownerBinding(profile, rail);
                if (account !== null && account.provider !== provider) {
                    throw new ApnError("APN_PROFILE_DRIFT", "Another chain account already binds this profile to a different execution owner.");
                }
            }
    }
    async account(profileInput, rail) {
        const profile = canonicalProfile(profileInput);
        if (this.context.chainAccounts === undefined)
            throw new ApnError("APN_PROVIDER_UNAVAILABLE", "Chain custody storage is unavailable.");
        const account = await this.context.chainAccounts.account(profile, rail);
        if (account === null)
            throw new ApnError("APN_OPERATION_BLOCKED", "The chain wallet is not initialized.");
        await this.assertProfileOwner(profile, account.provider);
        const adapter = this.adapter(rail, account.provider);
        if (adapter.canonicalAddress(account.address) !== account.address)
            throw new ApnError("APN_WALLET_MISMATCH", "The chain wallet identity is invalid.");
        return account;
    }
    async ensure(profileInput, rail, provider, acceptRisk) {
        const profile = canonicalProfile(profileInput);
        if (provider === "local" && !acceptRisk)
            throw new ApnError("APN_INVALID_INPUT", "Local chain custody requires explicit --accept-risk acknowledgement.");
        await this.context.ready();
        return await this.context.state.withLocks([`profile:${this.context.state.profileHash(profile)}`], async () => {
            await assertWalletLifecycleAvailable(this.context, this.context.state.profileHash(profile));
            await this.assertProfileOwner(profile, provider);
            return await this.adapter(rail, provider).ensureAccount(profile);
        });
    }
    async balance(profile, rail, alias) {
        const account = await this.account(profile, rail);
        const adapter = this.adapter(rail, account.provider);
        return await adapter.balance(account, chainAsset(rail, alias));
    }
    async admit(input) {
        const profile = canonicalProfile(input.profile);
        const asset = chainAsset(input.rail, input.asset);
        const maximumPerTransferAtomic = chainDecimal(input.maximumPerTransfer, asset.decimals);
        const dailyLimitAtomic = chainDecimal(input.dailyLimit, asset.decimals);
        const maximumNativeFeeAtomic = chainDecimal(input.maximumFee, input.rail === "solana" ? 9 : 6);
        if (BigInt(maximumPerTransferAtomic) > BigInt(dailyLimitAtomic))
            throw new ApnError("APN_INVALID_INPUT", "The daily limit must cover the per-transfer limit.");
        const approval = this.context.chainPolicyApproval;
        if (approval === undefined)
            throw new ApnError("APN_FOREGROUND_APPROVAL_REQUIRED", "Chain policy admission requires foreground human approval.");
        await this.context.ready();
        return await this.context.state.withLocks([`profile:${this.context.state.profileHash(profile)}`], async () => {
            const account = await this.account(profile, input.rail);
            await this.operations.assertRailAccountAvailable(account.profileHash, account.rail, account.address);
            const networkIdentity = await this.adapter(input.rail, account.provider).assertNetwork();
            const policy = sealChainPolicy({ schemaVersion: "apn.chain-policy.v1", account, asset, networkIdentity,
                maximumPerTransferAtomic, dailyLimitAtomic, maximumNativeFeeAtomic, admittedAt: this.context.clock.now().toISOString() });
            await approval.approve(policy);
            if (canonicalJson(await this.account(profile, input.rail)) !== canonicalJson(account))
                throw new ApnError("APN_PROFILE_DRIFT", "The chain account changed during policy admission.");
            await this.policies.write(policy);
            return { policy, usage: chainUsage(policy, await this.records.listOperations(account.profileHash), this.context.clock.now()) };
        });
    }
    async requiredPolicy(account, alias) {
        const policy = await this.policies.load(account, chainAsset(account.rail, alias));
        if (policy === null)
            throw new ApnError("APN_WALLET_POLICY_REQUIRED", "This mainnet asset is denied until foreground policy admission.");
        return policy;
    }
    /** The chain policy caps only native fees, rent and resources; the owner allowlist policy caps the amount (one counter, no double count). */
    async authorize(account, alias, maximumFee) {
        const policy = await this.requiredPolicy(account, alias);
        assertChainFeePolicy(policy, account, chainAsset(account.rail, alias), maximumFee);
        return policy;
    }
}
export function solanaCapabilities() {
    return {
        rail: "solana", network: "mainnet", assets: [chainAsset("solana", "sol"), chainAsset("solana", "usdc"), chainAsset("solana", "usdt")], x402: { available: false },
        profiles: [
            { provider: "local", execution: "local_signed", direct: true, requires: ["separate_encrypted_wallet", "explicit_rpc", "foreground_policy", "foreground_transfer_approval"] },
            { provider: "coinbase-awal", execution: "provider_atomic", direct: false, accountAndBalance: true, blocker: "pinned_provider_fee_and_rent_guarantee_unavailable" },
            { provider: "metamask-smart-account", direct: false, blocker: "pinned_provider_has_no_solana_rail" },
            { provider: "metamask-agent-wallet", direct: false, blocker: "pinned_provider_has_no_solana_rail" },
        ],
    };
}
//# sourceMappingURL=chain-policy-service.js.map