import type { BridgeOperationRecord } from "./operation-model.js";
export type BridgeRpcPhysicalPolicy = "default" | "canonical_wbtc_across_approval_continuation";
export declare const WBTC_ACROSS_CONTINUATION_POST_LIMIT = 33;
/** Only the reviewed two-chain WBTC continuation needs historical approval plus both fresh guards in one invocation. */
export declare function bridgeRpcPhysicalPolicy(op: BridgeOperationRecord): BridgeRpcPhysicalPolicy;
