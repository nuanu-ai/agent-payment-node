import type { UsdtUserOperationScan, UsdtUserOperationScanInput } from "./recovery.js";
import type { UsdtJsonRpc } from "./rpc.js";
/**
 * Two batches: chain identity with the finalized head and the prepared anchor, then the topic-filtered EntryPoint logs
 * from that anchor through the last block that could still include the operation, with that block's header. A block
 * whose timestamp is after the signed paymaster `validUntil` can never include it, and post-merge blocks are at least one
 * 12-second slot apart, so the range is bounded by `validUntil` rather than by how late recovery runs.
 */
export declare function scanUsdtUserOperation(rpc: Pick<UsdtJsonRpc, "batch">, input: UsdtUserOperationScanInput): Promise<UsdtUserOperationScan>;
