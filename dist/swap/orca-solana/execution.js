import { canonicalJson, domainHash } from "../../canonical.js";
import { ApnError } from "../../errors.js";
import { assertSolanaNetwork, rpcAtomic } from "../../solana/rpc.js";
import { validateSwapOperation } from "../model.js";
import { assertOperationProtocolRegistry } from "../family-guards.js";
import { latestLifetime, orcaMessageFee, requireOrcaFunds } from "./builder.js";
import { createOrcaExecutionBinding } from "./effects.js";
import { compileOrcaSwap, orcaPlanSides } from "./instructions.js";
import { readOrcaMarket, readOrcaTokenMarket } from "./market.js";
import { ORCA_TOKEN_EXECUTION_SCHEMA, validateOrcaKeylessMaterial } from "./material.js";
import { simulateOrcaSwap, simulateOrcaTokenSwap } from "./simulation.js";
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
        await assertSolanaNetwork(this.rpc);
        await this.verifyPins(this.rpc);
        const execution = material.execution;
        return execution.schemaVersion === ORCA_TOKEN_EXECUTION_SCHEMA ? await this.inspectToken(operation, execution)
            : await this.inspectNative(operation, execution);
    }
    async inspectNative(operation, execution) {
        const plan = execution.plan;
        const market = await readOrcaMarket(this.rpc, plan.owner, BigInt(plan.amountInLamports));
        if (market.tickArrays.some((row, index) => row.address !== plan.tickArrays[index]) || market.oracle !== plan.oracle ||
            market.wsolAccount !== plan.wsolAccount || market.usdcAccount !== plan.usdcAccount) {
            blocked("The pool moved away from the approved tick arrays; quote again.", "orca_tick_array_moved");
        }
        // A wSOL account created or closed since the quote would change what the approved bytes unwrap or leave behind.
        if ((market.wsol !== null) !== (plan.wsolAccountKept === true))
            blocked("The owner's wSOL account changed since the quote; quote again.", "orca_wsol_account_changed");
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
        requireOrcaFunds(market.owner.ownerLamports, BigInt(plan.amountInLamports) + fee + rent + (market.wsol === null ? market.tokenAccountRentLamports : 0n));
        const simulation = await simulateOrcaSwap(this.rpc, compiled.unsignedPayload, { owner: plan.owner, wsolAccount: plan.wsolAccount,
            usdcAccount: plan.usdcAccount, before: market.owner, minimumOutputAtomic: plan.minimumOutputAtomic,
            maximumSolSpendLamports: execution.maximumSolSpendLamports, computeUnitLimit: plan.computeUnitLimit, wsolKept: market.wsol }, false, market.slot.toString());
        return await this.fresh(lifetime, compiled, fee, simulation);
    }
    /** Token-input pools: the same re-read, rebuild, fee, funds and exact-bytes simulation; the input never leaves as SOL. */
    async inspectToken(operation, execution) {
        const plan = execution.plan, pool = orcaPlanSides(plan).pool;
        const market = await readOrcaTokenMarket(this.rpc, pool, plan.owner, BigInt(plan.amountInAtomic));
        if (market.tickArrays.some((row, index) => row.address !== plan.tickArrays[index]) || market.oracle !== plan.oracle ||
            market.sourceAccount !== plan.sourceAccount || market.destinationAccount !== plan.destinationAccount) {
            blocked("The pool moved away from the approved tick arrays; quote again.", "orca_tick_array_moved");
        }
        if (BigInt(market.swap.amountOutAtomic) < BigInt(operation.quote.minimumOutputAtomic)) {
            blocked("The pool no longer yields the approved minimum output.", "orca_output_below_minimum");
        }
        const rent = market.owner.destinationAccountExists ? 0n : market.tokenAccountRentLamports;
        if (rent > BigInt(execution.destinationAccountRentLamports))
            blocked("The destination account rent is no longer covered by the approval.", "orca_rent_drift");
        const lifetime = await latestLifetime(this.rpc), compiled = compileOrcaSwap(plan, lifetime);
        const fee = await orcaMessageFee(this.rpc, compiled.messageBase64);
        if (fee > BigInt(execution.networkFeeLamports))
            blocked("The network fee exceeds the approved fee.", "orca_fee_drift");
        requireOrcaFunds(market.owner.ownerLamports, fee + rent);
        const simulation = await simulateOrcaTokenSwap(this.rpc, compiled.unsignedPayload, { pool, owner: plan.owner, sourceAccount: plan.sourceAccount,
            destinationAccount: plan.destinationAccount, before: market.owner, amountInAtomic: plan.amountInAtomic, minimumOutputAtomic: plan.minimumOutputAtomic,
            maximumSolSpendLamports: execution.maximumSolSpendLamports, computeUnitLimit: plan.computeUnitLimit }, false, market.slot.toString());
        return await this.fresh(lifetime, compiled, fee, simulation);
    }
    async fresh(lifetime, compiled, fee, simulation) {
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
            assertOperationProtocolRegistry(operation, this.d.protocolRegistry, "orca");
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
        if (["finalized", "failed_confirmed_revert", "expired_unlanded", "abandoned_unknown"].includes(operation.state))
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
    /** A swap finalized before its economics were recorded: one read of its own finalized transaction (observe only). */
    async receiptEconomics(input) {
        const read = this.d.observer.receiptEconomics;
        if (read === undefined)
            blocked("This Orca observer cannot read receipt facts.", "receipt_facts_unsupported");
        return await read.call(this.d.observer, validateSwapOperation(input.operation), validateOrcaKeylessMaterial(input.material));
    }
    /**
     * The execution binding carries the frozen lifetime of the only bytes that can be signed. Without a binding nothing was
     * signed, but no lifetime is known either, so no chain proof exists; the operation stays observable.
     */
    async proveUnlanded(input) {
        const operation = validateSwapOperation(input.operation), material = validateOrcaKeylessMaterial(input.material);
        const binding = await this.d.bindings.load(operation, material);
        if (binding === null)
            return null;
        return await this.d.observer.proveUnlanded(binding.lifetime.lastValidBlockHeight, async () => {
            const account = await this.d.admission.localAccount(operation);
            const effect = account === null ? null : await this.d.effects.effect(account, operation.operationId, binding.bindingHash);
            return effect === null ? null : effect.transactionId;
        });
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