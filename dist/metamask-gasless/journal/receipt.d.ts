import { type MetaMaskGaslessOperationRecord, type MetaMaskGaslessPublicOperation, type MetaMaskGaslessReceipt } from "../operation-model.js";
/**
 * `legacy` reproduces the next actions of releases that never carried the observation RPC option, so receipts they
 * wrote for an operation observed through a named RPC still validate as exact historical derivatives.
 */
export declare function metaMaskGaslessNextActions(operation: MetaMaskGaslessOperationRecord, legacy?: boolean): readonly string[];
export declare function metaMaskGaslessProofClass(operation: MetaMaskGaslessOperationRecord): MetaMaskGaslessPublicOperation["proof_class"];
export declare function publicMetaMaskGaslessOperation(operation: MetaMaskGaslessOperationRecord, legacyNextActions?: boolean): MetaMaskGaslessPublicOperation;
export declare function metaMaskGaslessReceipt(operation: MetaMaskGaslessOperationRecord, legacyNextActions?: boolean): MetaMaskGaslessReceipt;
/** Accept the current receipt or an exact historical derivative, never an unrelated stale sidecar. */
export declare function validateMetaMaskGaslessReceipt(value: unknown, operation: MetaMaskGaslessOperationRecord): MetaMaskGaslessReceipt;
