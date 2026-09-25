/** Saved-operation Arbitrum approval decision. Only a verified allowance skip can mutate state. */
import { ApnError } from "../errors.js";
import { loadActiveAssetPolicyRegistry } from "../allowlist-active-policy.js";
import { AssetUsageLedger } from "../asset-usage-ledger.js";
import { RelayRetirementRepository, RelayUnsignedOperationRepository } from "../relay-unsigned-operation.js";
import { ArbitrumSourceEffectJournalRepository } from "./arbitrum-source-effect-journal.js";
import { RELAY_ARBITRUM_USDC } from "./arbitrum-usdc-ethereum-quote.js";
import { RelayArbitrumApprovalPreflightReader } from "./arbitrum-approval-preflight.js";
const HASH = /^[a-f0-9]{64}$/u;
const blocked = (reason) => {
    throw new ApnError("APN_OPERATION_BLOCKED", "Relay Arbitrum approval decision is blocked.", { reason });
};
export class RelayArbitrumApprovalDecisionService {
    state;
    reader;
    ports;
    constructor(state, reader, ports = {}) {
        this.state = state;
        this.reader = reader;
        this.ports = ports;
    }
    async decide(profile, operationId) {
        if (profile !== "default" || !HASH.test(operationId))
            throw new ApnError("APN_INVALID_INPUT", "Relay Arbitrum approval requires default profile and an operation ID.");
        const profileHash = this.state.profileHash(profile);
        const operation = await new RelayUnsignedOperationRepository(this.state.root).loadOperation(profileHash, operationId);
        if (operation === null)
            throw new ApnError("APN_OPERATION_NOT_FOUND", "Relay Arbitrum operation was not found in the requested profile.");
        if (operation.arbitrumDraft === undefined || operation.sourceChainId !== 42161 || operation.destinationChainId !== 1)
            blocked("exact_saved_arbitrum_route_required");
        if (await new RelayRetirementRepository(this.state.root).load(operation) !== null)
            blocked("operation_retired");
        const existing = await new ArbitrumSourceEffectJournalRepository(this.state.root).load(profileHash, operationId);
        if (existing !== null && (existing.effects[0].phase !== "pending" || existing.effects[1].phase !== "pending"))
            blocked("approval_already_started");
        const snapshot = async (lockedPolicy) => {
            const at = this.ports.now?.() ?? new Date();
            if (!(at instanceof Date) || !Number.isFinite(at.getTime()))
                blocked("invalid_clock");
            const policy = lockedPolicy ?? await (this.ports.activePolicy?.(profile, at) ??
                loadActiveAssetPolicyRegistry(this.state.root, profile, at));
            if (policy === null || policy.accounts.evm?.toLowerCase() !== operation.sourceAccount)
                return blocked("active_owner_policy_required");
            const usage = await (this.ports.dailyUsage?.(operation.sourceAccount, at) ??
                new AssetUsageLedger(this.state.root).usage({ account: operation.sourceAccount,
                    chain: "eip155:42161", asset: { kind: "token", identifier: RELAY_ARBITRUM_USDC } }, at)
                    .then(value => value.amountAtomic));
            return this.reader.read(operation, policy, operation.sourceAccount, usage, at, this.ports.now);
        };
        const first = await snapshot();
        const output = (state, result, journalIntegrityHash) => ({ operationId, profile,
            state, reason: state === "approval_required" ? "allowance_below_principal" :
                state === "approval_skipped" ? "fresh_canonical_allowance_persisted" : "read_only_conditions_unsatisfied",
            approvalRequired: result.approvalRequired, allowanceAtomic: result.allowanceAtomic,
            observationBlockNumber: result.observationBlockNumber, observationBlockHash: result.observationBlockHash,
            confirmedNonce: result.confirmedNonce, pendingNonce: result.pendingNonce,
            baseFeePerGas: result.baseFeePerGas, reasons: result.reasons,
            journalIntegrityHash, proofClass: state === "approval_skipped" ? "canonical_allowance_observation" :
                "read_only_rpc_observation", executionAdmitted: false, nextActions: [] });
        if (first.approvalRequired)
            return output("approval_required", first, null);
        if (!first.readOnlyConditionsSatisfied)
            return output("preflight_blocked", first, null);
        const verified = { value: null };
        const journal = await new ArbitrumSourceEffectJournalRepository(this.state.root, undefined, undefined, this.ports.now).skipApprovalIfVerified(profileHash, operationId, existing?.integrityHash ?? null, async (input) => {
            if (input.operation.integrityHash !== operation.integrityHash ||
                input.operation.operationId !== operationId || input.journal.operationIntegrityHash !== operation.integrityHash)
                blocked("saved_operation_changed");
            verified.value = await snapshot(input.activePolicy);
            if (verified.value.approvalRequired)
                return null;
            if (!verified.value.readOnlyConditionsSatisfied)
                blocked("read_only_conditions_changed");
            return { policyDigest: verified.value.policyDigest, policyRevision: verified.value.policyRevision,
                allowanceAtomic: verified.value.allowanceAtomic, blockNumber: verified.value.observationBlockNumber,
                blockHash: verified.value.observationBlockHash, observedAt: verified.value.observedAt };
        }, this.ports.activePolicy);
        if (journal === null) {
            if (verified.value === null)
                return blocked("canonical_allowance_read_missing");
            return output("approval_required", verified.value, null);
        }
        const final = verified.value;
        if (final === null || journal.effects[0].phase !== "approval_skipped" ||
            journal.effects[0].skipProof?.operationIntegrityHash !== operation.integrityHash)
            return blocked("approval_skip_result_mismatch");
        return output("approval_skipped", final, journal.integrityHash);
    }
}
//# sourceMappingURL=arbitrum-approval-decision.js.map