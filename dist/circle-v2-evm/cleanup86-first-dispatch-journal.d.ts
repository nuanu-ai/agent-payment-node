import { SecureStateStore } from "../secure-state-store.js";
import { type CircleOperationV1 } from "./operation-model.js";
import { type Cleanup86Intent } from "./cleanup86-store.js";
import { type Cleanup86FirstDispatchPurpose } from "./cleanup86-first-dispatch-purpose.js";
import { type Cleanup86FirstDispatchHistory } from "./cleanup86-first-dispatch-record.js";
import { type Cleanup86FirstDispatchGrant, type Cleanup86FirstDispatchBinding } from "./cleanup86-first-dispatch-authority.js";
export declare function assertAuthenticatedCleanup86FirstDispatchJournal(journal: Cleanup86FirstDispatchJournal, grant: Cleanup86FirstDispatchGrant, binding: Cleanup86FirstDispatchBinding): void;
export declare function assertAdmittedCleanup86FirstDispatchJournal(journal: Cleanup86FirstDispatchJournal, binding: Cleanup86FirstDispatchBinding): void;
/** Complete immutable original journal plus a separate create-only first-dispatch namespace. */
export declare class Cleanup86FirstDispatchJournal extends SecureStateStore {
    #private;
    readonly operation: CircleOperationV1;
    readonly intent: Cleanup86Intent;
    private constructor();
    static admit(root: string, op: CircleOperationV1, i: Cleanup86Intent): Promise<Cleanup86FirstDispatchJournal>;
    metadata(): {
        transactionHash: `0x${string}`;
        materialHash: string;
    };
    assertStable(): Promise<void>;
    protected beforeCreateOnlyPublication(): Promise<void>;
    private path;
    private adopt;
    authorize(purpose: Cleanup86FirstDispatchPurpose): Promise<void>;
    append(phase: Cleanup86FirstDispatchHistory["phase"]): Promise<void>;
    claimSend(): Promise<void>;
}
