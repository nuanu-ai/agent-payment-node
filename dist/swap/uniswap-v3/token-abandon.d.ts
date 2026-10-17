import type { OperationAbandonIntent } from "../../operation-abandon-approval.js";
import { type UniswapTokenOperation } from "./token-operation.js";
/**
 * R4 exit 3, the last resort: the owner closes a token swap that no proof decided, once its route deadline passed (the
 * router refuses the swap after it), with TTY consent. The record becomes `abandoned_unknown` and the operation index
 * releases the account; the usage ledger stays as it is (charged). Nothing is signed: a signed approval or cleanup may
 * still land, and a residual allowance may remain, which the consent states.
 */
export declare function abandonUniswapToken(root: string, operationId: string, approve: (intent: OperationAbandonIntent) => Promise<void>, now: () => Date): Promise<UniswapTokenOperation>;
