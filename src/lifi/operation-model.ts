import { hashObject } from "../canonical.js";
import type {
  BridgeAccountSnapshot, BridgeBlock, BridgeDeploymentIdentity, BridgeDestinationProof,
  BridgeDestinationScan, BridgeEnvelope, BridgeMaterialization, BridgeOwner,
  BridgeProviderBinding, BridgeProviderObservation, BridgeResidualAllowance,
  BridgeSourceProof, BridgeTransactionProof, DecodedBridgeCall,
} from "./model.js";
import type { Hex } from "../model.js";
import type { ErrorCode } from "../errors.js";
import type { AssetUsageReservation } from "../asset-usage-ledger.js";
import type { BridgeAllowlistBinding } from "./allowlist.js";

export type BridgeState = "awaiting_approval" | "execution_pending" | "source_pending" |
  "destination_pending" | "unknown_finality" | "completed" | "failed_before_effect" |
  "destination_failed" | "failed_after_approval" | "failed_confirmed_revert";
export type BridgeEffectPhase = "unsealed" | "signing_started" | "sealed" | "submitting" |
  "submitted_pending" | "unknown_finality" | "included_success" | "included_revert" |
  "safe_success" | "safe_revert";
export interface BridgeIntent {
  readonly profile: string;
  readonly quoteHash: string;
  readonly owner: BridgeOwner;
  readonly providerBinding: BridgeProviderBinding;
  readonly materialization: BridgeMaterialization;
  readonly decoded: DecodedBridgeCall;
  readonly sourceDeployment: BridgeDeploymentIdentity;
  readonly destinationDeployment: BridgeDeploymentIdentity;
  readonly sourceAccount: BridgeAccountSnapshot;
  readonly destinationStartBlock: BridgeBlock;
  readonly sourceRpcOrigin: string;
  readonly destinationRpcOrigin: string;
  readonly preparedAt: string;
  readonly expiresAt: string;
  readonly policyHash: string;
  readonly implicitProtocolFeeAtomic: string;
  readonly allowlist: BridgeAllowlistBinding | null;
}
export interface BridgeConsent {
  readonly policy: "apn.bridge.foreground-approval.v1";
  readonly fingerprint: string;
  readonly approvedAt: string;
  readonly expiresAt: string;
}
export interface BridgeEffect {
  readonly role: "approval" | "bridge";
  readonly envelope: BridgeEnvelope;
  readonly phase: BridgeEffectPhase;
  readonly transactionHash: Hex | null;
  readonly sealedMaterialHash: string | null;
  readonly submittedAt: string | null;
  readonly submissionAttempts: 0 | 1;
  readonly includedProof: BridgeTransactionProof | null;
  readonly safeProof: BridgeTransactionProof | null;
}
export interface BridgeFailure {
  readonly reason: string;
  readonly residualAllowance: BridgeResidualAllowance | null;
  readonly residualAllowanceStatus?: "unavailable" | "observed";
  readonly preSignRpc?: BridgePreSignRpcFailure;
  readonly observationRpc?: BridgeObservationRpcFailure;
}
export interface BridgeObservationRpcFailure {
  readonly schemaVersion: "apn.bridge-observation-rpc-failure.v1";
  readonly stage: BridgeObservationRpcStage;
  readonly effectRole: "approval" | "bridge";
  readonly code: ErrorCode | null;
  readonly reason?: BridgeObservationRpcReason;
  readonly rpcMethod?: BridgeObservationRpcMethod;
  readonly httpStatus?: number;
  readonly attempts?: number;
  readonly endpointRole?: "primary" | "receipt" | "archive";
}
export interface BridgeObservationTelemetry {
  readonly schemaVersion: "apn.bridge-observation-telemetry.v1";
  readonly stage: "source_observation" | "destination_observation";
  readonly effectRole: "approval" | "bridge";
  readonly outcome: "success" | "missing" | "failure";
  readonly physicalRequests: number;
  readonly httpAttempts: number;
  readonly logicalRpcItems: number;
  readonly batchCount: number;
  readonly maxBatchSize: number;
  readonly budgetRejectedBeforeTransport: number;
  readonly attemptsByEndpointRole: Readonly<Record<"primary" | "receipt" | "archive", number>>;
  readonly attemptsByMethodClass: Readonly<Record<string, number>>;
}
export type BridgeObservationRpcStage = "source_observation" | "source_transaction" | "source_receipt" |
  "source_included_block" | "source_safe_head" | "source_recheck" | "source_assert_chain" |
  "destination_observation" | "destination_transaction" | "destination_receipt" |
  "destination_included_block" | "destination_safe_head" | "destination_recheck" |
  "destination_assert_chain" | "destination_logs";
export type BridgeObservationRpcMethod = "eth_chainId" | "eth_getBlockByNumber" | "eth_getTransactionByHash" |
  "eth_getTransactionReceipt" | "eth_getLogs" | "eth_getBalance" | "eth_getCode" | "eth_getStorageAt" |
  "eth_call" | "eth_estimateGas" | "eth_maxPriorityFeePerGas" | "debug_traceTransaction";
export type BridgeObservationRpcReason = "bridge_RPC_HTTP_status" | "bridge_RPC_response" |
  "receipt_transaction_membership" | "canonical_transaction_membership" | "receipt_status" |
  "receipt_sender_target" | "receipt_log_membership" | "receipt_execution_fee_bounds" | "bridge_block_reorg" |
  "bridge_block_number" | "destination_log_range" | "destination_log_count" |
  "destination_log_identity" | "destination_log_hash" | "destination_scan_cursor_reorg" |
  "destination_scan_membership" | "destination_scan_reorg" | "destination_candidate_unresolved" |
  "duplicate_destination_delivery" | "destination_not_safe_success" | "destination_transaction_reverted" | "destination_trace_rebind" |
  "request_deadline" | "DNS_deadline" | "request_interrupted" | "response_aborted" |
  "response_interrupted";
export type BridgePreSignRpcStage = "source_deployment_refresh" | "destination_deployment_refresh" |
  "source_account_refresh" | "source_execution_simulation" | "source_fee_quote";
export type BridgePreSignRpcCategory = "deployment_refresh" | "account_nonce" | "simulation" | "fee_quote";
export type BridgePreSignRpcMethod = "eth_chainId" | "eth_getBlockByNumber" | "eth_getBalance" |
  "eth_getCode" | "eth_getStorageAt" | "eth_getTransactionCount" | "eth_call" | "eth_estimateGas" |
  "eth_maxPriorityFeePerGas" | "debug_traceTransaction";
export interface BridgePreSignRpcFailure {
  readonly schemaVersion: "apn.bridge-presign-rpc-failure.v1";
  readonly phase: "pre_sign_guard";
  readonly effectRole: "approval" | "bridge";
  readonly stage: BridgePreSignRpcStage;
  readonly chainRole: "source" | "destination";
  readonly chainId: number;
  readonly category: BridgePreSignRpcCategory;
  readonly method: BridgePreSignRpcMethod | null;
}
export interface BridgeVerifiedDestinationProof extends BridgeDestinationProof {
  readonly safeBlock: BridgeBlock;
  readonly rpcOrigin: string;
  readonly transactionProofHash: string;
}
export interface BridgeMutable {
  readonly state: BridgeState;
  readonly approval: BridgeConsent | null;
  readonly effects: readonly BridgeEffect[];
  readonly sourceProof: BridgeSourceProof | null;
  readonly destinationProof: BridgeVerifiedDestinationProof | null;
  readonly providerObservation: BridgeProviderObservation | null;
  readonly destinationScan: BridgeDestinationScan;
  readonly failure: BridgeFailure | null;
  /** Frozen reservation as first created; live lifecycle remains in the shared ledger. */
  readonly usageLease: AssetUsageReservation | null;
  /** Append-only, redacted physical read accounting. Absent only on legacy records. */
  readonly observationTelemetry?: readonly BridgeObservationTelemetry[];
}
export type BridgeEffectSnapshot = Omit<BridgeEffect, "envelope"> & { readonly envelopeHash: string };
export interface BridgeTransition extends Omit<BridgeMutable, "effects"> {
  readonly at: string;
  readonly effects: readonly BridgeEffectSnapshot[];
  readonly previousHash: string;
  readonly transitionHash: string;
}
export interface BridgeOperationRecord extends BridgeMutable {
  readonly schemaVersion: "apn.bridge-operation.v1";
  readonly kind: "bridge_route";
  readonly profileHash: string;
  readonly operationId: string;
  readonly idempotencyHash: string;
  readonly requestHash: string;
  readonly fingerprint: string;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly terminal: boolean;
  readonly intent: BridgeIntent;
  readonly transitions: readonly BridgeTransition[];
  readonly integrityHash: string;
}
/** The bridge was never signed or submitted, so keep the original pre-sign diagnostic across observation retries. */
export function retainedUnsentBridgeRpcFailure(op: Pick<BridgeOperationRecord, "effects" | "failure">): BridgeFailure | null {
  const failure = op.failure, bridge = op.effects.at(-1), approval = op.effects.length === 2 ? op.effects[0] : null;
  if (failure?.reason !== "unsent_apn_rpc_ambiguous" || failure.preSignRpc?.effectRole !== "bridge" ||
    bridge?.role !== "bridge" || bridge.phase !== "unsealed" || bridge.submissionAttempts !== 0 ||
    approval?.role !== "approval" || approval.submissionAttempts !== 1) return null;
  return failure;
}
export const BRIDGE_TERMINAL: readonly BridgeState[] = ["completed", "destination_failed", "failed_before_effect", "failed_after_approval", "failed_confirmed_revert"];
export function bridgeIntentBinding(operation: Pick<BridgeOperationRecord, "schemaVersion" | "kind" | "profileHash" | "operationId" | "idempotencyHash" | "requestHash" | "intent" | "effects">) {
  return { schemaVersion: operation.schemaVersion, kind: operation.kind, profileHash: operation.profileHash,
    operationId: operation.operationId, idempotencyHash: operation.idempotencyHash, requestHash: operation.requestHash,
    intent: operation.intent, envelopes: operation.effects.map(({ envelope }) => envelope) };
}
export function newBridgeEffect(envelope: BridgeEnvelope): BridgeEffect {
  return { role: envelope.role, envelope, phase: "unsealed", transactionHash: null,
    sealedMaterialHash: null, submittedAt: null, submissionAttempts: 0, includedProof: null, safeProof: null };
}
export function bridgeSnapshot(value: BridgeMutable): Omit<BridgeTransition, "at" | "previousHash" | "transitionHash"> {
  return { state: value.state, approval: value.approval,
    effects: value.effects.map(({ envelope, ...effect }) => ({ ...effect, envelopeHash: envelope.envelopeHash })),
    sourceProof: value.sourceProof, destinationProof: value.destinationProof,
    providerObservation: value.providerObservation, destinationScan: value.destinationScan, failure: value.failure, usageLease: value.usageLease,
    ...(value.observationTelemetry === undefined ? {} : { observationTelemetry: value.observationTelemetry }) };
}
export function sealBridgeOperation(value: Omit<BridgeOperationRecord, "integrityHash">): BridgeOperationRecord {
  return { ...value, integrityHash: hashObject(value) };
}
