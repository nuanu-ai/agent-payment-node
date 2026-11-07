import { canonicalJson } from "../canonical.js";
import { isEvmTransactionHash } from "../rail-status-binding.js";
import { BRIDGE_CLOSING_TRANSITIONS, BRIDGE_HISTORY_LIMIT, BRIDGE_TERMINAL } from "./operation-model.js";
/** The state store refuses to read a larger file: canonical JSON and its newline. */
export const BRIDGE_FILE_LIMIT = 1024 * 1024;
/**
 * Room an ordinary transition leaves for the closing ones. Each transition copies the whole mutable state, 10-12 KiB
 * once the source proofs exist, so this holds the few closing proofs a resume can add and the terminal transition.
 */
const CLOSING_RESERVE_BYTES = 128 * 1024;
/** Room a closing proof leaves for the terminal transition (one more copy of the state and its new top-level fields). */
const TERMINAL_RESERVE_BYTES = 32 * 1024;
export function bridgeTransitionKind(previous, next) {
    if (BRIDGE_TERMINAL.includes(next.state))
        return "terminal";
    const safeProof = next.effects.some((effect, index) => effect.safeProof !== null && previous.effects[index]?.safeProof === null);
    const destinationProof = previous.destinationProof === null && next.destinationProof !== null;
    return safeProof || destinationProof || newDestinationHint(previous.providerObservation, next.providerObservation) ? "closing" : "ordinary";
}
function newDestinationHint(previous, next) {
    if (next === null || !isEvmTransactionHash(next.destinationTransactionHash))
        return false;
    return previous === null || previous.destinationTransactionHash !== next.destinationTransactionHash || (settled(next) && !settled(previous));
}
function settled(observation) {
    return observation.status === "completed_observed" || observation.status === "partial_observed";
}
const MAX_TRANSITIONS = { ordinary: BRIDGE_HISTORY_LIMIT,
    closing: BRIDGE_HISTORY_LIMIT + BRIDGE_CLOSING_TRANSITIONS - 1, terminal: BRIDGE_HISTORY_LIMIT + BRIDGE_CLOSING_TRANSITIONS };
const RESERVE_BYTES = { ordinary: CLOSING_RESERVE_BYTES,
    closing: TERMINAL_RESERVE_BYTES, terminal: 0 };
/** Whether a journal of `transitions` entries may end with a transition of `kind`. */
export function bridgeHistoryAdmits(kind, transitions) {
    return transitions <= MAX_TRANSITIONS[kind];
}
/** The capacity reason that refuses `record`, whose newest transition is of `kind`; null when it may be written. */
export function bridgeCapacityRefusal(kind, record) {
    if (!bridgeHistoryAdmits(kind, record.transitions.length))
        return "bridge_history_capacity";
    return Buffer.byteLength(canonicalJson(record), "utf8") + 1 + RESERVE_BYTES[kind] > BRIDGE_FILE_LIMIT ? "bridge_record_capacity" : null;
}
//# sourceMappingURL=history-capacity.js.map