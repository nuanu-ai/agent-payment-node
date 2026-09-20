import { hashObject } from "../canonical.js";
import type {
  BridgeAccountSnapshot, BridgeBlock, BridgeDeploymentIdentity, BridgeDestinationProof,
  BridgeDestinationScan, BridgeEnvelope, BridgeMaterialization, BridgeOwner,
  BridgeProviderBinding, BridgeProviderObservation, BridgeResidualAllowance,
  BridgeSourceProof, BridgeTransactionProof, DecodedBridgeCall,
} from "./model.js";
import type { Hex } from "../model.js";
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
}
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
    providerObservation: value.providerObservation, destinationScan: value.destinationScan, failure: value.failure, usageLease: value.usageLease };
}
export function sealBridgeOperation(value: Omit<BridgeOperationRecord, "integrityHash">): BridgeOperationRecord {
  return { ...value, integrityHash: hashObject(value) };
}
