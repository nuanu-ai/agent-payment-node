/** Blocks one canonical scan window covers; each window is one request of bounded `eth_getLogs` ranges. */
export declare const GASLESS_SCAN_WINDOW_BLOCKS = 256n;
/** Range of one `eth_getLogs` request, inside the limits public RPCs put on log queries. */
export declare const GASLESS_LOG_REQUEST_BLOCKS = 10n;
/** Windows one observation step may scan before it stops at a durable cursor (1,024 blocks). */
export declare const GASLESS_SCAN_WINDOWS = 4;
export declare function gaslessSnapshotPosts(maxBatchItems: number): number;
/** Unsplit step costs of the original-window path (`execution.ts`); approve and resume never take a batch cap. */
export declare const GASLESS_STEP_POSTS: Readonly<{
    guard: number;
    /** The balance-layout witness read and the throwaway-key estimate. */
    mirror: 2;
    estimate: 1;
    /** One bundler batch: chain, EntryPoint support and the price tiers the signed fees must still cover. */
    feeCheck: 1;
    send: 1;
}>;
/** Transient guard, mirror and fee-check failures of one invocation share one more guard's worth of POSTs. */
export declare const GASLESS_RETRY_POSTS: number;
/**
 * `read`: one snapshot (balance, quote, prepare). `execute`: the original-window path. `resume`: either that path or one
 * observation step. `first_send`: a guard before and after fresh consent, then the send. `observe`: one observation step.
 */
export type GaslessInvocationPlan = "read" | "execute" | "resume" | "first_send" | "observe";
export declare function gaslessPostBudget(plan: GaslessInvocationPlan, maxBatchItems: number): number;
