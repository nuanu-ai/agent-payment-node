import { hashObject } from "../canonical.js";
import type { Address, Hex } from "../model.js";
import type { BridgeChainId } from "./chains.js";
import type { BridgeBlock, BridgeTool } from "./model.js";
import { basePinnedFeeReadPlan, bridgeDeploymentReadPlan } from "./rpc-deployment.js";

/**
 * Worst-case clean requests of one canonical source observation before its archive proofs: primary chain identity,
 * transaction, receipt, included header, safe header and one uncached primary recheck of both headers. The receipt costs
 * two requests when a scalar receipt reader sends its chain identity separately, or when an empty primary receipt falls
 * back to the chain-checked archive.
 */
export const BRIDGE_CANONICAL_OBSERVATION_REQUESTS = 7;
const PLAN_INCLUDED: BridgeBlock = { numberAtomic: "2", hash: `0x${"11".repeat(32)}` as Hex, timestampAtomic: "0" };
const PLAN_SAFE: BridgeBlock = { numberAtomic: "3", hash: `0x${"22".repeat(32)}` as Hex, timestampAtomic: "0" };

/**
 * Worst-case clean HTTP requests of one source effect observation, counted from the read plans the observer sends:
 * the canonical receipt sequence, Base's pinned fee proof, then the operation-bound historical deployment proof minus
 * the exact reads the fee proof already cached, each archive plan transported in chunks of `archiveBatchItems`.
 */
export function bridgeSourceObservationRequests(chainId: BridgeChainId, peerChainId: BridgeChainId, tool: BridgeTool, token: Address,
  archiveBatchItems: number): number {
  const fee = readKeys(chainId === 8453 ? basePinnedFeeReadPlan(0n, PLAN_INCLUDED, PLAN_SAFE).items : []);
  const deployment = [...readKeys(bridgeDeploymentReadPlan(chainId, peerChainId, tool, token, PLAN_INCLUDED, true).items)]
    .filter((key) => !fee.has(key));
  return BRIDGE_CANONICAL_OBSERVATION_REQUESTS + Math.ceil(fee.size / archiveBatchItems) + Math.ceil(deployment.length / archiveBatchItems);
}
function readKeys(items: readonly { readonly method: string; readonly params: readonly unknown[] }[]): ReadonlySet<string> {
  return new Set(items.map((item) => hashObject({ method: item.method, params: item.params })));
}
