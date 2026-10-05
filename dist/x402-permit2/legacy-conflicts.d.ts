import { SecureStateStore } from "../secure-state-store.js";
export interface Permit2LegacyConflict {
    readonly operationId: string;
    readonly profileHash: string;
    readonly idempotencyHash: string;
    readonly requestHash: string;
    readonly terminal: false;
    readonly state: string;
    readonly chainId: 43114;
    readonly account: string;
}
/** Mere blocked unsigned intents do not claim account conflicts. Existing lease/exposure risk does. */
export declare class Permit2LegacyConflictRepository extends SecureStateStore {
    listOperations(profileHash: string): Promise<readonly Permit2LegacyConflict[]>;
}
