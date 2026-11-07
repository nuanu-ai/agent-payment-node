import { type BridgeOperationRecord, type BridgeTransition } from "./operation-model.js";
/** The state store refuses to read a larger file: canonical JSON and its newline. */
export declare const BRIDGE_FILE_LIMIT: number;
/**
 * `ordinary`: anything that can repeat without moving the operation toward its end (state flips between pending and
 * unknown, failure diagnostics, provider statuses that name nothing new, unsafe inclusions). `closing`: evidence that
 * can only be added a bounded number of times: an effect's first safe proof, the destination proof, or a provider
 * observation naming a destination transaction it had not named, or now settled. `terminal`: the operation's end.
 */
export type BridgeTransitionKind = "ordinary" | "closing" | "terminal";
type Meaning = Pick<BridgeTransition, "state" | "effects" | "destinationProof" | "providerObservation">;
export declare function bridgeTransitionKind(previous: Meaning, next: Meaning): BridgeTransitionKind;
/** Whether a journal of `transitions` entries may end with a transition of `kind`. */
export declare function bridgeHistoryAdmits(kind: BridgeTransitionKind, transitions: number): boolean;
/** The capacity reason that refuses `record`, whose newest transition is of `kind`; null when it may be written. */
export declare function bridgeCapacityRefusal(kind: BridgeTransitionKind, record: BridgeOperationRecord): "bridge_history_capacity" | "bridge_record_capacity" | null;
export {};
