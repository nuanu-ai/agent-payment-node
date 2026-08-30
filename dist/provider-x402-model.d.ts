import { CHAIN_CAIP2 } from "./constants.js";
import type { ProviderX402Invocation, ProviderX402SellerResult } from "./provider-ports.js";
import type { ProfilePolicyRecord } from "./profile-policy.js";
import type { X402RpcBlock, X402RpcHead, X402RpcLog } from "./ports.js";
import { type X402SettlementWaitProjection } from "./x402-state-integrity.js";
export declare const PROVIDER_X402_STATE_VERSION: "apn.provider-x402.state.v1";
export type ProviderX402State = "preparing" | "awaiting_approval" | "started" | "settlement_pending" | "ambiguous_effect" | "completed" | "failed_before_effect";
export interface ProviderX402Transition {
    readonly sequence: string;
    readonly at: string;
    readonly state: ProviderX402State;
    readonly reason: string;
    readonly proofClass: string;
    readonly previousHash: string;
    readonly hash: string;
}
export interface ProviderX402PolicyBinding {
    readonly schemaVersion: ProfilePolicyRecord["schemaVersion"];
    readonly integrityHash: string;
    readonly updatedAt: string;
    readonly walletBindingHash: string;
    readonly maxBalanceUsdcAtomic: string;
    readonly maxX402AmountAtomic: string;
    readonly callerCapAtomic?: string;
    readonly effectiveCapAtomic: string;
    readonly verdict: "authorized_by_existing_profile_policy";
}
export interface ProviderX402SettlementEvidence {
    readonly schemaVersion: "apn.provider-x402.settlement.v1";
    readonly lowerBlock: X402RpcHead;
    readonly upperBlock: X402RpcBlock;
    readonly transactionHash: `0x${string}`;
    readonly receiptStatus: "success";
    readonly transfer: X402RpcLog;
    readonly chainId: "8453";
    readonly network: typeof CHAIN_CAIP2;
    readonly token: `0x${string}`;
    readonly payer: `0x${string}`;
    readonly payee: `0x${string}`;
    readonly amountAtomic: string;
    readonly rpcOriginHash: string;
    readonly evidenceHash: string;
}
export interface ProviderX402OperationRecord {
    readonly schemaVersion: typeof PROVIDER_X402_STATE_VERSION;
    readonly kind: "x402_fetch";
    readonly executionMode: "provider_atomic_paid_fetch";
    readonly operationId: string;
    readonly idempotencyHash: string;
    readonly profile: string;
    readonly profileHash: string;
    readonly requestHash: string;
    readonly fingerprint: string;
    readonly provider: {
        readonly providerId: string;
        readonly profileRevision: number;
        readonly capabilityHash: string;
        readonly accountBindingHash: string;
        readonly payer: `0x${string}`;
        readonly executionOwner: "provider";
        readonly retryOwner: "apn_outer_no_replay_journal";
    };
    readonly request: {
        readonly canonicalUrl: string;
        readonly origin: string;
        readonly path: string;
        readonly urlHash: string;
        readonly method: "GET";
        readonly bodyState: "absent";
        readonly bodyDigest: string;
        readonly metadataDigest: string;
        readonly requestDigest: string;
    };
    readonly requirement: {
        readonly x402Version: "2";
        readonly scheme: "exact";
        readonly network: typeof CHAIN_CAIP2;
        readonly token: `0x${string}`;
        readonly decimals: 6;
        readonly payee: `0x${string}`;
        readonly amountAtomic: string;
        readonly declaredCanonicalJson: string;
        readonly digest: string;
    };
    readonly policy: ProviderX402PolicyBinding;
    readonly preparedBalance?: {
        readonly amountAtomic: string;
        readonly observedAt: string;
        readonly accountBindingHash: string;
    };
    readonly rpcBindingHash: string;
    readonly rpcOriginHash: string;
    readonly finalPreflight?: {
        readonly requirementDigest: string;
        readonly observedAt: string;
    };
    readonly evidenceLowerBlock?: X402RpcHead;
    readonly evidenceDeadlineAt?: string;
    readonly immutableUpperBlock?: X402RpcBlock;
    readonly invocation?: ProviderX402Invocation;
    readonly sellerResult?: ProviderX402SellerResult;
    readonly settlementEvidence?: ProviderX402SettlementEvidence;
    readonly state: ProviderX402State;
    readonly finalityClass: "pre_effect" | "unknown_finality" | "terminal";
    readonly terminal: boolean;
    readonly reason: string;
    readonly proofClass: string;
    readonly nextActions: readonly string[];
    readonly createdAt: string;
    readonly updatedAt: string;
    readonly transitions: readonly ProviderX402Transition[];
    readonly integrityHash: string;
}
export interface ProviderX402ReceiptRecord {
    readonly schemaVersion: "apn.provider-x402.receipt.v1";
    readonly kind: "x402_fetch";
    readonly operationId: string;
    readonly terminalState: "completed" | "failed_before_effect";
    readonly reason: string;
    readonly proofClass: string;
    readonly fingerprint: string;
    readonly requestDigest: string;
    readonly requirementDigest: string;
    readonly payer: `0x${string}`;
    readonly payee: `0x${string}`;
    readonly amountAtomic: string;
    readonly network: typeof CHAIN_CAIP2;
    readonly token: `0x${string}`;
    readonly result?: {
        readonly classification: "normalized_provider_json";
        readonly sha256: string;
        readonly byteLength: string;
    };
    readonly settlement?: ProviderX402SettlementEvidence;
    readonly operationBindingHash: string;
    readonly createdAt: string;
    readonly integrityHash: string;
}
export declare function providerX402RequestHash(input: {
    readonly profile: string;
    readonly canonicalUrl: string;
    readonly rpcUrl: string;
    readonly callerCapAtomic?: string;
}): string;
export declare function providerX402BindingHash(operation: ProviderX402OperationRecord): string;
export declare function providerX402InvocationIntentHash(input: {
    readonly correlationId: string;
    readonly canonicalUrl: string;
    readonly amountAtomic: string;
    readonly requestDigest: string;
}): string;
export declare function appendProviderX402Transition(transitions: readonly ProviderX402Transition[], input: Omit<ProviderX402Transition, "sequence" | "previousHash" | "hash">): readonly ProviderX402Transition[];
export declare function sealProviderX402Operation(value: Omit<ProviderX402OperationRecord, "integrityHash">): ProviderX402OperationRecord;
export declare function sealProviderX402Receipt(value: Omit<ProviderX402ReceiptRecord, "integrityHash">): ProviderX402ReceiptRecord;
export declare function validateProviderX402Operation(value: unknown): ProviderX402OperationRecord;
export declare function validateProviderX402Receipt(value: unknown): ProviderX402ReceiptRecord;
export declare function validateProviderX402Continuity(previous: ProviderX402OperationRecord, next: ProviderX402OperationRecord): void;
export declare function publicProviderX402Operation(operation: ProviderX402OperationRecord, settlementWait?: X402SettlementWaitProjection): unknown;
