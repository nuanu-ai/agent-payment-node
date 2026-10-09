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
    policies(op: CircleOperationV1): Promise<readonly CirclePolicy[]>;
    /** Readonly authority window from both exact owner activations while their locks remain held. */
    authorizationDeadline(op: CircleOperationV1): Promise<string | null>;
    confirm(op: CircleOperationV1): Promise<void>;
    reserve(op: CircleOperationV1): Promise<readonly AssetUsageReservation[]>;
    follow(op: CircleOperationV1, target: "unknown_finality" | "finalized" | "failed_confirmed_revert" | "failed_before_effect"): Promise<readonly AssetUsageReservation[]>;
}
