import type { CircleFundingOperationV2 } from "./funding-operation.js";
import { type AssetUsageReservation } from "../asset-usage-ledger.js";
import type { StateStore } from "../state.js";
import { type CirclePolicy } from "./operation-model.js";
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
    policies(op: CircleFundingOperationV2): Promise<readonly CirclePolicy[]>;
    /** Readonly authority window from both exact owner activations while their locks remain held. */
    authorizationDeadline(op: CircleFundingOperationV2, policies?: readonly CirclePolicy[]): Promise<string | null>;
    confirm(op: CircleFundingOperationV2, policies?: readonly CirclePolicy[]): Promise<void>;
    reserve(op: CircleFundingOperationV2): Promise<readonly AssetUsageReservation[]>;
    /** V2 explicit public settlement: source caps remain USED; owned never-entered effects consume zero. */
    followFundingExternalFulfillment(op: CircleFundingOperationV2): Promise<readonly AssetUsageReservation[]>;
    follow(op: CircleFundingOperationV2, target: "unknown_finality" | "finalized" | "failed_confirmed_revert" | "failed_before_effect" | "released_unsubmitted"): Promise<readonly AssetUsageReservation[]>;
}
