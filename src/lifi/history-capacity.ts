import { canonicalJson } from "../canonical.js";
import { ApnError } from "../errors.js";
import { isEvmTransactionHash } from "../rail-status-binding.js";
import { BRIDGE_CLOSING_TRANSITIONS, BRIDGE_HISTORY_LIMIT, BRIDGE_TERMINAL, type BridgeEffectPhase, type BridgeOperationRecord,
  type BridgeTransition } from "./operation-model.js";
import type { BridgeProviderObservation } from "./model.js";

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
 * evidence (bridgeBoundedEvidence) or the end, never an ordinary transition: no effect starts signing and no ordinary
 * write records an unsafe inclusion after it. Each effect then has at most its three send steps, one lost inclusion and
 * its first safe proof left, and the bridge's send steps follow an approval already included: at most seven (the
 * approval's last two and the bridge's five), then the end, which saves the destination proof (observation.ts). That is
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

/**
 * `ordinary`: anything that can repeat without moving the operation toward its end (state flips between pending and
 * unknown, failure diagnostics, provider statuses that name nothing new, unsafe inclusions, an effect starting to sign
 * or releasing that start). `closing`: evidence that can only be added a bounded number of times (bridgeBoundedEvidence),
 * or a provider observation naming a destination transaction it had not named, or now settled. `terminal`: the end.
 */
export type BridgeTransitionKind = "ordinary" | "closing" | "terminal";
type Meaning = Pick<BridgeTransition, "state" | "effects" | "destinationProof" | "providerObservation">;

export function bridgeTransitionKind(previous: Meaning, next: Meaning): BridgeTransitionKind {
  if (BRIDGE_TERMINAL.includes(next.state)) return "terminal";
  return bridgeBoundedEvidence(previous, next) || newDestinationHint(previous.providerObservation, next.providerObservation) ? "closing" : "ordinary";
}
/**
 * Whether `next` records closing evidence each effect can add only a bounded number of times, unlike a provider hint,
 * which can name a new transaction again:
 * - an effect's first safe proof or the destination proof: validation never lets a saved proof be replaced;
 * - an effect's send steps after signing_started: entering sealed, entering submitting, leaving submitting, at most once
 *   each because the phase rules never return to those phases (signing_started itself can repeat through its release);
 * - an effect losing an inclusion it had recorded before it was safe (a reorg moved it, or it vanished); the phase rules
 *   need this before a safe proof at another block. Past 512 transitions, or after the last write that left a file at
 *   or under 1 MiB, no ordinary write is admitted, so an effect holds at most one unsafe inclusion to lose there: the one
 *   it had, or the one its single exit from submitting recorded.
 */
export function bridgeBoundedEvidence(previous: Meaning, next: Meaning): boolean {
  return next.effects.some((effect, index) => {
    const before = previous.effects[index];
    if (before === undefined) return false;
    const sendStep = before.phase !== effect.phase && SEND_PHASES.includes(before.phase) && effect.phase !== "unsealed";
    return sendStep || effect.safeProof !== null && before.safeProof === null ||
      before.includedProof !== null && before.safeProof === null && effect.includedProof === null;
  }) || (previous.destinationProof === null && next.destinationProof !== null);
}
const SEND_PHASES: readonly BridgeEffectPhase[] = ["signing_started", "sealed", "submitting"];
/** The transitions one effect's send writes from its SIGN claim: signing_started, sealed, submitting, then the save after the send. */
const SEND_TRANSITIONS = 4;
/** What each adds beyond a copy of the current state: two hashes, a time and longer phase names, in the copy and the record. */
const SEND_GROWTH_BYTES = 1024;
/**
 * Why an effect may not start its send now (null when it may): signing starts only with room for all its send
 * transitions under the ordinary bounds, so a routine send never needs the closing reserve or the room past 1 MiB.
 * Refused, nothing is signed or claimed, and the operation can only expire into its halt.
 */
export function bridgeSendRefusal(op: BridgeOperationRecord): "bridge_history_capacity" | "bridge_record_capacity" | null {
  if (op.transitions.length + SEND_TRANSITIONS > BRIDGE_HISTORY_LIMIT) return "bridge_history_capacity";
  const copy = bridgeFileBytes(op.transitions.at(-1)) + SEND_GROWTH_BYTES;
  return bridgeFileBytes(op) + SEND_TRANSITIONS * copy > BRIDGE_FILE_LIMIT - CLOSING_RESERVE_BYTES ? "bridge_record_capacity" : null;
}
function newDestinationHint(previous: BridgeProviderObservation | null, next: BridgeProviderObservation | null): boolean {
  if (next === null || !isEvmTransactionHash(next.destinationTransactionHash)) return false;
  return previous === null || previous.destinationTransactionHash !== next.destinationTransactionHash || (settled(next) && !settled(previous));
}
function settled(observation: BridgeProviderObservation): boolean {
  return observation.status === "completed_observed" || observation.status === "partial_observed";
}

const MAX_TRANSITIONS: Readonly<Record<BridgeTransitionKind, number>> = { ordinary: BRIDGE_HISTORY_LIMIT,
  closing: BRIDGE_HISTORY_LIMIT + BRIDGE_CLOSING_TRANSITIONS - 1, terminal: BRIDGE_HISTORY_LIMIT + BRIDGE_CLOSING_TRANSITIONS };
const RESERVE_BYTES: Readonly<Record<BridgeTransitionKind, number>> = { ordinary: CLOSING_RESERVE_BYTES,
  closing: TERMINAL_RESERVE_BYTES, terminal: 0 };

/** Whether a journal of `transitions` entries may end with a transition of `kind`. */
export function bridgeHistoryAdmits(kind: BridgeTransitionKind, transitions: number): boolean {
  return transitions <= MAX_TRANSITIONS[kind];
}
/**
 * The capacity reason that refuses `record`, whose newest transition is of `kind`; null when it may be written. With
 * `overflow` (for bounded evidence or the terminal transition only) it is measured against the room past 1 MiB instead.
 */
export function bridgeCapacityRefusal(kind: BridgeTransitionKind, record: BridgeOperationRecord,
  overflow: boolean): "bridge_history_capacity" | "bridge_record_capacity" | null {
  if (!bridgeHistoryAdmits(kind, record.transitions.length)) return "bridge_history_capacity";
  // An ordinary transition can repeat without end, so it never passes its reserve.
  const limit = !overflow || kind === "ordinary" ? BRIDGE_FILE_LIMIT - RESERVE_BYTES[kind] : bridgeFileLimit(kind === "terminal");
  return bridgeFileBytes(record) > limit ? "bridge_record_capacity" : null;
}
/** The hard bound the reader and the writer hold a journal file to. */
export function bridgeFileLimit(terminal: boolean): number {
  return terminal ? BRIDGE_TERMINAL_FILE_LIMIT : BRIDGE_OPEN_FILE_LIMIT;
}
export function bridgeFileBytes(value: unknown): number {
  return Buffer.byteLength(canonicalJson(value), "utf8") + 1;
}
/** Whether `error` is a journal capacity refusal: nothing was written, and the same change can be tried again later. */
export function bridgeCapacityRefused(error: unknown): boolean {
  return error instanceof ApnError && error.code === "APN_OPERATION_BLOCKED" &&
    (error.details?.reason === "bridge_history_capacity" || error.details?.reason === "bridge_record_capacity");
}
