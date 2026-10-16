import type { BridgeBlock, BridgeRouteRequest, BridgeTool } from "./model.js";
import type { BridgeOperationRecord } from "./operation-model.js";
/** Explicit headroom over the clean send step: four session retries of a 408, 5xx or transport failure. */
export declare const BRIDGE_SEND_STEP_RETRY_POSTS = 4;
/** The residual allowance read: one moving head batch and one account batch. */
export declare const BRIDGE_RESIDUAL_OBSERVATION_REQUESTS = 2;
/**
 * Clean POSTs of the step that signs and sends an unsent effect, counted from the guard's read plans: per chain one
 * safe head and its deployment proof chunks, then the two source account batches. After sealing, a second guard reuses
 * the cached proofs and reads both account batches again before the one raw send. A foreground approval refreshes the
 * account batches once more after consent. A retained Base Stargate refresh counts its retained batch.
 */
export declare function bridgeSendStepPosts(request: Pick<BridgeRouteRequest, "fromChainId" | "toChainId" | "fromToken" | "toToken">, tool: BridgeTool, guard: Readonly<{
    consent: boolean;
    retained: {
        source: BridgeBlock;
        destination: BridgeBlock;
    } | null;
}>, archiveBatchItems: number): number;
/** The invocation POST budget of an operation that may still sign and send: its send step plus explicit headroom, else zero. */
export declare function bridgeSendStepPostBudget(op: BridgeOperationRecord, archiveBatchItems: number): number;
/**
 * One invocation's physical POST cap for any route, derived from the same read plans as each session's own cap: the
 * sign-and-send step when an effect is still unsent, one source observation session, one destination observation
 * session and the residual allowance read. Each session keeps its own plan-derived cap; this one only bounds their sum.
 */
export declare function bridgeInvocationPostBudget(op: BridgeOperationRecord, archiveBatchItems: number): number;
