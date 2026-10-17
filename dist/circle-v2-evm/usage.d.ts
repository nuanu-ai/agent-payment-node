import type { CircleFundingOperationV2, CircleKnownOperation } from "./funding-operation.js";
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
    private active;
    policies(op: CircleKnownOperation): Promise<readonly CirclePolicy[]>;
    /** Capture new cleanup authority without reserving or counting historical holds twice. */
    retirementPolicies(op: CircleOperationV1): Promise<readonly CirclePolicy[]>;
    /** Readonly authority window from both exact owner activations while their locks remain held. */
    authorizationDeadline(op: CircleKnownOperation, policies?: readonly CirclePolicy[]): Promise<string | null>;
    confirm(op: CircleKnownOperation, policies?: readonly CirclePolicy[]): Promise<void>;
    reserve(op: CircleKnownOperation): Promise<readonly AssetUsageReservation[]>;
    followExternalFulfillment(op: CircleOperationV1): Promise<readonly AssetUsageReservation[]>;
    /** V2 explicit public settlement: source caps remain USED; owned never-entered effects consume zero. */
    followFundingExternalFulfillment(op: CircleFundingOperationV2): Promise<readonly AssetUsageReservation[]>;
    follow(op: CircleKnownOperation, target: "unknown_finality" | "finalized" | "failed_confirmed_revert" | "failed_before_effect" | "released_unsubmitted"): Promise<readonly AssetUsageReservation[]>;
}
