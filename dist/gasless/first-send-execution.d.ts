import type { StateStore } from "../state.js";
import type { GaslessAssetPolicy } from "./asset-policy.js";
import type { GaslessSave } from "./observation.js";
import type { GaslessOperationRecord } from "./operation-model.js";
import type { GaslessApprovalPort, GaslessCustodyPort, GaslessRpcPort } from "./ports.js";
/** A dedicated first-send path. It cannot sign, estimate, extend the original frame, or replay a fence. */
export declare class GaslessSealedFirstSendExecution {
    private readonly state;
    private readonly rpc;
    private readonly custody;
    private readonly policy;
    private readonly now;
    private readonly save;
    private readonly authority;
    constructor(state: StateStore, rpc: GaslessRpcPort, custody: GaslessCustodyPort, policy: GaslessAssetPolicy, now: () => number, save: GaslessSave);
    approve(op: GaslessOperationRecord, approval: GaslessApprovalPort): Promise<GaslessOperationRecord>;
}
