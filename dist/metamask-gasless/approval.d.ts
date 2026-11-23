import type { MetaMaskGaslessOperationRecord } from "./operation-model.js";
export declare function metaMaskGaslessApprovalPhrase(op: MetaMaskGaslessOperationRecord): string;
/**
 * `siblings`: the account's earlier unresolved MetaMask gasless transfers this one proceeds beside, shown before consent.
 * The `*_usdc` decimals keep their names from the USDC-only lane; each is the transfer token's amount at its own scale.
 */
export declare function metaMaskGaslessApprovalSummary(op: MetaMaskGaslessOperationRecord, now: number, siblings: readonly MetaMaskGaslessOperationRecord[]): Readonly<Record<string, unknown>>;
