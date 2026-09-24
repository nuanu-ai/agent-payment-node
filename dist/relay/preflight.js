/** A single, read-only source funding observation for a saved unsigned Relay quote. */
import { ApnError } from "../errors.js";
import { loadActiveAssetPolicyRegistry } from "../allowlist-active-policy.js";
import { allowlistProfileHash } from "../allowlist-policy-overlay.js";
import { evaluateAssetPolicy } from "../asset-policy-registry.js";
import { AssetUsageLedger } from "../asset-usage-ledger.js";
import { evmRpcQuantity, evmRpcWord, evmRpcRecord, evmRpcHex } from "../evm-rpc-codec.js";
import { RelayUnsignedOperationRepository } from "../relay-unsigned-operation.js";
import { StateStore } from "../state.js";
import { ETHEREUM_DEPOSITORY, ETHEREUM_USDC } from "./quote.js";
import { RELAY_ROUTE_REFERENCE } from "./prepare.js";
function blocked(reason) {
    throw new ApnError("APN_OPERATION_BLOCKED", "Relay source preflight is blocked.", { reason });
}
export class RelayReadOnlyPreflightService {
    state;
    clock;
    ports;
    constructor(state, clock, ports) {
        this.state = state;
        this.clock = clock;
        this.ports = ports;
    }
    async preflight(input) {
        if (input.profile !== "default" || !/^[a-f0-9]{64}$/u.test(input.operationId)) {
            throw new ApnError("APN_INVALID_INPUT", "Relay preflight requires the default profile and an operation ID.");
        }
        allowlistProfileHash(input.profile);
        const operation = await new RelayUnsignedOperationRepository(this.state.root)
            .loadOperation(this.state.profileHash(input.profile), input.operationId);
        if (operation === null)
            throw new ApnError("APN_OPERATION_NOT_FOUND", "Relay operation was not found for this profile.");
        const quote = operation.quote;
        if (quote === undefined || operation.policyDigest === undefined || operation.policyRevision === undefined ||
            operation.approvalNetworkFeeCeilingWei === undefined || operation.depositNetworkFeeCeilingWei === undefined) {
            blocked("relay_saved_quote_required");
        }
        const now = this.clock.now();
        if (!Number.isFinite(now.getTime()))
            throw new ApnError("APN_INVALID_INPUT", "Relay preflight clock is invalid.");
        if (now.getTime() + 60_000 >= Date.parse(operation.deadline))
            blocked("relay_quote_expired_or_near_deadline");
        const active = await (this.ports.activePolicy?.(input.profile) ??
            loadActiveAssetPolicyRegistry({ state: this.state, clock: this.clock }, input.profile));
        if (active === null || active.profile !== input.profile || active.digest !== operation.policyDigest ||
            active.revision !== operation.policyRevision || active.accounts.evm?.toLowerCase() !== operation.sourceAccount.toLowerCase()) {
            blocked("relay_active_policy_or_owner_changed");
        }
        if (active.registry.expiresAt !== undefined && now.toISOString() >= active.registry.expiresAt)
            blocked("relay_policy_expired");
        const publicAccount = await (this.ports.publicAccount?.(input.profile) ??
            this.state.loadWallet(operation.profileHash).then(wallet => wallet?.address ?? null));
        if (publicAccount?.toLowerCase() !== operation.sourceAccount.toLowerCase())
            blocked("relay_public_profile_owner_mismatch");
        const usage = await (this.ports.dailyUsage?.(active.accounts.evm, now) ??
            new AssetUsageLedger(this.state.root).usage({ account: active.accounts.evm, chain: "eip155:1",
                asset: { kind: "token", identifier: ETHEREUM_USDC } }, now).then(value => value.amountAtomic));
        const admission = evaluateAssetPolicy(active.registry, { chain: "eip155:1",
            asset: { kind: "token", identifier: ETHEREUM_USDC }, rail: "bridge", amountAtomic: operation.amountAtomic,
            dailyUsageAtomic: usage, asOfDate: now.toISOString().slice(0, 10), asOf: now.toISOString() });
        const pin = admission.asset.mechanismPins?.bridge;
        if (pin?.provider !== "relay" || pin.reference !== RELAY_ROUTE_REFERENCE)
            blocked("relay_route_pin_changed");
        if (quote.paymentDetails.depository.toLowerCase() !== ETHEREUM_DEPOSITORY ||
            quote.approval.to.toLowerCase() !== ETHEREUM_USDC.toLowerCase() ||
            quote.deposit.to.toLowerCase() !== ETHEREUM_DEPOSITORY ||
            quote.approval.from !== operation.sourceAccount.toLowerCase() ||
            quote.deposit.from !== operation.sourceAccount.toLowerCase())
            blocked("relay_quote_envelope_changed");
        const expectedApprovalData = `0x095ea7b3${ETHEREUM_DEPOSITORY.slice(2).padStart(64, "0")}${BigInt(operation.amountAtomic).toString(16).padStart(64, "0")}`;
        if (quote.approval.data.toLowerCase() !== expectedApprovalData)
            blocked("relay_approval_spender_or_amount_changed");
        const account = operation.sourceAccount;
        const token = ETHEREUM_USDC;
        const balanceOf = `0x70a08231${account.slice(2).toLowerCase().padStart(64, "0")}`;
        const allowance = `0xdd62ed3e${account.slice(2).toLowerCase().padStart(64, "0")}${ETHEREUM_DEPOSITORY.slice(2).toLowerCase().padStart(64, "0")}`;
        const calls = [
            { method: "eth_chainId", params: [] },
            { method: "eth_getBlockByNumber", params: ["latest", false] },
            { method: "eth_getBalance", params: [account, "latest"] },
            { method: "eth_call", params: [{ to: token, data: balanceOf }, "latest"] },
            { method: "eth_call", params: [{ to: token, data: allowance }, "latest"] },
        ];
        const values = await this.ports.batch(calls);
        if (!Array.isArray(values) || values.length !== calls.length)
            throw new ApnError("APN_RPC_PROTOCOL", "Relay RPC batch is incomplete.");
        if (evmRpcQuantity(values[0]) !== 1n)
            blocked("relay_source_chain_mismatch");
        const head = evmRpcRecord(values[1]);
        const blockNumber = evmRpcQuantity(head.number).toString();
        const blockHash = evmRpcHex(head.hash, 32);
        if (blockHash === `0x${"0".repeat(64)}`)
            throw new ApnError("APN_RPC_PROTOCOL", "Relay RPC returned a zero block hash.");
        const nativeBalanceWei = evmRpcQuantity(values[2]);
        const tokenBalanceAtomic = evmRpcWord(values[3]);
        const allowanceAtomic = evmRpcWord(values[4]);
        const requiredNativeWei = BigInt(operation.approvalNetworkFeeCeilingWei) + BigInt(operation.depositNetworkFeeCeilingWei);
        const principalAtomic = BigInt(operation.amountAtomic);
        const reasons = [
            ...(tokenBalanceAtomic < principalAtomic ? ["insufficient_usdc_balance"] : []),
            ...(nativeBalanceWei < requiredNativeWei ? ["insufficient_native_fee_balance"] : []),
        ];
        const observedAt = this.clock.now();
        if (!Number.isFinite(observedAt.getTime()) || observedAt.getTime() + 60_000 >= Date.parse(operation.deadline)) {
            blocked("relay_quote_expired_during_read");
        }
        if (active.registry.expiresAt !== undefined && observedAt.toISOString() >= active.registry.expiresAt)
            blocked("relay_policy_expired_during_read");
        return { kind: "relay_read_only_source_preflight", operationId: operation.operationId,
            profile: input.profile, sourceChainId: 1, sourceAccount: account, token, spender: ETHEREUM_DEPOSITORY,
            observedHeadBlockNumber: blockNumber, observedHeadBlockHash: blockHash, observationTag: "latest",
            nativeBalanceWei: nativeBalanceWei.toString(), tokenBalanceAtomic: tokenBalanceAtomic.toString(),
            allowanceAtomic: allowanceAtomic.toString(), principalAtomic: operation.amountAtomic,
            approvalNetworkFeeCeilingWei: operation.approvalNetworkFeeCeilingWei,
            depositNetworkFeeCeilingWei: operation.depositNetworkFeeCeilingWei,
            requiredNativeWei: requiredNativeWei.toString(), approvalRequired: allowanceAtomic < principalAtomic,
            fundingReasons: reasons, fundingObserved: reasons.length === 0,
            proofClass: "read_only_rpc_observation", executionAdmitted: false, nextActions: [] };
    }
}
//# sourceMappingURL=preflight.js.map