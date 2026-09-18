import { canonicalJson, domainHash } from "../../../canonical.js";
import { ApnError } from "../../../errors.js";
import { validateSwapOperation } from "../../model.js";
import { validateUniswapKeylessMaterial } from "../../uniswap-v3/material.js";
import { assertInjectedProtocol, createUniswapApprovalRequest, createUniswapExecutionBinding, validateFreshness } from "./binding.js";
/**
 * GuardedSwapExecutionDriver for the approved Uniswap reservation. Before the marker every refusal releases the
 * reservation with a bound proof. The marker, then the execution binding, are durable before signing; the sender
 * attempts once; every later outcome, and every status call, only observes the exact signed transaction.
 */
export class UniswapEthereumExecutionDriver {
    d;
    constructor(d) {
        this.d = d;
    }
    async execute(input) {
        let operation = validateSwapOperation(input.operation);
        if (operation.state !== "reserved" || operation.submissionMarker !== null)
            blocked("Uniswap execution requires the exact approved reservation.", "uniswap_execution_state");
        const envelope = validateUniswapKeylessMaterial(input.material).execution.envelope;
        let admission, freshness, approvalHash;
        try {
            assertInjectedProtocol(operation, this.d.protocolRegistry);
            admission = await this.d.admission.assert(operation);
            freshness = await this.d.guard.inspect(operation, envelope);
            const checked = this.d.clock.now();
            validateFreshness(operation, envelope, freshness, checked);
            approvalHash = createUniswapApprovalRequest(operation, envelope, freshness, checked).approvalHash;
            // The marker instant is the freshness instant, so the binding proves its freshness was taken at the boundary.
            operation = await this.d.core.markSubmitting(operation, new Date(freshness.checkedAt));
        }
        catch (error) {
            await this.releaseUnsent(operation, error);
            throw error;
        }
        const binding = createUniswapExecutionBinding({ operation, envelope, freshness, admission, approvalHash });
        try {
            await this.d.bindings.save(operation, binding);
        }
        catch {
            return await this.d.core.recordPossibleSend(operation, "unknown_finality", this.d.clock.now());
        }
        let transactionHash;
        try {
            transactionHash = (await this.d.signer.sign(operation, binding, admission, this.d.clock.now())).transactionHash;
        }
        catch {
            return await this.d.core.recordPossibleSend(operation, "unknown_finality", this.d.clock.now());
        }
        let sent = null;
        try {
            sent = await this.d.sender.sendOnce(operation, binding, this.d.clock.now());
        }
        catch {
            sent = null;
        }
        const accepted = sent !== null && sent.kind === "submitted" && sent.transactionHash === transactionHash;
        operation = await this.d.core.recordPossibleSend(operation, accepted ? "submitted" : "unknown_finality", this.d.clock.now());
        return await this.observeExact(operation, binding, transactionHash);
    }
    async observe(input) {
        let operation = validateSwapOperation(input.operation);
        if (operation.submissionMarker === null)
            blocked("Uniswap observation is available only after the submission marker.", "uniswap_resume_before_marker");
        validateUniswapKeylessMaterial(input.material);
        if (["finalized", "failed_confirmed_revert"].includes(operation.state))
            return operation;
        const binding = await this.d.bindings.load(operation);
        const effect = binding === null ? null : await this.d.effects.load(operation, binding);
        if (binding === null || effect === null) {
            if (operation.state === "submitting")
                operation = await this.d.core.recordPossibleSend(operation, "unknown_finality", this.d.clock.now());
            return operation;
        }
        if (operation.state === "submitting")
            operation = await this.d.core.recordPossibleSend(operation, effect.phase === "send_accepted" ? "submitted" : "unknown_finality", this.d.clock.now());
        return await this.observeExact(operation, binding, effect.transactionHash);
    }
    async observeExact(operation, binding, transactionHash) {
        let outcome;
        try {
            outcome = await this.d.observer.observeOutcome(operation, binding, transactionHash);
        }
        catch {
            return operation;
        }
        if (outcome === null || (operation.state !== "submitted" && operation.state !== "unknown_finality"))
            return operation;
        return outcome.outcome === "succeeded" ? await this.d.core.finalize(operation, this.d.clock.now(), outcome.proof)
            : await this.d.core.failConfirmedRevert(operation, this.d.clock.now(), outcome.proof);
    }
    async releaseUnsent(operation, error) {
        const reason = error instanceof ApnError ? `${error.code}:${String(error.details?.reason ?? "")}` : "guard_unavailable";
        const proof = domainHash("apn.uniswap-unsent-refusal.v1", canonicalJson({ operationId: operation.operationId,
            integrityHash: operation.integrityHash, reason }));
        try {
            await this.d.core.failBeforeEffect(operation, this.d.clock.now(), proof);
        }
        catch { /* A persisted marker or concurrent change keeps the reservation; resume only observes. */ }
    }
}
function blocked(message, reason) { throw new ApnError("APN_OPERATION_BLOCKED", message, { reason }); }
//# sourceMappingURL=driver.js.map