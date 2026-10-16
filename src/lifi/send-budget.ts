import { hashObject } from "../canonical.js";
import type { Address, Hex } from "../model.js";
import { bridgeApprovalPolicyBinding } from "./economics.js";
import type { BridgeBlock, BridgeRouteRequest, BridgeTool } from "./model.js";
import type { BridgeOperationRecord } from "./operation-model.js";
import { bridgeDeploymentReadPlan, bridgeRetainedDeploymentReadPlan, bridgeRetainedRefreshEligible } from "./rpc-deployment.js";

/** Explicit headroom over the clean send step: four session retries of a 408, 5xx or transport failure. */
export const BRIDGE_SEND_STEP_RETRY_POSTS = 4;
const SAFE_HEAD = 1, ACCOUNT_BATCHES = 2, RAW_SEND = 1;
const PLAN_SAFE: BridgeBlock = { numberAtomic: "0", hash: `0x${"33".repeat(32)}` as Hex, timestampAtomic: "0" };

/**
 * Clean POSTs of the step that signs and sends an unsent effect, counted from the guard's read plans: per chain one
 * safe head and its deployment proof chunks, then the two source account batches. After sealing, a second guard reuses
 * the cached proofs and reads both account batches again before the one raw send. A foreground approval refreshes the
 * account batches once more after consent. A retained Base Stargate refresh counts its retained batch.
 */
export function bridgeSendStepPosts(request: Pick<BridgeRouteRequest, "fromChainId" | "toChainId" | "fromToken" | "toToken">, tool: BridgeTool,
  guard: Readonly<{ consent: boolean; retained: { source: BridgeBlock; destination: BridgeBlock } | null }>, archiveBatchItems: number): number {
  const refresh = (chainId: typeof request.fromChainId, peerChainId: typeof request.fromChainId, token: Address, frozen: BridgeBlock | undefined) => {
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
export function bridgeSendStepPostBudget(op: BridgeOperationRecord, archiveBatchItems: number): number {
  if (op.terminal || op.effects.every((effect) => effect.submissionAttempts === 1)) return 0;
  const i = op.intent, m = i.materialization;
  const retained = bridgeApprovalPolicyBinding(m, i.policyHash, i.preparedAt) === "deployment-proof-v1"
    ? { source: i.sourceDeployment.block, destination: i.destinationDeployment.block } : null;
  return bridgeSendStepPosts(m.request, m.tool, { consent: op.state === "awaiting_approval", retained }, archiveBatchItems) + BRIDGE_SEND_STEP_RETRY_POSTS;
}
