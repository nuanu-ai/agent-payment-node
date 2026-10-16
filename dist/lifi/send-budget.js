import { bridgeDeploymentCheck } from "./deployment-check.js";
import { bridgeDestinationObservationRequests, bridgeSourceObservationRequests } from "./observation-budget.js";
/** Explicit headroom over a clean step: four session retries of a 408, 5xx or transport failure. */
export const BRIDGE_SEND_STEP_RETRY_POSTS = 4;
/** Retry headroom of each observation session: one retried POST of its first and last batch. */
export const BRIDGE_OBSERVATION_RETRY_POSTS = 2;
/** The residual allowance read: one account batch. */
export const BRIDGE_RESIDUAL_OBSERVATION_REQUESTS = 1;
/** The account batch that re-checks nonce, allowance, balance, simulation and fees right before a send, and the send. */
const ACCOUNT_BATCH = 1, RAW_SEND = 1;
/** One full guard: the source check with the account in one batch, plus the destination check where that role reads. */
export function bridgeGuardPosts(request, tool) {
    const destination = bridgeDeploymentCheck(request.toChainId, request.fromChainId, tool, request.toToken, "destination");
    return ACCOUNT_BATCH + (destination.reads.length > 0 || destination.bnbPool ? 1 : 0);
}
/** Prepare: the source check with the account, and the destination head with its role's check. */
export function bridgePreparePostBudget() { return 2 + BRIDGE_SEND_STEP_RETRY_POSTS; }
/**
 * Clean POSTs of the step that signs and sends the unsent effects, counted from the guard plans: a foreground approval
 * guards once before consent and again after it; the first effect's pre-sign guard is full, a later effect of the same
 * invocation re-reads only its account (the deployment was checked in this invocation); every effect re-checks its account
 * right before its single raw send.
 */
export function bridgeSendStepPosts(request, tool, guard) {
    const full = bridgeGuardPosts(request, tool);
    return (guard.consent ? full : 0) + full + ACCOUNT_BATCH + RAW_SEND + Math.max(0, guard.effects - 1) * (2 * ACCOUNT_BATCH + RAW_SEND);
}
/** The POST budget of an operation's unsent effects: its send step plus explicit headroom, else zero. */
export function bridgeSendStepPostBudget(op) {
    const unsent = op.effects.filter((effect) => effect.submissionAttempts === 0).length;
    if (op.terminal || unsent === 0)
        return 0;
    const m = op.intent.materialization;
    return bridgeSendStepPosts(m.request, m.tool, { consent: op.state === "awaiting_approval", effects: unsent }) + BRIDGE_SEND_STEP_RETRY_POSTS;
}
/**
 * One invocation's physical POST cap for any route, the sum of its sessions' caps from the same read plans: the send step
 * when an effect is still unsent, the source and destination observation sessions and the residual allowance read, each
 * with its retry headroom. An exhausted cap defers to the next resume; it never records unknown finality.
 */
export function bridgeInvocationPostBudget(op) {
    if (op.terminal)
        return 0;
    const m = op.intent.materialization;
    return bridgeSendStepPostBudget(op) +
        bridgeSourceObservationRequests(op.effects.length) + BRIDGE_OBSERVATION_RETRY_POSTS +
        bridgeDestinationObservationRequests(m.request, op.intent.decoded.composite !== undefined) + BRIDGE_OBSERVATION_RETRY_POSTS +
        BRIDGE_RESIDUAL_OBSERVATION_REQUESTS + 1;
}
//# sourceMappingURL=send-budget.js.map