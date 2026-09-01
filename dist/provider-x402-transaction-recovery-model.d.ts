export interface ProviderX402TransactionRecoveryBinding {
    readonly schemaVersion: "apn.provider-x402.transaction-recovery.v1";
    readonly operationId: string;
    readonly chainId: "8453";
    readonly transactionHash: `0x${string}`;
    readonly evidenceMode: "exact_transaction";
    readonly idempotencyDigest: string;
    readonly materialDigest: string;
    readonly stage: "bound" | "evidence_validated";
    readonly evidenceDigest?: string;
    readonly createdAt: string;
    readonly updatedAt: string;
    readonly integrityHash: string;
}
export declare function validateProviderX402TransactionRecoveryBinding(binding: ProviderX402TransactionRecoveryBinding, operationId: string): void;
export declare function validateProviderX402TransactionRecoveryContinuity(previous: ProviderX402TransactionRecoveryBinding | undefined, next: ProviderX402TransactionRecoveryBinding | undefined): void;
