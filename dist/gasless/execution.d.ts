import type { GaslessAssetPolicy } from "./asset-policy.js";
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
    private readonly policy?;
    private readonly observation;
    private retryPosts;
    constructor(state: StateStore, rpc: GaslessRpcPort, custody: GaslessCustodyPort, now: () => number, save: GaslessSave, wait: WaitPort, policy?: GaslessAssetPolicy | undefined);
    approve(op: GaslessOperationRecord, approval: GaslessApprovalPort): Promise<GaslessOperationRecord>;
    run(op: GaslessOperationRecord): Promise<GaslessOperationRecord>;
    /** `mirrored` is true only on the approval path, which already ran the mirror estimate before the screen. */
    private advance;
    /** `fees` are this invocation's guard result when it signed the effect, and null when the effect was already signed. */
    private material;
    /** The same UserOperation signed by a throwaway key must fit the frozen offer before any owner material exists. */
    private mirror;
    /** Owner, policy and caps locally, then one bundler batch: the signed fees must still cover its slow tier. */
    private feeCheck;
    private key;
    private at;
    private guard;
    /**
     * A price spike, rate limit or transport failure is waited out while the approved window still leaves room for the
     * remaining steps. An interrupt, an exhausted window and every definite refusal end the operation at once.
     */
    private steady;
    private halt;
    private unknown;
}
