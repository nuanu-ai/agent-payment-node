import type { Address } from "../model.js";
import type { StateStore } from "../state.js";
import type { StargateNativeOperation, StargateNativePolicyBinding, StargateNativeUsageTarget } from "./native-execution.js";
/** Owner admission and the shared asset-usage ledger for the native lane, in the token lane's shape. */
export declare class StargateNativeUsage {
    private readonly state;
    private readonly now;
    private readonly ledger;
    constructor(state: StateStore, now: () => number);
    admitPolicy(input: Readonly<{
        profile: string;
        owner: Address;
        amountAtomic: string;
    }>): Promise<StargateNativePolicyBinding>;
    /** Before signing: the active policy must still be the prepared one, and the principal is held under the shared caps. */
    reserve(op: StargateNativeOperation): Promise<void>;
    /** Idempotent: brings the hold to the state the journal proves, and never reopens a terminal hold. */
    follow(op: StargateNativeOperation, target: StargateNativeUsageTarget): Promise<void>;
    private active;
    private admit;
}
