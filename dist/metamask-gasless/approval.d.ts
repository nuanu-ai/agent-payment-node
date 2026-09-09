import type { MetaMaskGaslessOperationRecord } from "./operation-model.js";
export declare function metaMaskGaslessApprovalPhrase(op: MetaMaskGaslessOperationRecord): string;
export declare function metaMaskGaslessApprovalSummary(op: MetaMaskGaslessOperationRecord, now: number): Readonly<Record<string, unknown>>;
