import { canonicalJson } from "../canonical.js";
import { ApnError } from "../errors.js";
import { isEvmTransactionHash } from "../rail-status-binding.js";
import { BRIDGE_CLOSING_TRANSITIONS, BRIDGE_HISTORY_LIMIT, BRIDGE_TERMINAL } from "./operation-model.js";
/** The file bound every released reader admits (canonical JSON and its newline); 0.5.96 and earlier read nothing larger. */
export const BRIDGE_FILE_LIMIT = 1024 * 1024;
/**
 * The most one copy of the state takes in the file. A copy holds fixed-width proofs, blocks and hashes (6-12 KiB in
 * practice); its one long field, an Across message, is at most 24,578 hex characters (hexSchema), so even the largest
 * copy the schema admits, with its eight telemetry rows, stays under this.
 */
const BRIDGE_STATE_COPY_BYTES = 64 * 1024;
/**
 * Room past 1 MiB. After the last write that left a file at or under 1 MiB, every write passed it, so each was bounded
 * evidence (bridgeBoundedEvidence) or the end, never an ordinary transition. Each effect then has at most six bounded
 * steps left: its four send steps (entering signing_started, sealed and submitting, leaving submitting), one lost
 * inclusion and its first safe proof. Two effects and the end, which saves the destination proof (observation.ts), make
 * BRIDGE_CLOSING_TRANSITIONS transitions, as past 512. Each adds one copy and the current state grows by at most one copy
 * in all, so the room is one copy more.
 */
const BRIDGE_OVERFLOW_BYTES = (BRIDGE_CLOSING_TRANSITIONS + 1) * BRIDGE_STATE_COPY_BYTES;
/** The reader's bound for a terminal journal. 0.5.97 reads one only up to 1 MiB + 64 KiB, earlier releases up to 1 MiB. */
export const BRIDGE_TERMINAL_FILE_LIMIT = BRIDGE_FILE_LIMIT + BRIDGE_OVERFLOW_BYTES;
/**
 * The reader's bound for an open journal: bounded evidence past 1 MiB keeps one copy of room for the terminal
 * transition. 0.5.97 and earlier read an open journal only up to 1 MiB.
 */
export const BRIDGE_OPEN_FILE_LIMIT = BRIDGE_TERMINAL_FILE_LIMIT - BRIDGE_STATE_COPY_BYTES;
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
    return bridgeBoundedEvidence(previous, next) || newDestinationHint(previous.providerObservation, next.providerObservation) ? "closing" : "ordinary";
}
/**
 * Whether `next` records closing evidence each effect can add only a bounded number of times, unlike a provider hint,
 * which can name a new transaction again:
 * - an effect's first safe proof or the destination proof: validation never lets a saved proof be replaced;
 * - an effect's send steps: entering signing_started, sealed and submitting, and leaving submitting. The last three
 *   happen at most once each, since the phase rules never return to those phases. An effect re-enters signing_started
 *   only after its release, which is ordinary (or folded into a terminal halt), so past 512 transitions, or after the
 *   last write that left a file at or under 1 MiB, it enters signing_started at most once more: the step the catch-up
 *   of a recorded SEND claim needs on a restored journal (execution.ts). A normal send starts only with room for all its
 *   steps under the ordinary bounds (bridgeSendRefusal), so it never takes the closing room;
 * - an effect losing an inclusion it had recorded before it was safe (a reorg moved it, or it vanished); the phase rules
 *   need this before a safe proof at another block. Past 512 transitions, or after the last write that left a file at
 *   or under 1 MiB, no ordinary write is admitted, so an effect holds at most one unsafe inclusion to lose there: the one
 *   it had, or the one its single exit from submitting recorded.
 */
export function bridgeBoundedEvidence(previous, next) {
    return next.effects.some((effect, index) => {
        const before = previous.effects[index];
        if (before === undefined)
            return false;
        const sendStep = before.phase !== effect.phase && SEND_PHASES.includes(before.phase) && effect.phase !== "unsealed";
        return sendStep || effect.safeProof !== null && before.safeProof === null ||
            before.includedProof !== null && before.safeProof === null && effect.includedProof === null;
    }) || (previous.destinationProof === null && next.destinationProof !== null);
}
/** The phases a send step leaves; returning to unsealed (the release) is not one. */
const SEND_PHASES = ["unsealed", "signing_started", "sealed", "submitting"];
/** The transitions one effect's send writes from its SIGN claim: signing_started, sealed, submitting, then the save after the send. */
const SEND_TRANSITIONS = 4;
/** What each adds beyond a copy of the current state: two hashes, a time and longer phase names, in the copy and the record. */
const SEND_GROWTH_BYTES = 1024;
/**
 * Between one effect's send and the next effect's SIGN, the observations of its inclusion and its safe proof. Those and
 * the next effect's own steps copy a state that by then also holds that effect's two transaction proofs and up to eight
 * telemetry rows, at most this much more.
 */
const OBSERVATION_TRANSITIONS = 2, LATER_GROWTH_BYTES = 8 * 1024;
/**
 * Why the effect `role` may not start its send now (null when it may): signing starts only with room under the ordinary
 * bounds for its send and, when effects follow it, for the observations before each and their sends too. So the first
 * effect does not go out while a later one could not, and a routine send never needs the closing reserve or the room
 * past 1 MiB. Refused, nothing is signed or claimed, and the operation can only expire into its halt.
 */
export function bridgeSendRefusal(op, role) {
    const later = (op.effects.length - 1 - op.effects.findIndex((e) => e.role === role)) * (OBSERVATION_TRANSITIONS + SEND_TRANSITIONS);
    if (op.transitions.length + SEND_TRANSITIONS + later > BRIDGE_HISTORY_LIMIT)
        return "bridge_history_capacity";
    const copy = bridgeFileBytes(op.transitions.at(-1)) + SEND_GROWTH_BYTES;
    return bridgeFileBytes(op) + SEND_TRANSITIONS * copy + later * (copy + LATER_GROWTH_BYTES) > BRIDGE_FILE_LIMIT - CLOSING_RESERVE_BYTES
        ? "bridge_record_capacity" : null;
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
/**
 * The capacity reason that refuses `record`, whose newest transition is of `kind`; null when it may be written. With
 * `overflow` (for bounded evidence or the terminal transition only) it is measured against the room past 1 MiB instead.
 */
export function bridgeCapacityRefusal(kind, record, overflow) {
    if (!bridgeHistoryAdmits(kind, record.transitions.length))
        return "bridge_history_capacity";
    // An ordinary transition can repeat without end, so it never passes its reserve.
    const limit = !overflow || kind === "ordinary" ? BRIDGE_FILE_LIMIT - RESERVE_BYTES[kind] : bridgeFileLimit(kind === "terminal");
    return bridgeFileBytes(record) > limit ? "bridge_record_capacity" : null;
}
/** The hard bound the reader and the writer hold a journal file to. */
export function bridgeFileLimit(terminal) {
    return terminal ? BRIDGE_TERMINAL_FILE_LIMIT : BRIDGE_OPEN_FILE_LIMIT;
}
export function bridgeFileBytes(value) {
    return Buffer.byteLength(canonicalJson(value), "utf8") + 1;
}
/** Whether `error` is a journal capacity refusal: nothing was written, and the same change can be tried again later. */
export function bridgeCapacityRefused(error) {
    return error instanceof ApnError && error.code === "APN_OPERATION_BLOCKED" &&
        (error.details?.reason === "bridge_history_capacity" || error.details?.reason === "bridge_record_capacity");
}
//# sourceMappingURL=history-capacity.js.map