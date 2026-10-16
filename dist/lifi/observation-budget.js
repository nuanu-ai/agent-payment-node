import { hashObject } from "../canonical.js";
import { bridgeProviderBoundNativeDestination } from "./asset-registry.js";
import { basePinnedFeeReadPlan, bridgeDeploymentReadPlan } from "./rpc-deployment.js";
/**
 * Worst-case clean requests of one canonical source observation before its archive proofs: primary chain identity,
 * transaction, receipt, included header, safe header and one uncached primary recheck of both headers. The receipt costs
 * two requests when a scalar receipt reader sends its chain identity separately, or when an empty primary receipt falls
 * back to the chain-checked archive.
 */
export const BRIDGE_CANONICAL_OBSERVATION_REQUESTS = 7;
const PLAN_INCLUDED = { numberAtomic: "2", hash: `0x${"11".repeat(32)}`, timestampAtomic: "0" };
const PLAN_SAFE = { numberAtomic: "3", hash: `0x${"22".repeat(32)}`, timestampAtomic: "0" };
/**
 * Worst-case clean HTTP requests of one source effect observation, counted from the read plans the observer sends:
 * the canonical receipt sequence, Base's pinned fee proof, then the operation-bound historical deployment proof minus
 * the exact reads the fee proof already cached, each archive plan transported in chunks of `archiveBatchItems`.
 */
export function bridgeSourceObservationRequests(chainId, peerChainId, tool, token, archiveBatchItems) {
    const fee = readKeys(chainId === 8453 ? basePinnedFeeReadPlan(0n, PLAN_INCLUDED, PLAN_SAFE).items : []);
    const deployment = [...readKeys(bridgeDeploymentReadPlan(chainId, peerChainId, tool, token, PLAN_INCLUDED, true).items)]
        .filter((key) => !fee.has(key));
    return BRIDGE_CANONICAL_OBSERVATION_REQUESTS + Math.ceil(fee.size / archiveBatchItems) + Math.ceil(deployment.length / archiveBatchItems);
}
/**
 * A provider-bound native delivery adds the pre-delivery header, the archive chain identity, the two hash-pinned
 * recipient balances and the delivery call trace to the canonical sequence.
 */
export const BRIDGE_NATIVE_DELIVERY_REQUESTS = 5;
/**
 * Worst-case clean HTTP requests of one destination observation, counted from the destination's historical deployment
 * read plan in chunks of `archiveBatchItems`. A provider-bound native delivery reads its balances, and so the archive
 * chain identity, before that proof. The BNB composite proves the receipt and the deployment first, then observes again
 * with the delivery: the second pass reuses the cached receipt, headers and archive chain identity, so it sends the
 * delivery reads without that identity plus its uncached header recheck, again five requests.
 */
export function bridgeDestinationObservationRequests(request, tool, composite, archiveBatchItems) {
    const deployment = readKeys(bridgeDeploymentReadPlan(request.toChainId, request.fromChainId, tool, request.toToken, PLAN_INCLUDED, true).items).size;
    const chunks = (items) => Math.ceil(items / archiveBatchItems);
    if (composite)
        return BRIDGE_CANONICAL_OBSERVATION_REQUESTS + chunks(deployment) + BRIDGE_NATIVE_DELIVERY_REQUESTS;
    if (bridgeProviderBoundNativeDestination(request))
        return BRIDGE_CANONICAL_OBSERVATION_REQUESTS + BRIDGE_NATIVE_DELIVERY_REQUESTS + chunks(deployment - 1);
    return BRIDGE_CANONICAL_OBSERVATION_REQUESTS + chunks(deployment);
}
function readKeys(items) {
    return new Set(items.map((item) => hashObject({ method: item.method, params: item.params })));
}
//# sourceMappingURL=observation-budget.js.map