import type { BridgeOperationRecord } from "./operation-model.js";
export type BridgeRpcPhysicalPolicy = "default" | "canonical_wbtc_across_approval_continuation" | "canonical_usdc_across_approval_continuation";
export declare const WBTC_ACROSS_CONTINUATION_POST_LIMIT = 33;
export declare const USDC_ACROSS_CONTINUATION_POST_LIMIT = 34;
/** Exact pinned token continuations fit historical approval plus two fresh guards and one first bridge send. */
export declare function bridgeRpcPhysicalPolicy(op: BridgeOperationRecord): BridgeRpcPhysicalPolicy;
