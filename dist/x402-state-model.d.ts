export declare const ZERO_HASH: string;
export declare const X402_STATE_VERSION: "apn.x402.state.v1";
export declare const TRANSITION_VERSION: "apn.x402.transition.v1";
export type X402State = "awaiting_approval" | "authorization_material_pending" | "authorized_not_sent" | "paid_request_pending" | "settlement_pending" | "effect_unknown" | "seller_result_recovery_pending" | "completed" | "failed_before_effect" | "failed_expired_unused" | "failed_settled_without_result";
export type X402FinalityClass = "pre_effect" | "unknown_finality" | "known_settled" | "terminal";
export type X402Reason = "x402_awaiting_authorization" | "x402_authorization_material_pending" | "x402_authorized_not_sent" | "x402_paid_request_pending" | "x402_settlement_pending" | "x402_effect_unknown" | "x402_seller_result_recovery_pending" | "x402_completed" | "x402_failed_before_effect" | "x402_failed_expired_unused" | "x402_failed_settled_without_result";
export type X402ProofClass = "x402_frozen_offer" | "x402_authorization_recovery" | "x402_authorization_verified" | "x402_unknown_finality" | "x402_settlement_verified_result_pending" | "x402_safe_settlement" | "x402_proven_no_effect" | "x402_expired_unused_finalized" | "x402_settled_result_unavailable";
export type SafeNextAction = "x402.fetch.approve" | "operation.resume" | "operation.status" | "receipt.get" | "use.archival_rpc";
export interface X402SelectedOffer {
    readonly index: string;
    readonly declaredCanonicalJson: string;
    readonly resolved: {
        readonly tokenName: string;
        readonly tokenVersion: string;
        readonly assetTransferMethod: "eip3009";
        readonly paymentFlow: "transferWithAuthorization";
    };
    readonly offerHash: string;
}
export interface X402HttpObservation {
    readonly attemptNumber: string;
    readonly purpose: "payment" | "result_recovery";
    readonly targetHash: string;
    readonly status: string;
    readonly rawHeadersHash: string;
    readonly paymentRequiredHeaderHash?: string;
    readonly paymentResponseHeaderHash?: string;
    readonly bodyHash: string;
    readonly bodyByteLength: string;
    readonly mediaType?: string;
    readonly finalUrlHash: string;
    readonly origin: string;
    readonly selectedIpFamily: "ipv4" | "ipv6";
    readonly startedAt: string;
    readonly observedAt: string;
}
export interface X402Attempt {
    readonly attemptNumber: string;
    readonly purpose: "payment" | "result_recovery";
    readonly phase: "pending" | "observed" | "ambiguous";
    readonly requestHeaderHash: string;
    readonly persistedAt: string;
    readonly observation?: X402HttpObservation;
}
export interface SettlementResponseObservation {
    readonly schemaVersion: "apn.x402.settlement-response.v1";
    readonly classification: "success" | "settlement_pending" | "failure_with_transaction";
    readonly normalizedCanonicalJson: string;
    readonly paymentResponseHeaderHash: string;
    readonly settlementResponseHash: string;
    readonly httpAttemptNumber: string;
    readonly observedAt: string;
}
export interface TransactionHint {
    readonly transactionHash: `0x${string}`;
    readonly source: "payment_response" | "authorization_used_log";
    readonly sourceBindingHash: string;
    readonly observedAt: string;
}
export interface AuthorizationUsedCandidate {
    readonly blockNumber: string;
    readonly blockHash: `0x${string}`;
    readonly transactionHash: `0x${string}`;
    readonly logIndex: string;
    readonly authorizer: `0x${string}`;
    readonly nonce: `0x${string}`;
}
export interface AuthorizationUsedScan {
    readonly schemaVersion: "apn.x402.authorization-used-scan.v1";
    readonly searchStartBlock: string;
    readonly nextFromBlock: string;
    readonly targetSafeHead: {
        readonly number: string;
        readonly hash: `0x${string}`;
        readonly observedAt: string;
    };
    readonly lastCompletedChunk?: {
        readonly fromBlock: string;
        readonly toBlock: string;
        readonly toBlockHash: `0x${string}`;
    };
    readonly candidates: readonly AuthorizationUsedCandidate[];
    readonly status: "active" | "complete" | "unavailable" | "ambiguous";
    readonly unavailableReason?: "pruned" | "range_unavailable";
    readonly updatedAt: string;
    readonly evidenceHash: string;
}
export interface SettlementEvidence {
    readonly schemaVersion: "apn.x402.settlement-evidence.v1";
    readonly network: "eip155:8453";
    readonly chainId: "8453";
    readonly token: `0x${string}`;
    readonly transactionHash: `0x${string}`;
    readonly safeHead: {
        readonly number: string;
        readonly hash: `0x${string}`;
        readonly observedAt: string;
    };
    readonly transactionBlock: {
        readonly number: string;
        readonly hash: `0x${string}`;
        readonly timestamp: string;
    };
    readonly receiptStatus: "1";
    readonly blockHashRechecked: true;
    readonly authorizationUsed: {
        readonly logIndex: string;
        readonly authorizer: `0x${string}`;
        readonly nonce: `0x${string}`;
        readonly blockNumber: string;
        readonly blockHash: `0x${string}`;
        readonly transactionHash: `0x${string}`;
    };
    readonly transfer: {
        readonly logIndex: string;
        readonly from: `0x${string}`;
        readonly to: `0x${string}`;
        readonly value: string;
        readonly blockNumber: string;
        readonly blockHash: `0x${string}`;
        readonly transactionHash: `0x${string}`;
    };
    readonly authorizationState: {
        readonly value: true;
        readonly blockNumber: string;
        readonly blockHash: `0x${string}`;
        readonly blockTag: "safe" | "number";
        readonly observedAt: string;
    };
    readonly rpcOriginHash: string;
    readonly evidenceHash: string;
}
export interface UnusedExpiryEvidence {
    readonly schemaVersion: "apn.x402.unused-expiry-evidence.v1";
    readonly network: "eip155:8453";
    readonly chainId: "8453";
    readonly token: `0x${string}`;
    readonly validBefore: string;
    readonly finalizedHead: {
        readonly number: string;
        readonly hash: `0x${string}`;
        readonly timestamp: string;
        readonly observedAt: string;
    };
    readonly authorizationState: {
        readonly value: false;
        readonly blockNumber: string;
        readonly blockHash: `0x${string}`;
        readonly blockTag: "finalized";
        readonly observedAt: string;
    };
    readonly absence: {
        readonly localSettlement: false;
        readonly httpSettlement: false;
        readonly authorizationUsed: false;
        readonly transactionReceipt: false;
    };
    readonly rpcOriginHash: string;
    readonly evidenceHash: string;
}
export interface X402ResultRecord {
    readonly schemaVersion: "apn.x402.result.v1";
    readonly operationId: string;
    readonly mediaType: string;
    readonly bodyEncoding: "utf8";
    readonly bodyText: string;
    readonly resultHash: string;
    readonly byteLength: string;
    readonly responseStatus: "200";
    readonly createdAt: string;
    readonly integrityHash: string;
}
export type X402TerminalState = "completed" | "failed_before_effect" | "failed_expired_unused" | "failed_settled_without_result";
export interface X402ReceiptRecord {
    readonly schemaVersion: "apn.x402.receipt.v1";
    readonly kind: "x402_fetch";
    readonly operationId: string;
    readonly terminalState: X402TerminalState;
    readonly reason: X402Reason;
    readonly proofClass: X402ProofClass;
    readonly resource: {
        readonly origin: string;
        readonly path: string;
        readonly urlHash: string;
    };
    readonly fingerprint: string;
    readonly offerHash: string;
    readonly payer: `0x${string}`;
    readonly payee: `0x${string}`;
    readonly amountAtomic: string;
    readonly network: "eip155:8453";
    readonly token: `0x${string}`;
    readonly paymentIdentifier?: string;
    readonly settlementResponseHash?: string;
    readonly settlementEvidence?: SettlementEvidence;
    readonly unusedExpiryEvidence?: UnusedExpiryEvidence;
    readonly result?: {
        readonly resultHash: string;
        readonly mediaType: string;
        readonly byteLength: string;
        readonly resultIntegrityHash: string;
    };
    readonly operationBindingHash: string;
    readonly previousLinkHash: string;
    readonly createdAt: string;
    readonly integrityHash: string;
}
export interface X402Transition {
    readonly sequence: string;
    readonly at: string;
    readonly state: X402State;
    readonly terminal: boolean;
    readonly reason: X402Reason;
    readonly proofClass: X402ProofClass;
    readonly previousHash: string;
    readonly hash: string;
}
export interface X402OperationRecord {
    readonly schemaVersion: "apn.x402.state.v1";
    readonly kind: "x402_fetch";
    readonly operationId: string;
    readonly idempotencyHash: string;
    readonly profile: string;
    readonly profileHash: string;
    readonly requestHash: string;
    readonly fingerprint: string;
    readonly resource: {
        readonly canonicalUrl: string;
        readonly origin: string;
        readonly path: string;
        readonly urlHash: string;
    };
    readonly sellerWire: {
        readonly resourceCanonicalJson: string;
        readonly resourceHash: string;
    };
    readonly chainId: "8453";
    readonly network: "eip155:8453";
    readonly token: `0x${string}`;
    readonly wallet: `0x${string}`;
    readonly payee: `0x${string}`;
    readonly amountAtomic: string;
    readonly capAtomic: string;
    readonly selectedOffer: X402SelectedOffer;
    readonly providerSigner?: {
        readonly schemaVersion: "apn.x402.provider-signer.v1";
        readonly providerId: string;
        readonly profileRevision: number;
        readonly capabilityHash: string;
        readonly accountBindingHash: string;
        readonly executionMode: "provider_detached_eip3009_apn_paid_retry";
        readonly executionOwner: "apn";
        readonly retryOwner: "apn_state_machine";
    };
    readonly preparedBlock: {
        readonly number: string;
        readonly hash: `0x${string}`;
        readonly observedAt: string;
    };
    readonly paymentIdentifier?: {
        readonly declarationCanonicalJson: string;
        readonly declarationHash: string;
        readonly value: string;
    };
    readonly authorization: {
        readonly from: `0x${string}`;
        readonly to: `0x${string}`;
        readonly value: string;
        readonly validAfter: "0";
        readonly validBefore: string;
        readonly nonce: `0x${string}`;
        readonly createdAt: string;
        readonly intentHash: string;
    };
    readonly signatureHash?: string;
    readonly paymentPayloadHash?: string;
    readonly paymentHeaderHash?: string;
    readonly attempts: readonly X402Attempt[];
    readonly settlementResponseObservation?: SettlementResponseObservation;
    readonly transactionHint?: TransactionHint;
    readonly authorizationUsedScan?: AuthorizationUsedScan;
    readonly settlementEvidence?: SettlementEvidence;
    readonly unusedExpiryEvidence?: UnusedExpiryEvidence;
    readonly resultLink?: {
        readonly resultHash: string;
        readonly resultIntegrityHash: string;
    };
    readonly receiptLink?: {
        readonly receiptIntegrityHash: string;
    };
    readonly state: X402State;
    readonly finalityClass: X402FinalityClass;
    readonly terminal: boolean;
    readonly reason: X402Reason;
    readonly proofClass: X402ProofClass;
    readonly nextActions: readonly SafeNextAction[];
    readonly createdAt: string;
    readonly updatedAt: string;
    readonly transitions: readonly X402Transition[];
    readonly integrityHash: string;
}
export declare function x402RequestHash(input: {
    readonly profile: string;
    readonly canonicalUrl: string;
    readonly capAtomic: string;
}): string;
export declare function x402Fingerprint(input: Pick<X402OperationRecord, "kind" | "profile" | "operationId" | "resource" | "chainId" | "network" | "token" | "capAtomic" | "selectedOffer" | "wallet" | "paymentIdentifier" | "providerSigner">): string;
export declare function x402AuthorizationIntentHash(value: Omit<X402OperationRecord["authorization"], "intentHash">): string;
export declare function x402OperationBindingHash(operation: X402OperationRecord): string;
export declare function x402TransactionHintSourceBindingHash(source: TransactionHint["source"], sourceHash: string): string;
export declare function appendX402Transition(previous: readonly X402Transition[], input: Omit<X402Transition, "sequence" | "previousHash" | "hash">): readonly X402Transition[];
export declare function sealX402Operation(value: Omit<X402OperationRecord, "integrityHash">): X402OperationRecord;
