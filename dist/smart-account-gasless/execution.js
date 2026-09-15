import { saPolicyHash, saSame } from "./integrity.js";
import { assertSmartAccountGaslessBinding, smartAccountGaslessOwner } from "./owner.js";
import { SmartAccountGaslessClock, smartAccountGaslessApprovalPhrase, smartAccountGaslessApprovalSummary, smartAccountGaslessSnapshot } from "./policy.js";
import { saClassify, saError, saFail, saFailure } from "./reasons.js";
import { saExact } from "./schema.js";
import { advanceSmartAccountGaslessOperation, assertSmartAccountGaslessCapacity } from "./transitions.js";
export class SmartAccountGaslessExecution {
    state;
    rpcFor;
    material;
    provider;
    save;
    clock;
    constructor(state, rpcFor, material, provider, clock, save) {
        this.state = state;
        this.rpcFor = rpcFor;
        this.material = material;
        this.provider = provider;
        this.save = save;
        this.clock = new SmartAccountGaslessClock(clock);
    }
    /** Observation through an owner-named RPC after exposure; approval, verification and settlement keep the frozen endpoint. */
    async observeWith(op, observer) {
        return op.terminal || op.exposureAttempts !== 1 ? { operation: op } : await this.observe(op, undefined, observer);
    }
    async approve(op, approval) {
        if (op.terminal || op.state !== "awaiting_approval")
            return { operation: op };
        let now;
        try {
            now = this.clock.live(op);
        }
        catch (error) {
            return await this.halt(op, error);
        }
        let accepted;
        try {
            accepted = await approval.confirm({ operationId: op.operationId, fingerprint: op.fingerprint,
                exactPhrase: smartAccountGaslessApprovalPhrase(op), summary: smartAccountGaslessApprovalSummary(op, now) });
        }
        catch (error) {
            try {
                this.clock.live(op);
            }
            catch (clockError) {
                return await this.halt(op, clockError);
            }
            if (saClassify(error, "sa_gasless_approval").reason === "sa_gasless_expired")
                return await this.halt(op, error);
            throw saError("sa_gasless_approval"); // Missing foreground input preserves awaiting_approval.
        }
        try {
            now = this.clock.live(op);
        }
        catch (error) {
            return await this.halt(op, error);
        }
        if (accepted !== true)
            return { operation: await this.save(op, { state: "failed_before_effect",
                    failure: saFailure("sa_gasless_approval_rejected") }, new Date(now).toISOString()) };
        const at = new Date(now).toISOString();
        op = await this.save(op, { state: "execution_pending", approval: { fingerprint: op.fingerprint,
                approvedAt: at, expiresAt: op.intent.expiresAt } }, at);
        return await this.run(op);
    }
    async run(input) {
        let op = input;
        if (op.terminal || op.state === "awaiting_approval")
            return { operation: op };
        // Durable exposure is the sole recovery boundary. No custody or provider read is needed afterward.
        if (op.exposureAttempts === 1)
            return await this.observe(op);
        if (!["execution_pending", "material_pending", "material_sealed"].includes(op.state) || op.approval === null)
            saFail("sa_gasless_state_corrupt");
        let writing = false;
        const persist = async (patch, at = new Date(this.clock.check(op)).toISOString()) => {
            writing = true;
            op = await this.save(op, patch, at);
            writing = false;
            this.clock.check(op);
        };
        try {
            this.clock.check(op);
            let sealed;
            if (op.signingAttempts === 1) {
                const recovered = await this.material.load(op);
                this.clock.check(op);
                if (recovered === null) {
                    if (op.material !== null)
                        saFail("sa_gasless_state_corrupt");
                    return await this.halt(op, saError("sa_gasless_material_unavailable"));
                }
                sealed = this.checkSeal(op, recovered);
            }
            else {
                await this.guard(op, true);
                assertSmartAccountGaslessCapacity(op);
                await persist({ state: "material_pending", signingAttempts: 1 }, new Date(this.clock.signing(op)).toISOString());
                this.clock.signing(op);
                // Only this invocation made the durable 0 -> 1 marker. No restart enters this branch.
                sealed = this.checkSeal(op, await this.material.seal(op));
            }
            this.clock.check(op, [sealed.descriptor.sealedAt]);
            if (op.material === null)
                await persist({ state: "material_sealed", material: sealed.descriptor });
            this.clock.live(op);
            await this.guard(op, false, sealed);
            assertSmartAccountGaslessCapacity(op);
            const exposureAt = new Date(this.clock.live(op)).toISOString();
            await persist({ state: "exposure_pending", exposureAttempts: 1, exposureStartedAt: exposureAt }, exposureAt);
            const exposed = await this.material.markExposed(op, sealed);
            this.clock.live(op);
            if (exposed.phase !== "exposed" || !saSame(exposed.descriptor, sealed.descriptor) ||
                !saSame(exposed.paymentPayload, sealed.paymentPayload))
                saFail("sa_gasless_state_corrupt");
            const verification = await this.provider.verify(op, exposed);
            this.clock.check(op, [verification.observedAt]);
            await persist({ state: "verified_pending", verification });
            // Only the immediate call that received this verify response may reach settle.
            await this.guard(op, false, exposed);
            const dispatchAt = new Date(this.clock.live(op)).toISOString();
            await persist({ state: "dispatch_pending", submissionAttempts: 1, dispatchStartedAt: dispatchAt }, dispatchAt);
            this.clock.live(op);
            const providerSettlement = await this.provider.settle(op, exposed);
            this.clock.check(op, [providerSettlement.observedAt]);
            await persist({ state: "submitted_pending", providerSettlement });
        }
        catch (error) {
            const failure = saClassify(error, "sa_gasless_internal");
            // An operation-first write may already be durable. A rejected write never authorizes another write or effect here.
            if (writing || failure.reason === "sa_gasless_state_corrupt")
                throw saError(failure.reason);
            if (op.exposureAttempts === 0)
                return await this.halt(op, error);
            if (failure.reason === "sa_gasless_clock" || failure.reason === "sa_gasless_capacity")
                return { operation: op, warning: failure };
            return await this.observe(op, failure.reason);
        }
        return await this.observe(op);
    }
    checkSeal(op, material) {
        saExact(material, ["descriptor", "paymentPayload", "phase"]);
        if (material.phase !== "sealed" || (op.material !== null && !saSame(op.material, material.descriptor)))
            saFail("sa_gasless_state_corrupt");
        // The material adapter authenticates the payload; this independent journal check binds every public hash to this operation.
        if (op.material === null)
            advanceSmartAccountGaslessOperation(op, { state: "material_sealed", material: material.descriptor }, material.descriptor.sealedAt);
        return material;
    }
    rpc(op) {
        const rpc = this.rpcFor(op.intent.request.chainId);
        if (rpc.chainId !== op.intent.request.chainId || rpc.endpointHash !== op.intent.initialSnapshot.endpointHash ||
            rpc.endpointOrigin !== op.intent.initialSnapshot.endpointOrigin)
            saFail("sa_gasless_rpc_binding");
        return rpc;
    }
    async guard(op, signing, material) {
        this.clock.live(op);
        const owner = await smartAccountGaslessOwner(this.state, op.intent.profile, op.intent.binding);
        this.clock.live(op);
        const binding = assertSmartAccountGaslessBinding(await this.material.inspect(owner, Math.floor(this.clock.live(op) / 1000)), owner);
        this.clock.live(op);
        if (!saSame(binding, op.intent.binding) || saPolicyHash(binding, op.intent.request) !== op.intent.policyHash)
            saFail("sa_gasless_identity");
        const rpc = this.rpc(op);
        const snapshot = smartAccountGaslessSnapshot(await rpc.snapshot(binding, op.intent.initialSnapshot.preparationBlock), binding, rpc, op);
        this.clock.fresh(snapshot.observedAt, op);
        this.clock.live(op);
        if (material !== undefined) {
            await rpc.assertUnspent({ binding, material: material.descriptor, safeBlock: snapshot.safeBlock });
            this.clock.live(op);
        }
        this.clock.fresh(op.intent.provider.observedAt, op);
        if (signing)
            this.clock.signing(op);
        else
            this.clock.live(op);
    }
    async observe(op, priorFailure, observer) {
        try {
            this.clock.check(op);
            if (op.material === null || op.exposureAttempts !== 1)
                saFail("sa_gasless_state_corrupt");
            let limited = false;
            try {
                assertSmartAccountGaslessCapacity(op);
            }
            catch (error) {
                if (saClassify(error, "sa_gasless_internal").reason !== "sa_gasless_capacity")
                    throw error;
                limited = true;
            }
            let chain;
            try {
                chain = await (observer?.rpc ?? this.rpc(op)).observe({ operationId: op.operationId, fingerprint: op.fingerprint, intent: op.intent,
                    material: op.material, cursor: op.cursor, transactionHint: op.providerSettlement?.transactionHash ?? null });
                saExact(chain, ["cursor", "observation", "settlement", "unusedProof"], "sa_gasless_evidence");
                if (observer !== undefined)
                    chain = { ...chain, observation: { ...chain.observation, source: observationSource(observer) } };
                this.clock.check(op, [chain.observation.observedAt, ...(chain.settlement === null ? [] : [chain.settlement.observedAt]),
                    ...(chain.unusedProof === null ? [] : [chain.unusedProof.observedAt])]);
            }
            catch (error) {
                const failure = saClassify(error, "sa_gasless_rpc_unavailable");
                if (failure.reason === "sa_gasless_clock")
                    throw error;
                const at = new Date(this.clock.check(op)).toISOString();
                chain = { cursor: op.cursor, settlement: null, unusedProof: null, observation: { observedAt: at,
                        phase: failure.reason === "sa_gasless_evidence" || failure.reason === "sa_gasless_rpc_binding" ? "invalid" : "unavailable",
                        reason: failure.reason, candidateTxHash: op.observation?.candidateTxHash ?? null, evidenceHash: null,
                        ...(observer === undefined ? {} : { source: observationSource(observer) }) } };
            }
            const patch = this.decide(chain, priorFailure ?? op.failure?.reason);
            // A full terminal proof may still use the reserved space even after routine progress reaches its cap.
            if (limited && patch.state !== "completed" && patch.state !== "expired_unused")
                return { operation: op, warning: saFailure("sa_gasless_capacity") };
            const at = new Date(this.clock.check(op, [chain.observation.observedAt])).toISOString();
            // Validate untrusted observation evidence before entering the durable write boundary.
            try {
                advanceSmartAccountGaslessOperation(op, patch, at);
            }
            catch (error) {
                if (saClassify(error, "sa_gasless_evidence").reason === "sa_gasless_capacity")
                    throw error;
                throw saError("sa_gasless_evidence");
            }
            return { operation: await this.save(op, patch, at) };
        }
        catch (error) {
            const failure = saClassify(error, "sa_gasless_internal");
            if (failure.reason === "sa_gasless_clock" || failure.reason === "sa_gasless_capacity")
                return { operation: op, warning: failure };
            throw saError(failure.reason);
        }
    }
    decide(chain, prior) {
        const base = { cursor: chain.cursor, observation: chain.observation };
        if (chain.observation.phase === "success" && chain.settlement !== null && chain.unusedProof === null)
            return { ...base, state: "completed", settlement: chain.settlement, failure: null };
        if (chain.observation.phase === "expired_unused" && chain.unusedProof !== null && chain.settlement === null)
            return { ...base, state: "expired_unused", unusedProof: chain.unusedProof, failure: null };
        if (chain.settlement !== null || chain.unusedProof !== null || ["success", "expired_unused"].includes(chain.observation.phase))
            saFail("sa_gasless_evidence");
        const reason = chain.observation.phase === "pending" ? prior ?? chain.observation.reason ?? "sa_gasless_unknown" :
            chain.observation.reason ?? "sa_gasless_unknown";
        return { ...base, state: "unknown_finality", failure: saFailure(reason) };
    }
    async halt(op, error) {
        const failure = saClassify(error, "sa_gasless_internal");
        if (op.exposureAttempts !== 0 || failure.reason === "sa_gasless_state_corrupt")
            throw saError("sa_gasless_state_corrupt");
        if (failure.reason === "sa_gasless_capacity" || (failure.reason === "sa_gasless_clock" && op.signingAttempts === 1))
            return { operation: op, warning: failure };
        return { operation: await this.save(op, { state: "failed_before_effect", failure }, this.clock.failureAt(op)) };
    }
}
function observationSource(observer) {
    return { environmentName: observer.environmentName, endpointOrigin: observer.rpc.endpointOrigin, endpointHash: observer.rpc.endpointHash };
}
//# sourceMappingURL=execution.js.map