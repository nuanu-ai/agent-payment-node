import { metaMaskGaslessApprovalPhrase, metaMaskGaslessApprovalSummary } from "./approval.js";
import { validateMetaMaskGaslessSnapshot } from "./chain/snapshot.js";
import { MetaMaskGaslessClock } from "./clock.js";
import { mmPolicyHash, mmQuote } from "./economics.js";
import { mmAssertSameBinding } from "./identity.js";
import { assertMetaMaskGaslessDispatchCapacity } from "./journal/transitions.js";
import { MetaMaskGaslessObservationService, metaMaskGaslessProviderObservation } from "./observation.js";
import { metaMaskGaslessOwner } from "./owner.js";
import { mmClassify, mmFail, mmFailure } from "./reasons.js";
import { mmSame } from "./validation.js";
export class MetaMaskGaslessExecution {
    state;
    rpcFor;
    provider;
    save;
    clock;
    observation;
    constructor(state, rpcFor, provider, clock, save) {
        this.state = state;
        this.rpcFor = rpcFor;
        this.provider = provider;
        this.save = save;
        this.clock = new MetaMaskGaslessClock(clock);
        this.observation = new MetaMaskGaslessObservationService(state, rpcFor, provider, this.clock, save);
    }
    async approve(op, approval) {
        if (op.terminal || op.state !== "awaiting_approval")
            return { operation: op };
        let now;
        try {
            now = this.clock.beforeApproval(op);
        }
        catch (error) {
            return await this.halt(op, error);
        }
        // A missing TTY/response throws from the port and leaves awaiting_approval untouched.
        let accepted;
        try {
            accepted = await approval.confirm({ operationId: op.operationId, fingerprint: op.fingerprint,
                exactPhrase: metaMaskGaslessApprovalPhrase(op), summary: metaMaskGaslessApprovalSummary(op, now) });
        }
        catch (error) {
            try {
                this.clock.check(op);
            }
            catch (clockError) {
                return await this.halt(op, clockError);
            }
            if (mmClassify(error, "mm_gasless_approval").reason === "mm_gasless_expired")
                return await this.halt(op, error);
            throw error;
        }
        try {
            now = this.clock.check(op);
            if (accepted)
                now = this.clock.beforeApproval(op);
        }
        catch (error) {
            return await this.halt(op, error);
        }
        if (!accepted)
            return { operation: await this.save(op, { state: "failed_before_effect",
                    failure: mmFailure("mm_gasless_approval") }, new Date(now).toISOString()) };
        const at = new Date(now).toISOString();
        op = await this.save(op, { state: "execution_pending", approval: { fingerprint: op.fingerprint,
                approvedAt: at, expiresAt: op.intent.expiresAt } }, at);
        return await this.run(op);
    }
    async run(op) {
        if (op.terminal || op.state === "awaiting_approval")
            return { operation: op };
        if (op.submissionAttempts === 1)
            return await this.observation.run(op);
        if (op.state !== "execution_pending" || op.approval === null || op.approval.fingerprint !== op.fingerprint) {
            mmFail("mm_gasless_state_corrupt");
        }
        let submitted;
        let markerWriteStarted = false;
        try {
            const result = await this.state.withLocks(["provider-session:metamask-agent-wallet"], async () => {
                const observedAt = await this.guard(op);
                assertMetaMaskGaslessDispatchCapacity(op);
                const at = new Date(this.clock.beforeDispatch(op, observedAt)).toISOString();
                // Persistence must finish before starting any relay-capable helper.
                markerWriteStarted = true;
                op = await this.save(op, { state: "dispatch_pending", submissionAttempts: 1,
                    dispatchStartedAt: at, failure: null }, at);
                try {
                    const now = this.clock.check(op);
                    if (now >= Date.parse(op.intent.expiresAt))
                        mmFail("mm_gasless_expired");
                    const value = await this.provider.submit(op.intent);
                    this.clock.check(op);
                    const hint = metaMaskGaslessProviderObservation(value, op);
                    this.clock.check(op, [hint.observedAt]);
                    return { hint, failure: null };
                }
                catch (error) {
                    if (mmClassify(error, "mm_gasless_submit_unknown").reason === "mm_gasless_clock")
                        throw error;
                    this.clock.check(op);
                    return { hint: null, failure: "mm_gasless_submit_unknown" };
                }
            });
            this.clock.check(op);
            submitted = result;
        }
        catch (error) {
            if (op.submissionAttempts === 0 && !markerWriteStarted)
                return await this.halt(op, error);
            if (op.submissionAttempts === 0)
                throw error;
            const failure = mmClassify(error, "mm_gasless_submit_unknown");
            if (failure.reason === "mm_gasless_clock" || failure.reason === "mm_gasless_record_capacity") {
                return { operation: op, warning: failure };
            }
            // A storage failure is not permission to re-save an uncertain marker or POST.
            throw error;
        }
        return await this.observation.run(op, submitted);
    }
    async guard(op) {
        this.clock.beforeApproval(op);
        const owner = await metaMaskGaslessOwner(this.state, op.intent.profile, op.intent.binding);
        this.clock.check(op);
        const binding = await this.provider.inspect(owner);
        this.clock.check(op);
        mmAssertSameBinding(binding, op.intent.binding);
        if (op.intent.policyHash !== mmPolicyHash(op.profileHash, binding, op.intent.request))
            mmFail("mm_gasless_binding_changed");
        const rpc = this.rpcFor(op.intent.request.chainId);
        if (rpc.chainId !== op.intent.request.chainId || rpc.endpointHash !== op.intent.initialSnapshot.endpointHash ||
            rpc.endpointOrigin !== op.intent.initialSnapshot.endpointOrigin)
            mmFail("mm_gasless_rpc_binding");
        const snapshot = await rpc.snapshot({ owner: binding.address, delegationHash: op.intent.delegationHash,
            grossAtomic: op.intent.request.grossAtomic });
        this.clock.check(op);
        const current = validateMetaMaskGaslessSnapshot(snapshot, { chainId: op.intent.request.chainId,
            endpointHash: rpc.endpointHash, endpointOrigin: rpc.endpointOrigin, grossAtomic: op.intent.request.grossAtomic });
        this.clock.beforeDispatch(op, current.observedAt);
        for (const key of ["safeState", "headState"]) {
            if (current[key].ownerCodeHash !== op.intent.initialSnapshot[key].ownerCodeHash ||
                current[key].designation !== op.intent.initialSnapshot[key].designation)
                mmFail("mm_gasless_rpc_binding");
        }
        const value = await this.provider.quote({ binding, chainId: op.intent.request.chainId, token: op.intent.token,
            recipient: op.intent.request.recipient, netAtomic: op.intent.quote.netAtomic, rpcUrl: rpc.rpcUrl });
        this.clock.check(op);
        const quote = mmQuote(value, op.intent.request, binding, op.intent.quote.netAtomic);
        if (!mmSame(quote, op.intent.quote))
            mmFail("mm_gasless_quote_invalid");
        this.clock.beforeDispatch(op, current.observedAt);
        return current.observedAt;
    }
    async halt(op, error) {
        const failure = mmClassify(error, "mm_gasless_internal");
        if (["mm_gasless_state_corrupt", "mm_gasless_state_security", "mm_gasless_state_busy"].includes(failure.reason))
            throw error;
        try {
            return { operation: await this.save(op, { state: "failed_before_effect", failure }, this.clock.failureAt(op)) };
        }
        catch (saveError) {
            const saveFailure = mmClassify(saveError, "mm_gasless_internal");
            if (saveFailure.reason === "mm_gasless_record_capacity")
                return { operation: op, warning: saveFailure };
            throw saveError;
        }
    }
}
//# sourceMappingURL=execution.js.map