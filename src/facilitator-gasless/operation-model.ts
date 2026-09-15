import { hashObject } from "../canonical.js";
import type { GaslessBlock, GaslessOwner, GaslessProviderBinding } from "../gasless/model.js";
import type { Address, Hex } from "../model.js";
import type { FacilitatorAuthorization, FacilitatorRequirement } from "./requirement.js";

export const FACILITATOR_OPERATION_VERSION = "apn.facilitator-gasless-operation.v1" as const;
export const FACILITATOR_RECEIPT_VERSION = "apn.facilitator-gasless-receipt.v1" as const;
export const FACILITATOR_KIND = "facilitator_gasless_transfer" as const;
export const FACILITATOR_POLICY = "apn.facilitator-gasless.foreground-approval.v1" as const;
export const FACILITATOR_STATES = ["awaiting_approval", "approved", "verify_started", "settle_started", "settle_submitted",
  "completed", "expired_unused", "failed_before_effect", "abandoned_unknown"] as const;
export type FacilitatorState = typeof FACILITATOR_STATES[number];
export const FACILITATOR_TERMINAL: readonly FacilitatorState[] = Object.freeze(["completed", "expired_unused", "failed_before_effect",
  "abandoned_unknown"]);
/** After the exposure marker the signature may be outside APN; only finalized chain evidence closes the operation. */
export const FACILITATOR_EXPOSED: readonly FacilitatorState[] = Object.freeze(["verify_started", "settle_started", "settle_submitted"]);
export const FACILITATOR_HISTORY_LIMIT = 64;
export const FACILITATOR_FILE_LIMIT = 1024 * 1024;

export interface FacilitatorRequest {
  readonly chainId: 43114;
  readonly recipient: Address;
  readonly grossAtomic: string;
  readonly maxFeeAtomic: string;
  readonly minReceivedAtomic: string;
}
export interface FacilitatorIntent {
  readonly profile: string;
  readonly request: FacilitatorRequest;
  readonly owner: GaslessOwner;
  readonly providerBinding: GaslessProviderBinding;
  readonly requirement: FacilitatorRequirement;
  readonly requirementHash: string;
  readonly facilitator: { readonly origin: string; readonly endpointHash: string; readonly signers: readonly Address[];
    readonly supportedResponseHash: string };
  readonly initial: { readonly block: GaslessBlock; readonly balanceAtomic: string; readonly rpcOrigin: string;
    readonly rpcEndpointHash: string };
  readonly preparedAt: string;
  readonly expiresAt: string;
  readonly policyHash: string;
}
export interface FacilitatorConsent {
  readonly policy: typeof FACILITATOR_POLICY;
  readonly fingerprint: string;
  readonly approvedAt: string;
  readonly expiresAt: string;
}
/** Frozen before signing; the signature itself is never persisted, only its hash once exposure starts. */
export interface FacilitatorSigned {
  readonly authorization: FacilitatorAuthorization;
  readonly digest: Hex;
  readonly startBlock: GaslessBlock;
  readonly signatureHash: string | null;
}
/** One facilitator call. `startedAt` is the durable marker written before the request leaves APN. */
export interface FacilitatorExchange {
  readonly startedAt: string;
  readonly responseHash: string | null;
  readonly transactionHash: Hex | null;
  readonly outcome: "accepted" | "pending" | "rejected" | "unknown";
}
export interface FacilitatorObservation {
  readonly observedAt: string;
  readonly rpcOrigin: string;
  readonly rpcEndpointHash: string;
  readonly finalized: GaslessBlock;
  readonly authorizationUsed: boolean;
  readonly transactionHash: Hex | null;
}
export interface FacilitatorSettlement {
  readonly transactionHash: Hex;
  readonly block: GaslessBlock;
  readonly finalized: GaslessBlock;
  readonly receiptHash: string;
  readonly deliveredAtomic: string;
  readonly rpcOrigin: string;
  readonly rpcEndpointHash: string;
  readonly observedAt: string;
}
export interface FacilitatorMutable {
  readonly state: FacilitatorState;
  readonly approval: FacilitatorConsent | null;
  readonly signed: FacilitatorSigned | null;
  readonly verify: FacilitatorExchange | null;
  readonly settle: FacilitatorExchange | null;
  readonly observation: FacilitatorObservation | null;
  readonly settlement: FacilitatorSettlement | null;
  readonly failure: string | null;
}
export interface FacilitatorTransition extends FacilitatorMutable {
  readonly at: string;
  readonly previousHash: string;
  readonly transitionHash: string;
}
export interface FacilitatorOperationRecord extends FacilitatorMutable {
  readonly schemaVersion: typeof FACILITATOR_OPERATION_VERSION;
  readonly kind: typeof FACILITATOR_KIND;
  readonly profileHash: string;
  readonly operationId: string;
  readonly idempotencyHash: string;
  readonly requestHash: string;
  readonly fingerprint: string;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly terminal: boolean;
  readonly intent: FacilitatorIntent;
  readonly transitions: readonly FacilitatorTransition[];
  readonly integrityHash: string;
}

export const FACILITATOR_INITIAL: FacilitatorMutable = Object.freeze({ state: "awaiting_approval", approval: null, signed: null,
  verify: null, settle: null, observation: null, settlement: null, failure: null });

export function facilitatorMutable(op: FacilitatorMutable): FacilitatorMutable {
  return { state: op.state, approval: op.approval, signed: op.signed, verify: op.verify, settle: op.settle,
    observation: op.observation, settlement: op.settlement, failure: op.failure };
}
export function facilitatorBinding(op: Pick<FacilitatorOperationRecord,
  "schemaVersion" | "kind" | "profileHash" | "operationId" | "idempotencyHash" | "requestHash" | "intent">) {
  return { schemaVersion: op.schemaVersion, kind: op.kind, profileHash: op.profileHash, operationId: op.operationId,
    idempotencyHash: op.idempotencyHash, requestHash: op.requestHash, intent: op.intent };
}
export function sealFacilitatorOperation(op: Omit<FacilitatorOperationRecord, "integrityHash">): FacilitatorOperationRecord {
  return { ...op, integrityHash: hashObject(op) };
}
