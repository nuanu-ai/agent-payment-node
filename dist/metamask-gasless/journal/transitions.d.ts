import type { MetaMaskGaslessIntent, MetaMaskGaslessMutable } from "../model.js";
import { type MetaMaskGaslessOperationIdentity, type MetaMaskGaslessOperationRecord } from "../operation-model.js";
export declare function newMetaMaskGaslessOperation(identityInput: MetaMaskGaslessOperationIdentity, intent: MetaMaskGaslessIntent): MetaMaskGaslessOperationRecord;
export declare function advanceMetaMaskGaslessOperation(operation: MetaMaskGaslessOperationRecord, patch: Partial<MetaMaskGaslessMutable>, atInput: string): MetaMaskGaslessOperationRecord;
export declare function metaMaskGaslessAtTransition(operation: MetaMaskGaslessOperationRecord, index: number): MetaMaskGaslessOperationRecord;
export declare function assertMetaMaskGaslessDispatchCapacity(operation: MetaMaskGaslessOperationRecord): void;
/**
 * A dispatched, unresolved operation is the only kind an observation may read for, and a dispatched one the owner
 * abandoned, whose outcome only a chain proof can still replace.
 */
export declare function assertMetaMaskGaslessObservable(operation: MetaMaskGaslessOperationRecord): void;
/**
 * Whether a nonterminal observation can still be saved. It never gates a read or a terminal transition: once only
 * the reserved slot is left, observation keeps running, a proved completion still takes that slot and the owner can
 * still abandon. The byte reserve keeps the terminal transition inside the file limit.
 */
export declare function metaMaskGaslessObservationRoom(operation: MetaMaskGaslessOperationRecord): boolean;
/**
 * A re-observation that differs only in when it was taken is not a new transition: the read times and, outside a
 * proof phase, the evidence digest of the same unchanged result. State, reason, cursor, candidate, provider status
 * and observation source all stay material, so every real change is still journaled.
 */
export declare function metaMaskGaslessObservationUnchanged(operation: MetaMaskGaslessOperationRecord, patch: Partial<MetaMaskGaslessMutable>): boolean;
