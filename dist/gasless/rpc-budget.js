import { GASLESS_DEPLOYMENTS } from "./registry.js";
/**
 * Physical POST budgets are derived from the steps each command performs, never hand-counted. One guard snapshot
 * (`GaslessRpc.snapshot`) is the chain-and-anchor read batch, the bundler batch and the state batch (split by an RPC
 * batch cap). The state batch holds the account reads (8), the fee configuration (5), the priority fee (1), the
 * deployment's protocol pins and the anchor's own header, re-read in the same request instead of a separate recheck;
 * the largest row bounds every chain.
 */
const ACCOUNT_READS = 8;
const STATE_READS = Math.max(...GASLESS_DEPLOYMENTS.map((row) => ACCOUNT_READS + 5 + 1 + row.code.length + row.reads.length + 1));
/** Blocks one canonical scan window covers; each window is one request of bounded `eth_getLogs` ranges. */
export const GASLESS_SCAN_WINDOW_BLOCKS = 256n;
/** Range of one `eth_getLogs` request, inside the limits public RPCs put on log queries. */
export const GASLESS_LOG_REQUEST_BLOCKS = 10n;
/** Windows one observation step may scan before it stops at a durable cursor (1,024 blocks). */
export const GASLESS_SCAN_WINDOWS = 4;
const LOG_REQUESTS = Number((GASLESS_SCAN_WINDOW_BLOCKS + GASLESS_LOG_REQUEST_BLOCKS - 1n) / GASLESS_LOG_REQUEST_BLOCKS);
function posts(items, maxBatchItems) { return Math.max(1, Math.ceil(items / maxBatchItems)); }
export function gaslessSnapshotPosts(maxBatchItems) {
    return 2 + posts(STATE_READS, maxBatchItems);
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
 * One observation step (`rpc-observe.ts`): the chain identity, two bundler locator reads, the safe and cursor anchors,
 * up to `GASLESS_SCAN_WINDOWS` scan windows (each window's end header and its log ranges in one request), then either
 * the receipt inspection (transaction and receipt; the inclusion, parent and safe headers; the safe-head account with
 * the inclusion header re-read) or the permission-invalidation probe (the head header; the safe and head accounts).
 */
function observationPosts(maxBatchItems) {
    const inspect = 1 + posts(3, maxBatchItems) + posts(ACCOUNT_READS + 1, maxBatchItems);
    const probe = posts(1, maxBatchItems) + posts(2 * ACCOUNT_READS, maxBatchItems);
    return 1 + 2 + posts(2, maxBatchItems) + GASLESS_SCAN_WINDOWS * posts(1 + LOG_REQUESTS, maxBatchItems) +
        Math.max(inspect, probe);
}
export function gaslessPostBudget(plan, maxBatchItems) {
    const snapshot = gaslessSnapshotPosts(maxBatchItems);
    switch (plan) {
        case "read": return snapshot;
        case "execute": return executionPosts(snapshot);
        case "resume": return Math.max(executionPosts(snapshot), observationPosts(maxBatchItems));
        case "first_send": return 2 * snapshot + GASLESS_STEP_POSTS.send;
        case "observe": return observationPosts(maxBatchItems);
    }
}
//# sourceMappingURL=rpc-budget.js.map