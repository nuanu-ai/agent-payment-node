import { GASLESS_DEPLOYMENTS } from "./registry.js";
/**
 * Physical POST budgets are derived from the steps each command performs, never hand-counted. One guard snapshot
 * (`GaslessRpc.snapshot`) is the chain-and-anchor read batch, the bundler batch, the state batch (split by an RPC
 * batch cap) and one anchor recheck. The state batch holds the account reads (8), the fee configuration (5), the
 * priority fee (1) and the deployment's protocol pins; the largest row bounds every chain.
 */
const STATE_READS = Math.max(...GASLESS_DEPLOYMENTS.map((row) => 8 + 5 + 1 + row.code.length + row.reads.length));
export function gaslessSnapshotPosts(maxBatchItems) {
    return 3 + Math.max(1, Math.ceil(STATE_READS / maxBatchItems));
}
/** Unsplit step costs of the original-window path (`execution.ts`); approve and resume never take a batch cap. */
export const GASLESS_STEP_POSTS = Object.freeze({
    guard: gaslessSnapshotPosts(Number.POSITIVE_INFINITY),
    /** The balance-layout witness read and the throwaway-key estimate. */
    mirror: 2,
    estimate: 1,
    /** One bundler batch: chain, EntryPoint support and the price tiers the signed fees must still cover. */
    feeCheck: 1,
    send: 1,
});
/** Transient guard, mirror and fee-check failures of one invocation share one more guard's worth of POSTs. */
export const GASLESS_RETRY_POSTS = GASLESS_STEP_POSTS.guard;
/**
 * Guard and mirror before the approval screen, a guard before each owner signature, the bootstrap estimate on the
 * bootstrap guard's fees, a fee check before the send, the send, and the retry allowance (`GASLESS_RETRY_POSTS`).
 */
function executionPosts(guard) {
    const s = GASLESS_STEP_POSTS;
    return guard + s.mirror + guard + s.estimate + guard + s.feeCheck + s.send + /* retry allowance */ guard;
}
/**
 * One observation step (`rpc-observe.ts`): chain identity, two locator reads, one scan window, then either the receipt
 * inspection or the permission-invalidation probe, plus an explicit source's anchor checks. This is the measured 0.5.41
 * allowance; the observation read diet re-derives it step by step.
 */
const OBSERVATION_POSTS = 24;
export function gaslessPostBudget(plan, maxBatchItems) {
    const snapshot = gaslessSnapshotPosts(maxBatchItems);
    switch (plan) {
        case "read": return snapshot;
        case "execute": return executionPosts(snapshot);
        case "resume": return Math.max(executionPosts(snapshot), OBSERVATION_POSTS);
        case "first_send": return 2 * snapshot + GASLESS_STEP_POSTS.send;
        case "observe": return OBSERVATION_POSTS;
    }
}
//# sourceMappingURL=rpc-budget.js.map