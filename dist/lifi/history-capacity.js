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
 * Room past 1 MiB: one state copy for each of the BRIDGE_CLOSING_TRANSITIONS a journal may take past its released
 * bounds. Only bounded evidence (bridgeBoundedEvidence) and the terminal transition use it: at most three first proofs
 * (an effect's first safe proof, the destination proof; validation never lets a saved proof be replaced), at most two
 * lost inclusions (one per effect, see below) and the end. Each adds its own copy and the record's current state grows
 * by at most one copy in all: at most six copies before the end, within the seven an open journal may use, and seven
 * with it.
 */
const BRIDGE_OVERFLOW_BYTES = BRIDGE_CLOSING_TRANSITIONS * BRIDGE_STATE_COPY_BYTES;
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
 * Whether `next` records closing evidence that past the ordinary bounds can occur only a bounded number of times, unlike
 * a provider hint, which can name a new transaction again:
 * - an effect's first safe proof or the destination proof: validation never lets a saved proof be replaced;
 * - an effect losing the inclusion it had recorded before it was safe (a reorg moved it, or it vanished). The phase
 *   rules need this transition before a safe proof at another block. It follows a recorded unsafe inclusion, an
 *   ordinary transition. It takes a slot past 512 transitions, or room past 1 MiB only beyond the closing reserve's
 *   line; the count never falls, and a file never shrinks by more than one copy (only its current state can), less than
 *   the 96 KiB from that line down to the ordinary one. So from there no unsafe inclusion is recorded again, and each
 *   effect loses one at most once.
 */
export function bridgeBoundedEvidence(previous, next) {
    return next.effects.some((effect, index) => {
        const before = previous.effects[index];
        return before !== undefined && (effect.safeProof !== null && before.safeProof === null ||
            before.includedProof !== null && before.safeProof === null && effect.includedProof === null);
    }) || (previous.destinationProof === null && next.destinationProof !== null);
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