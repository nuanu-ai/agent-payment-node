import type { StateStore } from "../state.js";
import { type GaslessSave } from "./observation.js";
import type { GaslessOperationRecord } from "./operation-model.js";
import type { GaslessApprovalPort, GaslessCustodyPort, GaslessRpcPort } from "./ports.js";
export declare class GaslessExecution {
    private readonly state;
    private readonly rpc;
    private readonly custody;
    private readonly now;
    private readonly save;
    private readonly observation;
    constructor(state: StateStore, rpc: GaslessRpcPort, custody: GaslessCustodyPort, now: () => number, save: GaslessSave);
    approve(op: GaslessOperationRecord, approval: GaslessApprovalPort): Promise<GaslessOperationRecord>;
    run(op: GaslessOperationRecord): Promise<GaslessOperationRecord>;
    private material;
    private key;
    private at;
    private guard;
    private halt;
    private unknown;
}
