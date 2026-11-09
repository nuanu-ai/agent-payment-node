import { type BridgeOperationRecord, type BridgeTransition } from "./operation-model.js";
/** The file bound every released reader admits (canonical JSON and its newline); 0.5.96 and earlier read nothing larger. */
export declare const BRIDGE_FILE_LIMIT: number;
/** The reader's bound for a terminal journal. 0.5.97 reads one only up to 1 MiB + 64 KiB, earlier releases up to 1 MiB. */
export declare const BRIDGE_TERMINAL_FILE_LIMIT: number;
/**
 * The reader's bound for an open journal: bounded evidence past 1 MiB keeps one copy of room for the terminal
 * transition. 0.5.97 and earlier read an open journal only up to 1 MiB.
 */
export declare const BRIDGE_OPEN_FILE_LIMIT: number;
/**
 * `ordinary`: anything that can repeat without moving the operation toward its end (state flips between pending and
 * unknown, failure diagnostics, provider statuses that name nothing new, unsafe inclusions, an effect releasing its
 * start of signing). `closing`: evidence that can only be added a bounded number of times (bridgeBoundedEvidence),
 * or a provider observation naming a destination transaction it had not named, or now settled. `terminal`: the end.
 */
export type BridgeTransitionKind = "ordinary" | "closing" | "terminal";
type Meaning = Pick<BridgeTransition, "state" | "effects" | "destinationProof" | "providerObservation">;
export declare function bridgeTransitionKind(previous: Meaning, next: Meaning): BridgeTransitionKind;
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
export declare function bridgeBoundedEvidence(previous: Meaning, next: Meaning): boolean;
/**
 * Why the effect `role` may not start its send now (null when it may): signing starts only with room under the ordinary
 * bounds for its send and, when effects follow it, for the observations before each and their sends too. So the first
 * effect does not go out while a later one could not, and a routine send never needs the closing reserve or the room
 * past 1 MiB. Refused, nothing is signed or claimed, and the operation can only expire into its halt.
 */
export declare function bridgeSendRefusal(op: BridgeOperationRecord, role: "approval" | "bridge"): "bridge_history_capacity" | "bridge_record_capacity" | null;
/** Whether a journal of `transitions` entries may end with a transition of `kind`. */
export declare function bridgeHistoryAdmits(kind: BridgeTransitionKind, transitions: number): boolean;
/**
 * The capacity reason that refuses `record`, whose newest transition is of `kind`; null when it may be written. With
 * `overflow` (for bounded evidence or the terminal transition only) it is measured against the room past 1 MiB instead.
 */
export declare function bridgeCapacityRefusal(kind: BridgeTransitionKind, record: BridgeOperationRecord, overflow: boolean): "bridge_history_capacity" | "bridge_record_capacity" | null;
/** The hard bound the reader and the writer hold a journal file to. */
export declare function bridgeFileLimit(terminal: boolean): number;
export declare function bridgeFileBytes(value: unknown): number;
/** Whether `error` is a journal capacity refusal: nothing was written, and the same change can be tried again later. */
export declare function bridgeCapacityRefused(error: unknown): boolean;
export {};
