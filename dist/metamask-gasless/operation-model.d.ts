import type { Address, Hex } from "../model.js";
import type { MetaMaskGaslessBinding, MetaMaskGaslessChainId, MetaMaskGaslessCursor, MetaMaskGaslessIntent, MetaMaskGaslessMutable, MetaMaskGaslessSettlement, MetaMaskGaslessState } from "./model.js";
import type { MetaMaskGaslessReason } from "./reasons.js";
export declare const MM_OPERATION_VERSION: "apn.metamask-gasless-operation.v1";
export declare const MM_OPERATION_KIND: "metamask_gasless_transfer";
export declare const MM_RECEIPT_VERSION: "apn.metamask-gasless-receipt.v1";
export declare const MM_TERMINAL: readonly MetaMaskGaslessState[];
export declare const MM_HISTORY_LIMIT = 96;
export declare const MM_FILE_LIMIT: number;
export declare const MM_DISPATCH_RESERVE_TRANSITIONS = 8;
export declare const MM_DISPATCH_RESERVE_BYTES: number;
export interface MetaMaskGaslessTransition extends MetaMaskGaslessMutable {
    readonly at: string;
    readonly previousHash: string;
    readonly transitionHash: string;
}
export interface MetaMaskGaslessOperationRecord extends MetaMaskGaslessMutable {
    readonly schemaVersion: typeof MM_OPERATION_VERSION;
    readonly kind: typeof MM_OPERATION_KIND;
    readonly profileHash: string;
    readonly operationId: string;
    readonly idempotencyHash: string;
    readonly requestHash: string;
    readonly fingerprint: string;
    readonly createdAt: string;
    readonly updatedAt: string;
    readonly terminal: boolean;
    readonly intent: MetaMaskGaslessIntent;
    readonly transitions: readonly MetaMaskGaslessTransition[];
    readonly integrityHash: string;
}
export type MetaMaskGaslessOperationIdentity = Pick<MetaMaskGaslessOperationRecord, "profileHash" | "operationId" | "idempotencyHash" | "requestHash">;
export interface MetaMaskGaslessPublicOperation {
    readonly schema_version: typeof MM_OPERATION_VERSION;
    readonly kind: typeof MM_OPERATION_KIND;
    readonly operation_id: string;
    readonly profile: string;
    readonly profile_hash: string;
    readonly provider: "metamask-agent-wallet";
    readonly custody: "provider_managed_server_wallet";
    readonly execution_owner: "provider";
    readonly retry_owner: "apn_observation_only_after_attempt";
    readonly evidence_owner: "configured_chain_rpc";
    readonly fingerprint: string;
    readonly state: MetaMaskGaslessState;
    readonly terminal: boolean;
    readonly reason: MetaMaskGaslessReason;
    readonly proof_class: "durable_pre_effect" | "effect_observation_pending" | "rpc_safe_correlated" | "rpc_finalized_correlated";
    readonly transfer: {
        readonly chain_id: MetaMaskGaslessChainId;
        readonly token: Address;
        readonly symbol: "USDC";
        readonly decimals: 6;
        readonly sender: Address;
        readonly recipient: Address;
        readonly fee_recipient: Address;
        readonly gross_atomic: string;
        readonly user_max_fee_atomic: string;
        readonly minimum_received_atomic: string;
        readonly frozen_net_atomic: string;
        readonly frozen_fee_atomic: string;
        readonly actual_delivered_atomic: string | null;
        readonly actual_sender_debit_atomic: string | null;
    };
    readonly fees: {
        readonly token: Address;
        readonly actual_fee_atomic: string | null;
        readonly refund_atomic: string | null;
        readonly unused_gross_atomic: string | null;
        readonly approved_sender_native_debit_wei: "0";
        readonly proven_sender_native_debit_wei: "0" | null;
        readonly native_gas_payer: Address | null;
    };
    readonly permission: {
        readonly initial_designation: "empty" | "pinned";
        readonly observed_designation: "pinned" | null;
        readonly designation_persists: true;
        readonly delegation_hash: Hex;
        readonly signing_digest: Hex;
        readonly one_use_status: "not_dispatched" | "possibly_live" | "consumed";
        readonly onchain_expiry: false;
        readonly guard_held: boolean;
    };
    readonly provider_binding: MetaMaskGaslessBinding;
    readonly provider_request_id_hash: string;
    readonly submission_attempts: 0 | 1;
    readonly transaction_hash: Hex | null;
    readonly settlement: MetaMaskGaslessSettlement | null;
    readonly scan_cursor: MetaMaskGaslessCursor;
    readonly endpoint_origin: string;
    readonly endpoint_hash: string;
    readonly approved_at: string | null;
    readonly created_at: string;
    readonly updated_at: string;
    readonly expires_at: string;
    readonly next_actions: readonly string[];
}
export interface MetaMaskGaslessReceipt extends Omit<MetaMaskGaslessPublicOperation, "schema_version"> {
    readonly schema_version: typeof MM_RECEIPT_VERSION;
    readonly operation_binding_hash: string;
    readonly transition_hash: string;
    readonly receipt_hash: string;
}
export declare function mmImmutable(op: Pick<MetaMaskGaslessOperationRecord, "schemaVersion" | "kind" | "profileHash" | "operationId" | "idempotencyHash" | "requestHash" | "createdAt" | "intent">): {
    schemaVersion: "apn.metamask-gasless-operation.v1";
    kind: "metamask_gasless_transfer";
    profileHash: string;
    operationId: string;
    idempotencyHash: string;
    requestHash: string;
    createdAt: string;
    intent: MetaMaskGaslessIntent;
};
export declare function mmMutable(op: MetaMaskGaslessMutable): MetaMaskGaslessMutable;
export declare function mmRequestHash(profileHash: string, intent: Pick<MetaMaskGaslessIntent, "request" | "token">): string;
