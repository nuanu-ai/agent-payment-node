import type { StateStore } from "../state.js";
import { type BridgeSave } from "./observation.js";
import { type BridgeOperationRecord } from "./operation-model.js";
import type { BridgeApprovalPort, BridgeCustodyPort, BridgeRpcPort, LifiProviderPort } from "./ports.js";
export declare class BridgeExecution {
    private readonly state;
    private readonly source;
    private readonly destination;
    private readonly custody;
    private readonly now;
    private readonly save;
    private readonly observation;
    constructor(state: StateStore, source: BridgeRpcPort, destination: BridgeRpcPort, provider: LifiProviderPort, custody: BridgeCustodyPort, now: () => number, save: BridgeSave);
    approve(op: BridgeOperationRecord, approval: BridgeApprovalPort): Promise<BridgeOperationRecord>;
    run(op: BridgeOperationRecord): Promise<BridgeOperationRecord>;
    private guard;
    private allowlist;
    private haltUnsent;
    private terminalFailure;
}
