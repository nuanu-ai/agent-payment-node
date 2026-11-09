import { canonicalJson } from "../canonical.js";
import { ApnError } from "../errors.js";
import { isEvmTransactionHash } from "../rail-status-binding.js";
import { BRIDGE_CLOSING_TRANSITIONS, BRIDGE_HISTORY_LIMIT, BRIDGE_TERMINAL, type BridgeOperationRecord,
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
 * Room past 1 MiB: one state copy for each of the BRIDGE_CLOSING_TRANSITIONS a journal may take past its released
 * bounds. Only first proofs (an effect's first safe proof, the destination proof: evidence validation admits once, so
 * at most three) and the terminal transition use it. Each adds its own copy and the record's current state grows by at
 * most one copy in all, so a journal any release left within 1 MiB still records them with room to spare.
 */
const BRIDGE_OVERFLOW_BYTES = BRIDGE_CLOSING_TRANSITIONS * BRIDGE_STATE_COPY_BYTES;
/** The reader's bound for a terminal journal. 0.5.97 reads one only up to 1 MiB + 64 KiB, earlier releases up to 1 MiB. */
export const BRIDGE_TERMINAL_FILE_LIMIT = BRIDGE_FILE_LIMIT + BRIDGE_OVERFLOW_BYTES;
/**
 * The reader's bound for an open journal: a first proof past 1 MiB keeps one copy of room for the terminal transition.
 * 0.5.97 and earlier read an open journal only up to 1 MiB.
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
 * unknown, failure diagnostics, provider statuses that name nothing new, unsafe inclusions). `closing`: evidence that
 * can only be added a bounded number of times: an effect's first safe proof, the destination proof, or a provider
 * observation naming a destination transaction it had not named, or now settled. `terminal`: the operation's end.
 */
export type BridgeTransitionKind = "ordinary" | "closing" | "terminal";
type Meaning = Pick<BridgeTransition, "state" | "effects" | "destinationProof" | "providerObservation">;

export function bridgeTransitionKind(previous: Meaning, next: Meaning): BridgeTransitionKind {
  if (BRIDGE_TERMINAL.includes(next.state)) return "terminal";
  return bridgeFirstProof(previous, next) || newDestinationHint(previous.providerObservation, next.providerObservation) ? "closing" : "ordinary";
}
/**
 * Whether `next` adds an effect's first safe proof or the destination proof: closing evidence validation lets a journal
 * add only once (a saved proof can never be replaced), unlike a provider hint, which can name a new transaction again.
 */
export function bridgeFirstProof(previous: Meaning, next: Meaning): boolean {
  return next.effects.some((effect, index) => effect.safeProof !== null && previous.effects[index]?.safeProof === null) ||
    (previous.destinationProof === null && next.destinationProof !== null);
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
 * `overflow` (for a first proof or the terminal transition only) it is measured against the room past 1 MiB instead.
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
