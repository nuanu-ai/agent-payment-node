import type { GaslessApprovalPort } from "../gasless/ports.js";
import type { StateStore } from "../state.js";
import type { FacilitatorSignerPort } from "./custody.js";
import type { FacilitatorPort } from "./facilitator.js";
import { type FacilitatorMutable, type FacilitatorOperationRecord } from "./operation-model.js";
import type { FacilitatorRpcPort } from "./rpc.js";
export type FacilitatorSave = (op: FacilitatorOperationRecord, patch: Partial<FacilitatorMutable>) => Promise<FacilitatorOperationRecord>;
export declare class FacilitatorExecution {
    private readonly state;
    private readonly rpc;
    private readonly facilitator;
    private readonly signer;
    private readonly now;
    private readonly save;
    constructor(state: StateStore, rpc: () => FacilitatorRpcPort, facilitator: FacilitatorPort, signer: FacilitatorSignerPort, now: () => number, save: FacilitatorSave);
    approve(op: FacilitatorOperationRecord, approval: GaslessApprovalPort): Promise<FacilitatorOperationRecord>;
    /** Recovery never signs, verifies or settles again. */
    run(op: FacilitatorOperationRecord): Promise<FacilitatorOperationRecord>;
    private reconcile;
    private complete;
    private guard;
    private expired;
    private exchange;
    private at;
}
