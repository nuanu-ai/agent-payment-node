import { canonicalJson, domainHash } from "../../canonical.js";
import { ApnError } from "../../errors.js";
import { assertSolanaNetwork, rpcAtomic } from "../../solana/rpc.js";
import { validateSwapOperation } from "../model.js";
import { assertInjectedProtocol } from "../uniswap-ethereum/execution/binding.js";
import { latestLifetime, orcaMessageFee, requireOrcaFunds } from "./builder.js";
import { createOrcaExecutionBinding } from "./effects.js";
import { compileOrcaSwap } from "./instructions.js";
import { readOrcaMarket } from "./market.js";
import { validateOrcaKeylessMaterial } from "./material.js";
import { simulateOrcaSwap } from "./simulation.js";
/**
 * Pre-signing guard, run after the owner approved: program pins unchanged, the pool re-read at a fresh slot with the
 * same tick arrays and a local output still at or above the minimum, a fresh blockhash, the exact bytes rebuilt and
 * validated, the chain fee within the approved fee, funds sufficient, and the exact signed-to-be bytes simulated.
 */
export class OrcaExecutionGuard {
    rpc;
    clock;
    verifyPins;
    constructor(rpc, clock, verifyPins) {
        this.rpc = rpc;
        this.clock = clock;
        this.verifyPins = verifyPins;
    }
    async inspect(operationValue, materialValue) {
        const operation = validateSwapOperation(operationValue), material = validateOrcaKeylessMaterial(materialValue);
        const execution = material.execution, plan = execution.plan;
        await assertSolanaNetwork(this.rpc);
        await this.verifyPins(this.rpc);
        const market = await readOrcaMarket(this.rpc, plan.owner, BigInt(plan.amountInLamports));
        if (market.tickArrays.some((row, index) => row.address !== plan.tickArrays[index]) || market.oracle !== plan.oracle ||
            market.wsolAccount !== plan.wsolAccount || market.usdcAccount !== plan.usdcAccount) {
            blocked("The pool moved away from the approved tick arrays; quote again.", "orca_tick_array_moved");
        }
        if (BigInt(market.swap.amountOutAtomic) < BigInt(operation.quote.minimumOutputAtomic)) {
            blocked("The pool no longer yields the approved minimum output.", "orca_output_below_minimum");
        }
        const rent = market.owner.usdcAccountExists ? 0n : market.tokenAccountRentLamports;
        if (rent > BigInt(execution.usdcAccountRentLamports))
            blocked("The USDC account rent is no longer covered by the approval.", "orca_rent_drift");
        const lifetime = await latestLifetime(this.rpc), compiled = compileOrcaSwap(plan, lifetime);
        const fee = await orcaMessageFee(this.rpc, compiled.messageBase64);
        if (fee > BigInt(execution.networkFeeLamports))
            blocked("The network fee exceeds the approved fee.", "orca_fee_drift");
        requireOrcaFunds(market.owner.ownerLamports, BigInt(plan.amountInLamports) + fee + rent + market.tokenAccountRentLamports);
        const simulation = await simulateOrcaSwap(this.rpc, compiled.unsignedPayload, { owner: plan.owner, wsolAccount: plan.wsolAccount,
            usdcAccount: plan.usdcAccount, before: market.owner, minimumOutputAtomic: plan.minimumOutputAtomic,
            maximumSolSpendLamports: execution.maximumSolSpendLamports, computeUnitLimit: plan.computeUnitLimit }, false, market.slot.toString());
        const height = rpcAtomic(await this.rpc.call("getBlockHeight", [{ commitment: "confirmed" }]));
        if (height > BigInt(lifetime.lastValidBlockHeight))
            blocked("The fresh blockhash expired before signing.", "orca_lifetime_expired");
        return { lifetime, unsignedPayload: compiled.unsignedPayload, messageHash: compiled.messageHash, networkFeeLamports: fee.toString(),
            simulation, blockHeight: height.toString(), checkedAt: this.clock.now().toISOString() };
    }
}
/**
 * GuardedSwapExecutionDriver for the approved Orca reservation. Before the marker every refusal releases the
 * reservation with a bound proof. The marker, the execution binding and the sealed signed bytes are durable before
 * the single send; every later outcome, and every status call, only observes the exact signature.
 */
export class OrcaSolanaExecutionDriver {
    d;
    constructor(d) {
        this.d = d;
    }
    async execute(input) {
        let operation = validateSwapOperation(input.operation);
        if (operation.state !== "reserved" || operation.submissionMarker !== null)
            blocked("Orca execution requires the exact approved reservation.", "orca_execution_state");
        const material = validateOrcaKeylessMaterial(input.material);
        let admission, freshness;
        try {
            assertInjectedProtocol(operation, this.d.protocolRegistry);
            admission = await this.d.admission.assert(operation);
            freshness = await this.d.guard.inspect(operation, material);
            if (freshness.checkedAt >= operation.quote.expiresAt)
                blocked("The approval window closed before signing.", "orca_deadline");
            // The marker instant is the freshness instant, so the binding proves it was taken at the boundary.
            operation = await this.d.core.markSubmitting(operation, new Date(freshness.checkedAt));
        }
        catch (error) {
            await this.releaseUnsent(operation, error);
            throw error;
        }
        let binding;
        try {
            binding = createOrcaExecutionBinding({ operation, material, freshness, admission });
            await this.d.bindings.save(operation, binding, material);
        }
        catch {
            return await this.d.core.recordPossibleSend(operation, "unknown_finality", this.d.clock.now());
        }
        let signature, sent;
        try {
            const effect = await this.d.signer.sign(operation, binding, material, admission.account);
            signature = effect.transactionId;
            sent = await this.d.sender.sendOnce(effect);
        }
        catch {
            return await this.d.core.recordPossibleSend(operation, "unknown_finality", this.d.clock.now());
        }
        operation = await this.d.core.recordPossibleSend(operation, sent === "submitted" ? "submitted" : "unknown_finality", this.d.clock.now());
        return await this.observeExact(operation, binding, material, signature);
    }
    async observe(input) {
        let operation = validateSwapOperation(input.operation);
        if (operation.submissionMarker === null)
            blocked("Orca observation is available only after the submission marker.", "orca_resume_before_marker");
        const material = validateOrcaKeylessMaterial(input.material);
        if (["finalized", "failed_confirmed_revert"].includes(operation.state))
            return operation;
        const binding = await this.d.bindings.load(operation, material);
        const account = binding === null ? null : await this.d.admission.localAccount(operation);
        const effect = binding === null || account === null ? null : await this.d.effects.effect(account, operation.operationId, binding.bindingHash);
        // Whether the process died before or after the one send is unknowable here, so it is recorded as possible, never retried.
        if (operation.state === "submitting")
            operation = await this.d.core.recordPossibleSend(operation, "unknown_finality", this.d.clock.now());
        if (binding === null || effect === null)
            return operation;
        return await this.observeExact(operation, binding, material, effect.transactionId);
    }
    async observeExact(operation, binding, material, signature) {
        let outcome;
        try {
            outcome = await this.d.observer.observeOutcome(operation, binding, material, signature);
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
        const proof = domainHash("apn.orca-unsent-refusal.v1", canonicalJson({ operationId: operation.operationId,
            integrityHash: operation.integrityHash, reason }));
        try {
            await this.d.core.failBeforeEffect(operation, this.d.clock.now(), proof);
        }
        catch { /* A persisted marker or concurrent change keeps the reservation; resume only observes. */ }
    }
}
function blocked(message, reason) { throw new ApnError("APN_OPERATION_BLOCKED", message, { reason }); }
//# sourceMappingURL=execution.js.map