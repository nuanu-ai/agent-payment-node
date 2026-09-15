import type { WaitPort } from "../ports.js";
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
    private readonly wait;
    private readonly observation;
    constructor(state: StateStore, rpc: GaslessRpcPort, custody: GaslessCustodyPort, now: () => number, save: GaslessSave, wait: WaitPort);
    approve(op: GaslessOperationRecord, approval: GaslessApprovalPort): Promise<GaslessOperationRecord>;
    run(op: GaslessOperationRecord): Promise<GaslessOperationRecord>;
    /** `mirrored` is true only on the approval path, which already ran the mirror estimate before the screen. */
    private advance;
    private material;
    /** The same UserOperation signed by a throwaway key must fit the frozen offer before any owner material exists. */
    private mirror;
    private key;
    private at;
    private guard;
    /** After disclosure, a price spike, rate limit or transport failure is waited out rather than ending in unknown finality. */
    private patientGuard;
    private halt;
    private unknown;
}
