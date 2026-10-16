import type { Address } from "../model.js";
import type { BridgeChainId } from "./chains.js";
import type { BridgeTool } from "./model.js";
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
