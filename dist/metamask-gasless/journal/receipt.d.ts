import { type MetaMaskGaslessOperationRecord, type MetaMaskGaslessPublicOperation, type MetaMaskGaslessReceipt } from "../operation-model.js";
/**
 * Dispatched and unproved, after the provider closed its request, the relay reverted or the owner abandoned it: the
 * delegation may still be redeemed, and its own wallet can disable it (`apn gasless transfer revoke`).
 */
export declare function metaMaskGaslessDisableExit(op: MetaMaskGaslessOperationRecord): boolean;
/**
 * Receipts are pure projections that must reproduce what released versions wrote, so the disable exit is not part of
 * them: it is added only to the live status and resume output (`liveMetaMaskGaslessOperation`).
 * `legacy` reproduces the next actions of releases that never carried the observation RPC option, so receipts they
 * wrote for an operation observed through a named RPC still validate as exact historical derivatives.
 */
export declare function metaMaskGaslessNextActions(operation: MetaMaskGaslessOperationRecord, legacy?: boolean): readonly string[];
export declare function metaMaskGaslessProofClass(operation: MetaMaskGaslessOperationRecord): MetaMaskGaslessPublicOperation["proof_class"];
export declare function publicMetaMaskGaslessOperation(operation: MetaMaskGaslessOperationRecord, legacyNextActions?: boolean): MetaMaskGaslessPublicOperation;
/** The public operation of status and resume output: the receipt projection plus the delegation-disable exit. */
export declare function liveMetaMaskGaslessOperation(operation: MetaMaskGaslessOperationRecord): MetaMaskGaslessPublicOperation;
export declare function metaMaskGaslessReceipt(operation: MetaMaskGaslessOperationRecord, legacyNextActions?: boolean): MetaMaskGaslessReceipt;
/** Accept the current receipt or an exact historical derivative, never an unrelated stale sidecar. */
export declare function validateMetaMaskGaslessReceipt(value: unknown, operation: MetaMaskGaslessOperationRecord): MetaMaskGaslessReceipt;
