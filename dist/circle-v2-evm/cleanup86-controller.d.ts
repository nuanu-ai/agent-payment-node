import { type CircleOperationV1 } from "./operation-model.js";
import { Cleanup86Store, type Cleanup86Intent, type Cleanup86Effect } from "./cleanup86-store.js";
import { type VerifiedCleanup86CurrentPurpose } from "./cleanup86-current-purpose.js";
import type { StateStore } from "../state.js";
import type { Cleanup85RecoveryIntent } from "./cleanup85-recovery-store.js";
import type { Cleanup86Material } from "./cleanup86-custody.js";
export interface Cleanup86Grant {
    readonly kind: "cleanup86-foreground-grant";
}
export declare function assertCleanup86Grant(grant: Cleanup86Grant, root: string, op: CircleOperationV1, intent: Cleanup86Intent): void;
export declare function claimCleanup86Custody(grant: Cleanup86Grant, root: string, op: CircleOperationV1, intent: Cleanup86Intent): void;
export interface Cleanup86Ports {
    readonly now: () => number;
    confirm(intent: Cleanup86Intent, deadline: string): Promise<void>;
    preflight(intent: Cleanup86Intent, grant?: Cleanup86Grant): Promise<void>;
    seal(intent: Cleanup86Intent, grant: Cleanup86Grant): Promise<Cleanup86Material>;
    send(material: Cleanup86Material, grant: Cleanup86Grant): Promise<`0x${string}`>;
}
/** Only an explicit foreground command invokes this. Claims are permanent even if a restorable
 * effect journal is rolled back; neither controller nor observer loads private material to retry. */
export declare function executeCleanup86(root: string, op: CircleOperationV1, intent: Cleanup86Intent, store: Cleanup86Store, ports: Cleanup86Ports, current?: {
    readonly state: StateStore;
    readonly recovery: Cleanup85RecoveryIntent;
    readonly certificate: VerifiedCleanup86CurrentPurpose;
}): Promise<Cleanup86Effect>;
