import { type BridgeOperationRecord, type BridgeTransition } from "./operation-model.js";
/** The file bound every released reader admits (canonical JSON and its newline); 0.5.96 and earlier read nothing larger. */
export declare const BRIDGE_FILE_LIMIT: number;
/** The reader's bound for a terminal journal. 0.5.97 reads one only up to 1 MiB + 64 KiB, earlier releases up to 1 MiB. */
export declare const BRIDGE_TERMINAL_FILE_LIMIT: number;
/**
 * The reader's bound for an open journal: a first proof past 1 MiB keeps one copy of room for the terminal transition.
 * 0.5.97 and earlier read an open journal only up to 1 MiB.
 */
export declare const BRIDGE_OPEN_FILE_LIMIT: number;
/**
 * `ordinary`: anything that can repeat without moving the operation toward its end (state flips between pending and
 * unknown, failure diagnostics, provider statuses that name nothing new, unsafe inclusions). `closing`: evidence that
 * can only be added a bounded number of times: an effect's first safe proof, the destination proof, or a provider
 * observation naming a destination transaction it had not named, or now settled. `terminal`: the operation's end.
 */
export type BridgeTransitionKind = "ordinary" | "closing" | "terminal";
type Meaning = Pick<BridgeTransition, "state" | "effects" | "destinationProof" | "providerObservation">;
export declare function bridgeTransitionKind(previous: Meaning, next: Meaning): BridgeTransitionKind;
/**
 * Whether `next` adds an effect's first safe proof or the destination proof: closing evidence validation lets a journal
 * add only once (a saved proof can never be replaced), unlike a provider hint, which can name a new transaction again.
 */
export declare function bridgeFirstProof(previous: Meaning, next: Meaning): boolean;
/** Whether a journal of `transitions` entries may end with a transition of `kind`. */
export declare function bridgeHistoryAdmits(kind: BridgeTransitionKind, transitions: number): boolean;
/**
 * The capacity reason that refuses `record`, whose newest transition is of `kind`; null when it may be written. With
 * `overflow` (for a first proof or the terminal transition only) it is measured against the room past 1 MiB instead.
 */
export declare function bridgeCapacityRefusal(kind: BridgeTransitionKind, record: BridgeOperationRecord, overflow: boolean): "bridge_history_capacity" | "bridge_record_capacity" | null;
/** The hard bound the reader and the writer hold a journal file to. */
export declare function bridgeFileLimit(terminal: boolean): number;
export declare function bridgeFileBytes(value: unknown): number;
/** Whether `error` is a journal capacity refusal: nothing was written, and the same change can be tried again later. */
export declare function bridgeCapacityRefused(error: unknown): boolean;
export {};
