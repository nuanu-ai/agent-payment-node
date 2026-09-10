import type { Address, Hex } from "../model.js";
import type { SmartAccountGaslessIntent, SmartAccountGaslessMutable, SmartAccountGaslessState, SmartAccountGaslessSettlement, SmartAccountGaslessUnusedProof, SmartAccountGaslessCursor } from "./model.js";
import type { SmartAccountGaslessReason } from "./reasons.js";
export declare const SA_OPERATION_VERSION: "apn.smart-account-gasless-operation.v1";
export declare const SA_OPERATION_KIND: "smart_account_gasless_transfer";
export declare const SA_RECEIPT_VERSION: "apn.smart-account-gasless-receipt.v1";
export declare const SA_TERMINAL: readonly SmartAccountGaslessState[];
export declare const SA_HISTORY_LIMIT = 256;
export declare const SA_FILE_LIMIT: number;
export declare const SA_TERMINAL_RESERVE_TRANSITIONS = 2;
export declare const SA_TERMINAL_RESERVE_BYTES: number;
export declare const SA_MUTABLE_KEYS: readonly ["state", "approval", "material", "signingAttempts", "exposureAttempts", "submissionAttempts", "exposureStartedAt", "dispatchStartedAt", "verification", "providerSettlement", "cursor", "observation", "settlement", "unusedProof", "failure"];
export interface SmartAccountGaslessTransition extends SmartAccountGaslessMutable {
    readonly at: string;
    readonly previousHash: string;
    readonly transitionHash: string;
}
export interface SmartAccountGaslessOperationRecord extends SmartAccountGaslessMutable {
    readonly schemaVersion: typeof SA_OPERATION_VERSION;
    readonly kind: typeof SA_OPERATION_KIND;
    readonly profileHash: string;
    readonly operationId: string;
    readonly idempotencyHash: string;
    readonly requestHash: string;
    readonly fingerprint: string;
    readonly createdAt: string;
    readonly updatedAt: string;
    readonly terminal: boolean;
    readonly intent: SmartAccountGaslessIntent;
    readonly transitions: readonly SmartAccountGaslessTransition[];
    readonly integrityHash: string;
}
export type SmartAccountGaslessOperationIdentity = Pick<SmartAccountGaslessOperationRecord, "profileHash" | "operationId" | "idempotencyHash" | "requestHash">;
export interface SmartAccountGaslessPublicOperation {
    readonly schema_version: typeof SA_OPERATION_VERSION;
    readonly kind: typeof SA_OPERATION_KIND;
    readonly operation_id: string;
    readonly profile: string;
    readonly profile_hash: string;
    readonly provider: "metamask-smart-account";
    readonly custody: "external_owner_delegated_local_session";
    readonly execution_owner: "public_facilitator";
    readonly retry_owner: "apn_observation_only_after_exposure";
    readonly evidence_owner: "configured_chain_rpc";
    readonly fingerprint: string;
    readonly state: SmartAccountGaslessState;
    readonly terminal: boolean;
    readonly reason: SmartAccountGaslessReason | null;
    readonly proof_class: "durable_pre_effect" | "effect_observation_pending" | "rpc_safe_correlated" | "rpc_finalized_unused";
    readonly transfer: {
        readonly chain_id: 8453;
        readonly token: Address;
        readonly symbol: "USDC";
        readonly decimals: 6;
        readonly sender: Address;
        readonly recipient: Address;
        readonly gross_atomic: string;
        readonly user_max_fee_atomic: string;
        readonly minimum_received_atomic: string;
        readonly frozen_net_atomic: string;
        readonly frozen_fee_atomic: "0";
        readonly actual_delivered_atomic: string | null;
        readonly actual_sender_debit_atomic: string | null;
    };
    readonly fees: {
        readonly token: Address;
        readonly actual_fee_atomic: "0" | null;
        readonly refund_atomic: "0" | null;
        readonly unused_gross_atomic: string | null;
        readonly approved_sender_native_debit_wei: "0";
        readonly proven_sender_native_debit_wei: "0" | null;
        readonly proven_session_native_debit_wei: "0" | null;
        readonly native_gas_payer: Address | null;
    };
    readonly permission: {
        readonly owner: Address;
        readonly session: Address;
        readonly root_delegation_hash: Hex;
        readonly child_delegation_hash: Hex | null;
        readonly root_nonce_atomic: string;
        readonly material_hash: string | null;
        readonly permission_context_hash: string | null;
        readonly onchain_expiry: true;
        readonly guard_held: boolean;
        readonly status: "not_signed" | "sealed_local" | "possibly_live" | "consumed" | "expired_unused" | "failed_before_effect";
    };
    readonly signing_attempts: 0 | 1;
    readonly exposure_attempts: 0 | 1;
    readonly submission_attempts: 0 | 1;
    readonly transaction_hash: Hex | null;
    readonly settlement: SmartAccountGaslessSettlement | null;
    readonly unused_proof: SmartAccountGaslessUnusedProof | null;
    readonly scan_cursor: SmartAccountGaslessCursor;
    readonly endpoint_origin: string;
    readonly endpoint_hash: string;
    readonly approved_at: string | null;
    readonly created_at: string;
    readonly updated_at: string;
    readonly expires_at: string;
    readonly next_actions: readonly string[];
}
export interface SmartAccountGaslessReceipt extends Omit<SmartAccountGaslessPublicOperation, "schema_version"> {
    readonly schema_version: typeof SA_RECEIPT_VERSION;
    readonly operation_binding_hash: string;
    readonly transition_hash: string;
    readonly receipt_hash: string;
}
export declare function saImmutable(op: SmartAccountGaslessOperationIdentity & Pick<SmartAccountGaslessOperationRecord, "intent" | "createdAt">): {
    schemaVersion: "apn.smart-account-gasless-operation.v1";
    kind: "smart_account_gasless_transfer";
    profileHash: string;
    operationId: string;
    idempotencyHash: string;
    requestHash: string;
    createdAt: string;
    intent: SmartAccountGaslessIntent;
};
export declare function saMutable(op: SmartAccountGaslessMutable): SmartAccountGaslessMutable;
export declare function saRequestHash(profileHash: string, intent: Pick<SmartAccountGaslessIntent, "request" | "token">): string;
