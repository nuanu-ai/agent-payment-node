import type { ProviderX402TransactionSettlementEvidence } from "./provider-x402-model.js";
export interface ProviderX402TransactionIntent {
    readonly chainId: "8453";
    readonly transactionHash: `0x${string}`;
    readonly token: `0x${string}`;
    readonly payer: `0x${string}`;
    readonly payee: `0x${string}`;
    readonly amountAtomic: string;
    readonly rpcOriginHash: string;
}
/** Read-only exact-transaction evidence. It has no search, payment, signing or submission capability. */
export interface ProviderX402TransactionEvidencePort {
    observe(intent: ProviderX402TransactionIntent): Promise<ProviderX402TransactionSettlementEvidence>;
}
