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
 * unknown, failure diagnostics, provider statuses that name nothing new, unsafe inclusions). `closing`: evidence that
 * can only be added a bounded number of times: an effect's first safe proof, the destination proof, the loss of an
 * inclusion that was never safe, or a provider observation naming a destination transaction it had not named, or now
 * settled. `terminal`: the operation's end.
 */
export type BridgeTransitionKind = "ordinary" | "closing" | "terminal";
type Meaning = Pick<BridgeTransition, "state" | "effects" | "destinationProof" | "providerObservation">;
export declare function bridgeTransitionKind(previous: Meaning, next: Meaning): BridgeTransitionKind;
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
export declare function bridgeBoundedEvidence(previous: Meaning, next: Meaning): boolean;
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
