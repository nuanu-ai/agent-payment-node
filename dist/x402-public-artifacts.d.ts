import { CHAIN_CAIP2 } from "./constants.js";
import type { ProviderX402SellerResult } from "./provider-ports.js";
import type { ProviderX402OperationRecord, ProviderX402ReceiptRecord } from "./provider-x402-model.js";
import { type X402ReceiptRecord, type X402ResultRecord } from "./x402-state-integrity.js";
interface NormalizedProviderReceipt {
    readonly schemaVersion: "apn.x402.public-receipt.v1";
    readonly variant: "normalized_provider_json";
    readonly kind: "x402_fetch";
    readonly operationId: string;
    readonly terminalState: "completed" | "failed_before_effect";
    readonly reason: string;
    readonly proofClass: string;
    readonly resource: {
        readonly origin: string;
        readonly path: string;
        readonly urlHash: string;
    };
    readonly fingerprint: string;
    readonly requestDigest: string;
    readonly requirementDigest: string;
    readonly payer: `0x${string}`;
    readonly payee: `0x${string}`;
    readonly amountAtomic: string;
    readonly network: "eip155:8453";
    readonly token: `0x${string}`;
    readonly result?: {
        readonly classification: "normalized_provider_json";
        readonly sha256: string;
        readonly byteLength: string;
    };
    readonly settlement?: NormalizedProviderSettlement;
    readonly operationBindingHash: string;
    readonly createdAt: string;
    readonly integrityHash: string;
}
interface NormalizedProviderSettlement {
    readonly network: typeof CHAIN_CAIP2;
    readonly chainId: "8453";
    readonly token: `0x${string}`;
    readonly transactionHash: `0x${string}`;
    readonly receiptStatus: "success";
    readonly lowerBlock: PublicBlock;
    readonly upperBlock: PublicBlock;
    readonly transfer: {
        readonly logIndex: string;
        readonly from: `0x${string}`;
        readonly to: `0x${string}`;
        readonly value: string;
        readonly blockNumber: string;
        readonly blockHash: `0x${string}`;
        readonly transactionHash: `0x${string}`;
    };
    readonly rpcOriginHash: string;
    readonly evidenceHash: string;
}
interface PublicBlock {
    readonly number: string;
    readonly hash: `0x${string}`;
    readonly timestamp: string;
    readonly observedAt: string;
}
interface LocalPublicResult {
    readonly kind: "x402_result";
    readonly media_type: string;
    readonly body: unknown;
    readonly sha256: string;
    readonly byte_length: string;
}
interface NormalizedProviderResult {
    readonly kind: "x402_result";
    readonly variant: "normalized_provider_json";
    readonly classification: "normalized_provider_json";
    readonly body: unknown;
    readonly sha256: string;
    readonly byte_length: string;
}
export type PublicX402Receipt = X402ReceiptRecord | NormalizedProviderReceipt;
export type PublicX402Result = LocalPublicResult | NormalizedProviderResult;
export declare function projectPublicX402Result(input: {
    readonly variant: "local";
    readonly result: X402ResultRecord;
} | {
    readonly variant: "normalized_provider_json";
    readonly result: ProviderX402SellerResult;
}): PublicX402Result;
export declare function projectPublicX402Receipt(input: {
    readonly variant: "local";
    readonly receipt: X402ReceiptRecord;
} | {
    readonly variant: "normalized_provider_json";
    readonly operation: ProviderX402OperationRecord;
    readonly receipt: ProviderX402ReceiptRecord;
}): PublicX402Receipt;
export declare function validatePublicX402Receipt(value: unknown): PublicX402Receipt;
export declare function validatePublicX402Result(value: unknown): PublicX402Result;
export {};
