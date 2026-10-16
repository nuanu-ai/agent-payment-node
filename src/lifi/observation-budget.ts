import { bridgeProviderBoundNativeDestination } from "./asset-registry.js";
import type { BridgeRouteRequest } from "./model.js";
import { BRIDGE_CANONICAL_OBSERVATION_POSTS, BRIDGE_NATIVE_DELIVERY_POSTS } from "./rpc-observation.js";

/**
 * Clean POSTs of one invocation's source observation session, from the canonical observation plan: every sent effect is
 * observed at the start of the invocation and again after a send in it. Hash-pinned answers and the safe head are cached
 * for the session, so a repeat usually costs nothing; the cap still allows a fresh read of each.
 */
export function bridgeSourceObservationRequests(effects: number): number {
  return effects * 2 * BRIDGE_CANONICAL_OBSERVATION_POSTS;
}
/**
 * Clean POSTs of one destination observation: the canonical plan, plus the native delivery reads for a provider-bound
 * native destination. The BNB composite proves the fill first and observes again with the delivery reads.
 */
export function bridgeDestinationObservationRequests(request: Pick<BridgeRouteRequest, "fromChainId" | "toChainId" | "fromToken" | "toToken">,
  composite: boolean): number {
  if (composite) return 2 * BRIDGE_CANONICAL_OBSERVATION_POSTS + BRIDGE_NATIVE_DELIVERY_POSTS;
  return BRIDGE_CANONICAL_OBSERVATION_POSTS + (bridgeProviderBoundNativeDestination(request) ? BRIDGE_NATIVE_DELIVERY_POSTS : 0);
}
