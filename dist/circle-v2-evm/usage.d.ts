import { type HeldCleanup85Scope } from "../circle-cleanup85-financial-scope.js";
import type { Cleanup85CancellationRequest } from "../circle-cleanup85-cancellation-contract.js";
import { type VerifiedHistoricalPaidClosure } from "./historical-paid-closure.js";
import { type VerifiedCleanup85Settlement } from "./cleanup85-settlement-authority.js";
import type { CircleNonceRetirementProof } from "./nonce-retirement-proof.js";
import { type AssetUsageReservation } from "../asset-usage-ledger.js";
import type { StateStore } from "../state.js";
import { type CircleDestinationChain } from "./catalog.js";
import { type CircleOperationV1, type CirclePolicy } from "./operation-model.js";
export declare const circleMechanism: (chain: CircleDestinationChain) => {
    provider: string;
    reference: string;
};
export declare class CircleUsage {
    private readonly state;
    private readonly now;
    private readonly ledger;
    private readonly policiesStore;
    private readonly policyScope;
    constructor(state: StateStore, now: () => number);
    /** Wallet/operation/address locks are outermost; policy locks are held through every effect. */
    withPolicyLocks<T>(profiles: readonly string[], action: () => Promise<T>): Promise<T>;
    /** Finite cleanup scope only: the private wrapper already owns every policy lock. */
    withCleanup85HeldPolicyScope<T>(held: HeldCleanup85Scope, request: Cleanup85CancellationRequest, operationId: string, action: () => Promise<T>): Promise<T>;
    private active;
    policies(op: CircleOperationV1): Promise<readonly CirclePolicy[]>;
    /** Capture new cleanup authority without reserving or counting historical holds twice. */
    retirementPolicies(op: CircleOperationV1): Promise<readonly CirclePolicy[]>;
    /** Readonly authority window from both exact owner activations while their locks remain held. */
    authorizationDeadline(op: CircleOperationV1, policies?: readonly CirclePolicy[]): Promise<string | null>;
    confirm(op: CircleOperationV1, policies?: readonly CirclePolicy[]): Promise<void>;
    reserve(op: CircleOperationV1): Promise<readonly AssetUsageReservation[]>;
    /** Finite historical completion consumes fresh private source+destination provenance before ledger access. */
    closeHistoricalPaid(op: CircleOperationV1, authority: VerifiedHistoricalPaidClosure): Promise<readonly AssetUsageReservation[]>;
    followExternalFulfillment(op: CircleOperationV1): Promise<readonly AssetUsageReservation[]>;
    /** Only a fully verified versioned recovery chooses the new86 fee; old cleanup85 stays unknown. */
    closeCleanup85Recovery(op: CircleOperationV1, proof: CircleNonceRetirementProof, authority: VerifiedCleanup85Settlement): Promise<readonly AssetUsageReservation[]>;
    follow(op: CircleOperationV1, target: "unknown_finality" | "finalized" | "failed_confirmed_revert" | "failed_before_effect"): Promise<readonly AssetUsageReservation[]>;
}
