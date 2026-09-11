import { type MetaMaskGaslessOperationRecord } from "../operation-model.js";
export declare function validateMetaMaskGaslessOperation(value: unknown): MetaMaskGaslessOperationRecord;
export declare function validateMetaMaskGaslessContinuity(previous: MetaMaskGaslessOperationRecord, next: MetaMaskGaslessOperationRecord): void;
