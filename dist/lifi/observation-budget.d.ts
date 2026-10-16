import type { Address } from "../model.js";
import type { BridgeChainId } from "./chains.js";
import type { BridgeRouteRequest, BridgeTool } from "./model.js";
/**
 * Worst-case clean requests of one canonical source observation before its archive proofs: primary chain identity,
 * transaction, receipt, included header, safe header and one uncached primary recheck of both headers. The receipt costs
 * two requests when a scalar receipt reader sends its chain identity separately, or when an empty primary receipt falls
 * back to the chain-checked archive.
 */
export declare const BRIDGE_CANONICAL_OBSERVATION_REQUESTS = 7;
/**
 * Worst-case clean HTTP requests of one source effect observation, counted from the read plans the observer sends:
 * the canonical receipt sequence, Base's pinned fee proof, then the operation-bound historical deployment proof minus
 * the exact reads the fee proof already cached, each archive plan transported in chunks of `archiveBatchItems`.
 */
export declare function bridgeSourceObservationRequests(chainId: BridgeChainId, peerChainId: BridgeChainId, tool: BridgeTool, token: Address, archiveBatchItems: number): number;
/**
 * A provider-bound native delivery adds the pre-delivery header, the archive chain identity, the two hash-pinned
 * recipient balances and the delivery call trace to the canonical sequence.
 */
export declare const BRIDGE_NATIVE_DELIVERY_REQUESTS = 5;
/**
 * Worst-case clean HTTP requests of one destination observation, counted from the destination's historical deployment
 * read plan in chunks of `archiveBatchItems`. A provider-bound native delivery reads its balances, and so the archive
 * chain identity, before that proof. The BNB composite proves the receipt and the deployment first, then observes again
 * with the delivery: the second pass reuses the cached receipt, headers and archive chain identity, so it sends the
 * delivery reads without that identity plus its uncached header recheck, again five requests.
 */
export declare function bridgeDestinationObservationRequests(request: Pick<BridgeRouteRequest, "fromChainId" | "toChainId" | "fromToken" | "toToken">, tool: BridgeTool, composite: boolean, archiveBatchItems: number): number;
