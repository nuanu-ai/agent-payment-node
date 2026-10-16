import type { BridgeRouteRequest, BridgeTool } from "./model.js";
import type { BridgeOperationRecord } from "./operation-model.js";
/** Explicit headroom over a clean step: four session retries of a 408, 5xx or transport failure. */
export declare const BRIDGE_SEND_STEP_RETRY_POSTS = 4;
/** Retry headroom of each observation session: one retried POST of its first and last batch. */
export declare const BRIDGE_OBSERVATION_RETRY_POSTS = 2;
/** The residual allowance read: one account batch. */
export declare const BRIDGE_RESIDUAL_OBSERVATION_REQUESTS = 1;
/** One full guard: the source check with the account in one batch, plus the destination check where that role reads. */
export declare function bridgeGuardPosts(request: Pick<BridgeRouteRequest, "fromChainId" | "toChainId" | "toToken">, tool: BridgeTool): number;
/** Prepare: the source check with the account, and the destination head with its role's check. */
export declare function bridgePreparePostBudget(): number;
/**
 * Clean POSTs of the step that signs and sends the unsent effects, counted from the guard plans: a foreground approval
 * guards once before consent and again after it; the first effect's pre-sign guard is full, a later effect of the same
 * invocation re-reads only its account (the deployment was checked in this invocation); every effect re-checks its account
 * right before its single raw send.
 */
export declare function bridgeSendStepPosts(request: Pick<BridgeRouteRequest, "fromChainId" | "toChainId" | "toToken">, tool: BridgeTool, guard: Readonly<{
    consent: boolean;
    effects: number;
}>): number;
/** The POST budget of an operation's unsent effects: its send step plus explicit headroom, else zero. */
export declare function bridgeSendStepPostBudget(op: BridgeOperationRecord): number;
/**
 * One invocation's physical POST cap for any route, the sum of its sessions' caps from the same read plans: the send step
 * when an effect is still unsent, the source and destination observation sessions and the residual allowance read, each
 * with its retry headroom. An exhausted cap defers to the next resume; it never records unknown finality.
 */
export declare function bridgeInvocationPostBudget(op: BridgeOperationRecord): number;
