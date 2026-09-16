import { metaMaskGaslessApprovalPhrase, metaMaskGaslessApprovalSummary } from "./approval.js";
import { validateMetaMaskGaslessSnapshot } from "./chain/snapshot.js";
import { MetaMaskGaslessClock } from "./clock.js";
import { mmDispatchIntent } from "./dispatch.js";
import { mmPolicyHash, mmRepriceWithinCap } from "./economics.js";
import { mmAssertSameBinding } from "./identity.js";
import { assertMetaMaskGaslessDispatchCapacity } from "./journal/transitions.js";
import { MM_MIN_REMAINING_MS } from "./model.js";
import { MetaMaskGaslessObservationService, metaMaskGaslessProviderObservation } from "./observation.js";
import { metaMaskGaslessOwner } from "./owner.js";
import { metaMaskGaslessQuote } from "./quotation.js";
import { mmClassify, mmFail, mmFailure } from "./reasons.js";
import { mmValidateUnsigned } from "./unsigned.js";
import { mmSame } from "./validation.js";
/** A transient check failure is waited out inside the window the owner approved, never past it. */
const MM_GUARD_ATTEMPTS = 18, MM_GUARD_RETRY_MS = 5_000;
const MM_TRANSIENT_REASONS = new Set(["mm_gasless_provider_unavailable",
    "mm_gasless_rpc_unavailable", "mm_gasless_state_busy", "mm_gasless_quote_unstable"]);
export class MetaMaskGaslessExecution {
    state;
    rpcFor;
    provider;
    save;
    wait;
    clock;
    observation;
    constructor(state, rpcFor, provider, clock, save, wait) {
        this.state = state;
        this.rpcFor = rpcFor;
        this.provider = provider;
        this.save = save;
        this.wait = wait;
        this.clock = new MetaMaskGaslessClock(clock);
        this.observation = new MetaMaskGaslessObservationService(state, rpcFor, provider, this.clock, save);
    }
    /** Observation through an owner-named RPC; approval and dispatch keep the frozen endpoint. */
    async observeWith(op, observer) {
        return await new MetaMaskGaslessObservationService(this.state, this.rpcFor, this.provider, this.clock, this.save, observer).run(op);
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
                const guarded = await this.steady(op, async () => await this.guard(op));
                assertMetaMaskGaslessDispatchCapacity(op);
                const at = new Date(this.clock.beforeDispatchAtCurrent(op, guarded.observedAt)).toISOString();
                // Persistence must finish before starting any relay-capable helper.
                markerWriteStarted = true;
                op = await this.save(op, { state: "dispatch_pending", submissionAttempts: 1,
                    dispatchStartedAt: at, dispatch: guarded.dispatch, failure: null }, at);
                try {
                    const now = this.clock.check(op);
                    if (now >= Date.parse(op.intent.expiresAt))
                        mmFail("mm_gasless_expired");
                    const value = await this.provider.submit(mmDispatchIntent(op));
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
    /**
     * Every check between the owner's approval and the dispatch marker, re-taken now. The prepared snapshot is
     * identity and designation evidence; the dispatch clock runs on the read taken here. The owner approved a
     * maximum, so a fresh quote inside that maximum is priced at execution and its delegation re-derived.
     */
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
        let current = await this.chainState(op, rpc, op.intent.delegationHash);
        const fresh = mmRepriceWithinCap(await metaMaskGaslessQuote(this.provider, binding, op.intent.request, rpc.rpcUrl, this.clock), op.intent.request, binding);
        this.clock.check(op);
        let dispatch = null;
        if (!mmSame(fresh, op.intent.quote)) {
            dispatch = { quote: fresh, ...await this.redelegate(op, binding, fresh) };
            // The permission counter is keyed by the delegation, so the repriced one is proven unconsumed in its own right.
            current = await this.chainState(op, rpc, dispatch.delegationHash);
        }
        this.clock.beforeDispatchAtCurrent(op, current.observedAt);
        return { observedAt: current.observedAt, dispatch };
    }
    /** The provider builds the unsigned delegation over the repriced batch; APN verifies it independently. */
    async redelegate(op, binding, quote) {
        const input = { owner: binding.address, chainId: op.intent.request.chainId, executions: quote.executions };
        const unsigned = mmValidateUnsigned(await this.provider.buildUnsigned(input), input);
        this.clock.check(op);
        return unsigned;
    }
    async chainState(op, rpc, delegationHash) {
        const snapshot = await rpc.snapshot({ owner: op.intent.binding.address, delegationHash,
            grossAtomic: op.intent.request.grossAtomic });
        this.clock.check(op);
        const current = validateMetaMaskGaslessSnapshot(snapshot, { chainId: op.intent.request.chainId,
            endpointHash: rpc.endpointHash, endpointOrigin: rpc.endpointOrigin, grossAtomic: op.intent.request.grossAtomic });
        this.clock.beforeDispatchAtCurrent(op, current.observedAt);
        for (const key of ["safeState", "headState"]) {
            if (current[key].ownerCodeHash !== op.intent.initialSnapshot[key].ownerCodeHash ||
                current[key].designation !== op.intent.initialSnapshot[key].designation)
                mmFail("mm_gasless_rpc_binding");
        }
        return current;
    }
    /**
     * A rate limit, a transport failure or a price move above the owner's maximum is waited out while the approved
     * window still leaves room for the dispatch itself. An interrupt, an exhausted window and every definite
     * refusal end the operation at once, and nothing here can run once the marker write has started.
     */
    async steady(op, act) {
        for (let attempt = 1;; attempt += 1) {
            try {
                return await act();
            }
            catch (error) {
                if (attempt >= MM_GUARD_ATTEMPTS || !transient(error) ||
                    Date.parse(op.intent.expiresAt) - this.clock.check(op) <= MM_MIN_REMAINING_MS + MM_GUARD_RETRY_MS ||
                    await this.wait.wait(MM_GUARD_RETRY_MS) === "interrupted")
                    throw error;
            }
        }
    }
    async halt(op, error) {
        // A check that could not complete names the guard; the unknown token stays reserved for an unclassified failure.
        const failure = mmClassify(error, "mm_gasless_guard_unavailable");
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
function transient(error) {
    const reason = mmClassify(error, "mm_gasless_guard_unavailable").reason;
    // A quote above the owner's maximum can fall back inside it; a balance below the transfer cannot.
    return MM_TRANSIENT_REASONS.has(reason) || reason === "mm_gasless_fee_cap";
}
//# sourceMappingURL=execution.js.map