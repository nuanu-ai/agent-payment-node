import type { GaslessBlock, GaslessOwner, GaslessProviderBinding } from "../gasless/model.js";
import type { Address, Hex } from "../model.js";
import type { FacilitatorAuthorization, FacilitatorRequirement } from "./requirement.js";
export declare const FACILITATOR_OPERATION_VERSION: "apn.facilitator-gasless-operation.v1";
export declare const FACILITATOR_RECEIPT_VERSION: "apn.facilitator-gasless-receipt.v1";
export declare const FACILITATOR_KIND: "facilitator_gasless_transfer";
export declare const FACILITATOR_POLICY: "apn.facilitator-gasless.foreground-approval.v1";
export declare const FACILITATOR_STATES: readonly ["awaiting_approval", "approved", "verify_started", "settle_started", "settle_submitted", "completed", "expired_unused", "failed_before_effect", "abandoned_unknown"];
export type FacilitatorState = typeof FACILITATOR_STATES[number];
export declare const FACILITATOR_TERMINAL: readonly FacilitatorState[];
/** After the exposure marker the signature may be outside APN; only finalized chain evidence closes the operation. */
export declare const FACILITATOR_EXPOSED: readonly FacilitatorState[];
export declare const FACILITATOR_HISTORY_LIMIT = 64;
export declare const FACILITATOR_FILE_LIMIT: number;
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
    readonly facilitator: {
        readonly origin: string;
        readonly endpointHash: string;
        readonly signers: readonly Address[];
        readonly supportedResponseHash: string;
    };
    readonly initial: {
        readonly block: GaslessBlock;
        readonly balanceAtomic: string;
        readonly rpcOrigin: string;
        readonly rpcEndpointHash: string;
    };
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
export declare const FACILITATOR_INITIAL: FacilitatorMutable;
export declare function facilitatorMutable(op: FacilitatorMutable): FacilitatorMutable;
export declare function facilitatorBinding(op: Pick<FacilitatorOperationRecord, "schemaVersion" | "kind" | "profileHash" | "operationId" | "idempotencyHash" | "requestHash" | "intent">): {
    schemaVersion: "apn.facilitator-gasless-operation.v1";
    kind: "facilitator_gasless_transfer";
    profileHash: string;
    operationId: string;
    idempotencyHash: string;
    requestHash: string;
    intent: FacilitatorIntent;
};
export declare function sealFacilitatorOperation(op: Omit<FacilitatorOperationRecord, "integrityHash">): FacilitatorOperationRecord;
