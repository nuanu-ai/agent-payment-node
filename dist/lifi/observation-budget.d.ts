import type { BridgeRouteRequest } from "./model.js";
/**
 * Clean POSTs of one invocation's source observation session, from the canonical observation plan: every sent effect is
 * observed at the start of the invocation and again after a send in it. Hash-pinned answers and the safe head are cached
 * for the session, so a repeat usually costs nothing; the cap still allows a fresh read of each.
 */
export declare function bridgeSourceObservationRequests(effects: number): number;
/**
 * Clean POSTs of one destination observation: the canonical plan, plus the native delivery reads for a provider-bound
 * native destination. The BNB composite proves the fill first and observes again with the delivery reads.
 */
export declare function bridgeDestinationObservationRequests(request: Pick<BridgeRouteRequest, "fromChainId" | "toChainId" | "fromToken" | "toToken">, composite: boolean): number;
