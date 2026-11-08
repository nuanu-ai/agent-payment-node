import { canonicalJson } from "../canonical.js";
import { ApnError } from "../errors.js";
import { isEvmTransactionHash } from "../rail-status-binding.js";
import { BRIDGE_CLOSING_TRANSITIONS, BRIDGE_HISTORY_LIMIT, BRIDGE_TERMINAL, type BridgeOperationRecord,
  type BridgeTransition } from "./operation-model.js";
import type { BridgeProviderObservation } from "./model.js";

/** The file bound every released reader admits (canonical JSON and its newline); only a terminal journal may pass it. */
export const BRIDGE_FILE_LIMIT = 1024 * 1024;
/**
 * A terminal transition that fits no 1 MiB file even without its telemetry (a journal an earlier release filled, with
 * less room than one state copy) may pass that bound by one more copy. The bridge reader admits it; 0.5.96 and earlier
 * do not read such a file.
 */
export const BRIDGE_TERMINAL_FILE_LIMIT = BRIDGE_FILE_LIMIT + 64 * 1024;
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
  const safeProof = next.effects.some((effect, index) => effect.safeProof !== null && previous.effects[index]?.safeProof === null);
  const destinationProof = previous.destinationProof === null && next.destinationProof !== null;
  return safeProof || destinationProof || newDestinationHint(previous.providerObservation, next.providerObservation) ? "closing" : "ordinary";
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
 * `overflow` a terminal transition is measured against the terminal file limit instead of the 1 MiB one.
 */
export function bridgeCapacityRefusal(kind: BridgeTransitionKind, record: BridgeOperationRecord,
  overflow: boolean): "bridge_history_capacity" | "bridge_record_capacity" | null {
  if (!bridgeHistoryAdmits(kind, record.transitions.length)) return "bridge_history_capacity";
  const limit = overflow && kind === "terminal" ? BRIDGE_TERMINAL_FILE_LIMIT : BRIDGE_FILE_LIMIT;
  return bridgeFileBytes(record) + RESERVE_BYTES[kind] > limit ? "bridge_record_capacity" : null;
}
export function bridgeFileBytes(value: unknown): number {
  return Buffer.byteLength(canonicalJson(value), "utf8") + 1;
}
/** Whether `error` is a journal capacity refusal: nothing was written, and the same change can be tried again later. */
export function bridgeCapacityRefused(error: unknown): boolean {
  return error instanceof ApnError && error.code === "APN_OPERATION_BLOCKED" &&
    (error.details?.reason === "bridge_history_capacity" || error.details?.reason === "bridge_record_capacity");
}
