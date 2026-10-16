import { type BridgeEffectAuthority } from "./effect-authority.js";
import type { StateStore } from "../state.js";
import { type BridgeSave } from "./observation.js";
import { type BridgeOperationRecord } from "./operation-model.js";
import type { BridgeApprovalPort, BridgeCustodyPort, BridgeRpcPort, LifiProviderPort } from "./ports.js";
import type { BridgeRpcPhysicalBudget } from "./rpc.js";
export declare class BridgeExecution {
    private readonly state;
    private readonly source;
    private readonly destination;
    private readonly custody;
    private readonly now;
    private readonly save;
    private readonly physicalBudget?;
    private readonly observation;
    constructor(state: StateStore, source: BridgeRpcPort, destination: BridgeRpcPort, provider: LifiProviderPort, custody: BridgeCustodyPort, now: () => number, save: BridgeSave, observationRpc?: Readonly<{
        source: () => BridgeRpcPort;
        destination: () => BridgeRpcPort;
        residual: () => BridgeRpcPort;
    }>, physicalBudget?: BridgeRpcPhysicalBudget | undefined);
    approve(op: BridgeOperationRecord, approval: BridgeApprovalPort): Promise<BridgeOperationRecord>;
    private confirmForeground;
    private approved;
    resume(op: BridgeOperationRecord, approval?: BridgeApprovalPort): Promise<BridgeOperationRecord>;
    run(op: BridgeOperationRecord, authority?: BridgeEffectAuthority): Promise<BridgeOperationRecord>;
    private guard;
    private authorityPolicy;
    private allowlist;
    /**
     * A provider rate limit, transport failure or HTTP 408/5xx during a guard is transient: nothing is sealed, signed or sent,
     * the operation keeps its state with a visible reason, and the next resume repeats the full guard, which ends the
     * operation on the normal expiry path once late. Deterministic refusals halt the unsent effect as before.
     */
    private deferOrHalt;
    private haltUnsent;
    private terminalFailure;
}
