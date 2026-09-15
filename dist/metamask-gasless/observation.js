import { mmPrivateHash } from "./identity.js";
import { assertMetaMaskGaslessObservationCapacity } from "./journal/transitions.js";
import { metaMaskGaslessOwner } from "./owner.js";
import { mmClassify, mmFail, mmFailure } from "./reasons.js";
import { mmExact, mmHex, mmIso } from "./validation.js";
export function metaMaskGaslessProviderObservation(value, op) {
    const p = mmExact(value, ["observedAt", "requestIdHash", "status", "txHash"], "mm_gasless_evidence_invalid");
    mmIso(p.observedAt, "mm_gasless_evidence_invalid");
    if (p.requestIdHash !== mmPrivateHash("request-id", op.intent.requestId) ||
        !["awaiting_approval", "pending", "broadcasted", "confirmed", "failed", "unavailable"].includes(String(p.status)))
        mmFail("mm_gasless_evidence_invalid");
    if (p.txHash !== null)
        mmHex(p.txHash, 32, "mm_gasless_evidence_invalid");
    return p;
}
export class MetaMaskGaslessObservationService {
    state;
    rpcFor;
    provider;
    clock;
    save;
    observer;
    constructor(state, rpcFor, provider, clock, save, observer) {
        this.state = state;
        this.rpcFor = rpcFor;
        this.provider = provider;
        this.clock = clock;
        this.save = save;
        this.observer = observer;
    }
    async run(op, submitted) {
        if (op.terminal || op.submissionAttempts !== 1)
            return { operation: op };
        try {
            this.clock.check(op);
            assertMetaMaskGaslessObservationCapacity(op);
            const result = submitted ?? await this.readProvider(op);
            this.clock.check(op, result.hint === null ? [] : [result.hint.observedAt]);
            const providerObservation = this.retainProvider(op, result.hint);
            let chain;
            try {
                const rpc = this.observer?.rpc ?? this.rpcFor(op.intent.request.chainId);
                if (rpc.chainId !== op.intent.request.chainId || (this.observer === undefined &&
                    (rpc.endpointHash !== op.intent.initialSnapshot.endpointHash || rpc.endpointOrigin !== op.intent.initialSnapshot.endpointOrigin))) {
                    mmFail("mm_gasless_rpc_binding");
                }
                chain = await rpc.observe(op.intent, op.cursor, providerObservation);
                chain = { ...chain, observation: { ...chain.observation, ...this.source() } };
                this.clock.check(op, [chain.observation.observedAt,
                    ...(chain.settlement === null ? [] : [chain.settlement.observedAt])]);
            }
            catch (error) {
                const classified = mmClassify(error, "mm_gasless_rpc_unavailable").reason;
                if (classified === "mm_gasless_clock")
                    throw error;
                const invalid = ["mm_gasless_rpc_binding", "mm_gasless_evidence_invalid"].includes(classified);
                const reason = invalid ? classified : "mm_gasless_rpc_unavailable";
                const at = new Date(this.clock.check(op)).toISOString();
                chain = { cursor: op.cursor, settlement: null, observation: {
                        observedAt: at, phase: invalid ? "invalid" : "unavailable",
                        reason, candidateTxHash: op.observation?.candidateTxHash ?? null, transactionBlock: null,
                        finalityBlock: null, evidenceHash: null, ...this.source(),
                    } };
            }
            // An unavailable request cannot discard a previously independently usable locator.
            if (chain.observation.phase === "unavailable" && chain.observation.candidateTxHash === null &&
                op.observation?.candidateTxHash !== null && op.observation?.candidateTxHash !== undefined) {
                chain = { ...chain, observation: { ...chain.observation, candidateTxHash: op.observation.candidateTxHash } };
            }
            const patch = this.decide(op, chain, providerObservation, result.failure);
            const at = new Date(this.clock.check(op, [chain.observation.observedAt,
                ...(providerObservation === null ? [] : [providerObservation.observedAt])])).toISOString();
            return { operation: await this.save(op, patch, at) };
        }
        catch (error) {
            const failure = mmClassify(error, "mm_gasless_internal");
            if (failure.reason === "mm_gasless_clock" || failure.reason === "mm_gasless_record_capacity") {
                return { operation: op, warning: failure };
            }
            throw error;
        }
    }
    source() {
        const observer = this.observer;
        return observer === undefined ? {} : { source: { environmentName: observer.environmentName,
                endpointOrigin: observer.rpc.endpointOrigin, endpointHash: observer.rpc.endpointHash } };
    }
    async readProvider(op) {
        try {
            await metaMaskGaslessOwner(this.state, op.intent.profile, op.intent.binding);
            this.clock.check(op);
            const hint = await this.state.withLocks(["provider-session:metamask-agent-wallet"], async () => {
                this.clock.check(op);
                const value = await this.provider.observe(op.intent);
                this.clock.check(op);
                return metaMaskGaslessProviderObservation(value, op);
            });
            this.clock.check(op, [hint.observedAt]);
            return { hint, failure: null };
        }
        catch (error) {
            const reason = mmClassify(error, "mm_gasless_provider_unavailable").reason;
            if (reason === "mm_gasless_clock")
                throw error;
            this.clock.check(op);
            return { hint: null, failure: reason };
        }
    }
    retainProvider(op, current) {
        const previousHash = op.providerObservation?.txHash ?? null;
        if (current !== null)
            return { ...current, txHash: current.txHash ?? previousHash };
        if (op.providerObservation === null)
            return null;
        return { observedAt: new Date(this.clock.check(op)).toISOString(),
            requestIdHash: mmPrivateHash("request-id", op.intent.requestId), status: "unavailable", txHash: previousHash };
    }
    decide(op, chain, provider, providerFailure) {
        const base = { cursor: chain.cursor, observation: chain.observation, providerObservation: provider };
        if (chain.observation.phase === "success" && chain.settlement !== null) {
            return { ...base, state: "completed", settlement: chain.settlement, failure: null };
        }
        if (chain.settlement !== null || chain.observation.phase === "success")
            mmFail("mm_gasless_evidence_invalid");
        if (chain.observation.phase === "reverted") {
            return { ...base, state: "failed_effects_pending", failure: mmFailure("mm_gasless_transaction_reverted") };
        }
        if (op.state === "failed_effects_pending") {
            return { ...base, state: "failed_effects_pending", failure: mmFailure("mm_gasless_transaction_reverted") };
        }
        if (["invalid", "reorg", "unavailable"].includes(chain.observation.phase)) {
            if (chain.observation.reason === "mm_gasless_success")
                mmFail("mm_gasless_evidence_invalid");
            return { ...base, state: "unknown_finality", failure: mmFailure(chain.observation.reason) };
        }
        const usableHint = provider !== null && ["broadcasted", "confirmed"].includes(provider.status) &&
            provider.txHash !== null && provider.txHash === chain.observation.candidateTxHash;
        const reason = providerFailure ?? (provider?.status === "awaiting_approval" ? "mm_gasless_provider_approval" :
            provider?.status === "failed" ? "mm_gasless_provider_failed" :
                provider?.status === "unavailable" ? "mm_gasless_provider_unavailable" : "mm_gasless_pending");
        return { ...base, state: usableHint ? "submitted_pending" : "unknown_finality", failure: mmFailure(reason) };
    }
}
//# sourceMappingURL=observation.js.map