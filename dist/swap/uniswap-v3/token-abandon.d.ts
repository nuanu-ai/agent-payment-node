import type { OperationAbandonIntent } from "../../operation-abandon-approval.js";
import { type UniswapTokenOperation } from "./token-operation.js";
/**
 * R4 exit 3 of a token swap (the shared token abandon): its deadline is the route deadline, after which the router
 * refuses the swap; a swap whose outcome a proof already decided (cleanup evidence) is not abandoned. Its consent names
 * any signed approval, swap or cleanup and the router allowance.
 */
export declare function abandonUniswapToken(root: string, operationId: string, approve: (intent: OperationAbandonIntent) => Promise<void>, now: () => Date): Promise<UniswapTokenOperation>;
