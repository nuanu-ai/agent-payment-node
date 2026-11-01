import type { MetaMaskGaslessOperationRecord } from "./operation-model.js";
export declare function metaMaskGaslessApprovalPhrase(op: MetaMaskGaslessOperationRecord): string;
/** `siblings`: the account's earlier unresolved MetaMask gasless transfers this one proceeds beside, shown before consent. */
export declare function metaMaskGaslessApprovalSummary(op: MetaMaskGaslessOperationRecord, now: number, siblings: readonly MetaMaskGaslessOperationRecord[]): Readonly<Record<string, unknown>>;
