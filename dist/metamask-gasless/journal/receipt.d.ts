import { type MetaMaskGaslessOperationRecord, type MetaMaskGaslessPublicOperation, type MetaMaskGaslessReceipt } from "../operation-model.js";
export declare function metaMaskGaslessNextActions(operation: MetaMaskGaslessOperationRecord): readonly string[];
export declare function metaMaskGaslessProofClass(operation: MetaMaskGaslessOperationRecord): MetaMaskGaslessPublicOperation["proof_class"];
export declare function publicMetaMaskGaslessOperation(operation: MetaMaskGaslessOperationRecord): MetaMaskGaslessPublicOperation;
export declare function metaMaskGaslessReceipt(operation: MetaMaskGaslessOperationRecord): MetaMaskGaslessReceipt;
/** Accept the current receipt or an exact historical derivative, never an unrelated stale sidecar. */
export declare function validateMetaMaskGaslessReceipt(value: unknown, operation: MetaMaskGaslessOperationRecord): MetaMaskGaslessReceipt;
