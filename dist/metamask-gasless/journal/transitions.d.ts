import type { MetaMaskGaslessIntent, MetaMaskGaslessMutable } from "../model.js";
import { type MetaMaskGaslessOperationIdentity, type MetaMaskGaslessOperationRecord } from "../operation-model.js";
export declare function newMetaMaskGaslessOperation(identityInput: MetaMaskGaslessOperationIdentity, intent: MetaMaskGaslessIntent): MetaMaskGaslessOperationRecord;
export declare function advanceMetaMaskGaslessOperation(operation: MetaMaskGaslessOperationRecord, patch: Partial<MetaMaskGaslessMutable>, atInput: string): MetaMaskGaslessOperationRecord;
export declare function metaMaskGaslessAtTransition(operation: MetaMaskGaslessOperationRecord, index: number): MetaMaskGaslessOperationRecord;
export declare function assertMetaMaskGaslessDispatchCapacity(operation: MetaMaskGaslessOperationRecord): void;
/** Conservative pre-read gate; the exact resulting transition is still checked before persistence. */
export declare function assertMetaMaskGaslessObservationCapacity(operation: MetaMaskGaslessOperationRecord): void;
