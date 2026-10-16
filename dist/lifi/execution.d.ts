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
    /** The source deployment check passed in this invocation with no consent wait since (P2: proved once per invocation). */
    private deploymentChecked;
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
    private claims;
    /**
     * signing_started with no sealed material and no SEND claim: the process stopped between the durable marker and custody,
     * so nothing was signed into custody and nothing could have been broadcast. The effect returns to unsealed; the normal
     * path then runs the full guard again and re-signs the identical envelope (same nonce and fields; RFC 6979 gives the same
     * bytes, and the idempotent SIGN claim proves the same intent), or ends it on the expiry path. A SEND claim keeps its own
     * observe-only path.
     */
    private releaseUnsignedSeal;
    /** Catches the journal up with a SEND claim from the exact sealed material, without signing or sending, then observes. */
    private recordClaimedSend;
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
