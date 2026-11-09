import { hashObject } from "../canonical.js";
import { bridgeBoundedEvidence, bridgeCapacityRefusal, bridgeTransitionKind } from "./history-capacity.js";
import { BRIDGE_TELEMETRY_ROWS, BRIDGE_TERMINAL, bridgeIntentBinding, bridgeSnapshot, sealBridgeOperation } from "./operation-model.js";
import { validateBridgeContinuity, validateBridgeOperation } from "./operation-validation.js";
import { bridgeFailure, bridgeSame } from "./validation.js";
export function newBridgeOperation(input) {
    const immutable = { schemaVersion: "apn.bridge-operation.v1", kind: "bridge_route", ...input };
    const fingerprint = hashObject(bridgeIntentBinding(immutable));
    const mutable = { state: "awaiting_approval", approval: null, effects: input.effects, sourceProof: null,
        destinationProof: null, providerObservation: null, failure: null, usageLease: null, observationTelemetry: [],
        destinationScan: { startBlock: input.intent.destinationStartBlock, nextBlockAtomic: input.intent.destinationStartBlock.numberAtomic, previousEndBlock: null } };
    const transition = { ...bridgeSnapshot(mutable), at: input.intent.preparedAt, previousHash: fingerprint };
    const result = sealBridgeOperation({ ...immutable, ...mutable, fingerprint, createdAt: input.intent.preparedAt,
        updatedAt: input.intent.preparedAt, terminal: false, transitions: [{ ...transition, transitionHash: hashObject(transition) }] });
    return validateBridgeOperation(result);
}
export function transitionBridge(op, patch, at) {
    // `op` is validated by the continuity check below (and when it was loaded); the pure steps before it read nothing unsafe.
    const merged = { ...op, ...patch };
    // Telemetry is bounded and overwritten: the next transition keeps only the latest rows, so the journal cannot grow with polls.
    const next = merged.observationTelemetry === undefined ? merged
        : { ...merged, observationTelemetry: merged.observationTelemetry.slice(-BRIDGE_TELEMETRY_ROWS) };
    const oldMeaning = bridgeSnapshot(op), newMeaning = bridgeSnapshot(next);
    // Poll timestamps and read telemetry alone are not evidence changes and cannot grow the journal.
    const observationMeaning = (s) => ({ ...s, observationTelemetry: undefined, providerObservation: s.providerObservation === null ? null : {
            ...s.providerObservation, observedAt: "", responseHash: null,
        } });
    if (bridgeSame(observationMeaning(oldMeaning), observationMeaning(newMeaning)))
        return op;
    // Ordinary transitions stop short of the bounds, keeping room for closing proofs and the terminal transition.
    const kind = bridgeTransitionKind(oldMeaning, newMeaning);
    let result = appended(op, next, at), refusal = bridgeCapacityRefusal(kind, result, false);
    if (refusal === "bridge_record_capacity" && kind !== "ordinary" && (next.observationTelemetry?.length ?? 0) > 0) {
        // Telemetry is diagnostics, not evidence: a closing or terminal transition drops its rows rather than go unrecorded.
        result = appended(op, { ...next, observationTelemetry: [] }, at);
        refusal = bridgeCapacityRefusal(kind, result, false);
    }
    // Only then may bounded evidence or the terminal transition pass the 1 MiB bound that earlier releases read: a journal
    // 0.5.96 filled has no reserve for them. A new provider hint never does; it is carried to the end (observation.ts).
    if (refusal === "bridge_record_capacity" && (kind === "terminal" || bridgeBoundedEvidence(oldMeaning, newMeaning))) {
        refusal = bridgeCapacityRefusal(kind, result, true);
    }
    if (refusal !== null)
        bridgeFailure("APN_OPERATION_BLOCKED", refusal, {});
    validateBridgeContinuity(op, result);
    return result;
}
function appended(op, next, at) {
    const entry = { ...bridgeSnapshot(next), at, previousHash: op.transitions.at(-1).transitionHash };
    const { integrityHash: _old, ...body } = next;
    return sealBridgeOperation({ ...body, updatedAt: at, terminal: BRIDGE_TERMINAL.includes(next.state),
        transitions: [...op.transitions, { ...entry, transitionHash: hashObject(entry) }] });
}
export function bridgeAtTransition(op, index) {
    const s = op.transitions[index];
    if (s === undefined)
        bridgeFailure("APN_STATE_CORRUPT", "bridge_history_index");
    const { at, previousHash: _p, transitionHash: _t, ...mutable } = s;
    const { integrityHash: _old, ...body } = op, reconstructed = { ...body, ...mutable };
    // Optional mutable fields absent from an older snapshot must remain absent when reconstructing its exact integrity
    // binding; spreading the current operation first would otherwise leak a later telemetry value backwards in time.
    if (!Object.hasOwn(mutable, "observationTelemetry"))
        delete reconstructed.observationTelemetry;
    return sealBridgeOperation({ ...reconstructed, effects: mutable.effects.map(({ envelopeHash: _h, ...e }, i) => ({ ...e, envelope: op.effects[i].envelope })), updatedAt: at, terminal: BRIDGE_TERMINAL.includes(mutable.state),
        transitions: op.transitions.slice(0, index + 1) });
}
//# sourceMappingURL=transitions.js.map