import { hashObject } from "../canonical.js";
import { bridgeApprovalPolicyBinding } from "./economics.js";
import { bridgeDeploymentReadPlan, bridgeRetainedDeploymentReadPlan, bridgeRetainedRefreshEligible } from "./rpc-deployment.js";
import { bridgeDestinationObservationRequests, bridgeSourceObservationRequests } from "./observation-budget.js";
/** Explicit headroom over the clean send step: four session retries of a 408, 5xx or transport failure. */
export const BRIDGE_SEND_STEP_RETRY_POSTS = 4;
const SAFE_HEAD = 1, ACCOUNT_BATCHES = 2, RAW_SEND = 1;
/** The residual allowance read: one moving head batch and one account batch. */
export const BRIDGE_RESIDUAL_OBSERVATION_REQUESTS = 2;
const PLAN_SAFE = { numberAtomic: "0", hash: `0x${"33".repeat(32)}`, timestampAtomic: "0" };
/**
 * Clean POSTs of the step that signs and sends an unsent effect, counted from the guard's read plans: per chain one
 * safe head and its deployment proof chunks, then the two source account batches. After sealing, a second guard reuses
 * the cached proofs and reads both account batches again before the one raw send. A foreground approval refreshes the
 * account batches once more after consent. A retained Base Stargate refresh counts its retained batch.
 */
export function bridgeSendStepPosts(request, tool, guard, archiveBatchItems) {
    const refresh = (chainId, peerChainId, token, frozen) => {
        const items = frozen !== undefined && bridgeRetainedRefreshEligible(chainId, tool, frozen)
            ? bridgeRetainedDeploymentReadPlan(chainId, peerChainId, tool, token, PLAN_SAFE, frozen).items
            : bridgeDeploymentReadPlan(chainId, peerChainId, tool, token, PLAN_SAFE, false).items;
        return SAFE_HEAD + Math.ceil(new Set(items.map((item) => hashObject({ method: item.method, params: item.params }))).size / archiveBatchItems);
    };
    const first = refresh(request.fromChainId, request.toChainId, request.fromToken, guard.retained?.source) +
        refresh(request.toChainId, request.fromChainId, request.toToken, guard.retained?.destination) + ACCOUNT_BATCHES;
    return first + (guard.consent ? ACCOUNT_BATCHES : 0) + ACCOUNT_BATCHES + RAW_SEND;
}
/** The invocation POST budget of an operation that may still sign and send: its send step plus explicit headroom, else zero. */
export function bridgeSendStepPostBudget(op, archiveBatchItems) {
    if (op.terminal || op.effects.every((effect) => effect.submissionAttempts === 1))
        return 0;
    const i = op.intent, m = i.materialization;
    const retained = bridgeApprovalPolicyBinding(m, i.policyHash, i.preparedAt) === "deployment-proof-v1"
        ? { source: i.sourceDeployment.block, destination: i.destinationDeployment.block } : null;
    return bridgeSendStepPosts(m.request, m.tool, { consent: op.state === "awaiting_approval", retained }, archiveBatchItems) + BRIDGE_SEND_STEP_RETRY_POSTS;
}
/**
 * One invocation's physical POST cap for any route, derived from the same read plans as each session's own cap: the
 * sign-and-send step when an effect is still unsent, one source observation session, one destination observation
 * session and the residual allowance read. Each session keeps its own plan-derived cap; this one only bounds their sum.
 */
export function bridgeInvocationPostBudget(op, archiveBatchItems) {
    if (op.terminal)
        return 0;
    const m = op.intent.materialization, r = m.request;
    return bridgeSendStepPostBudget(op, archiveBatchItems) +
        bridgeSourceObservationRequests(r.fromChainId, r.toChainId, m.tool, r.fromToken, archiveBatchItems) +
        bridgeDestinationObservationRequests(r, m.tool, op.intent.decoded.composite !== undefined, archiveBatchItems) +
        BRIDGE_RESIDUAL_OBSERVATION_REQUESTS;
}
//# sourceMappingURL=send-budget.js.map