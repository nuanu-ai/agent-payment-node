import type { ProviderX402OperationRecord, ProviderX402ReceiptRecord, ProviderX402SettlementEvidence } from "./provider-x402-model.js";
export declare function providerX402FrozenFingerprint(operation: ProviderX402OperationRecord): string;
export declare function validateProviderX402Settlement(evidence: ProviderX402SettlementEvidence, operation: ProviderX402OperationRecord): void;
export declare function assertProviderX402ReceiptAuthority(operation: ProviderX402OperationRecord, receipt: ProviderX402ReceiptRecord): void;
export declare function providerX402CompleteBindingHash(operation: ProviderX402OperationRecord): string;
