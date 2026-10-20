import type { CommandOutcome, CommandRequest } from "../commands.js";
import type { RuntimeContext } from "../runtime.js";
import type { UniswapTokenOperation } from "./uniswap-v3/token-operation.js";
type Request = Extract<CommandRequest, {
    readonly command: `swap.uniswap.${string}` | `swap.uniswap-token.${string}`;
}>;
export declare function executeUniswapCommand(request: Request, context: RuntimeContext): Promise<CommandOutcome>;
/** A cleanup the fee cap refused before signing: retry it as frozen, or re-quote its own caps under fresh consent. */
export declare function uniswapTokenNextActions(op: Pick<UniswapTokenOperation, "operationId" | "phase" | "preSignFailure">): readonly string[];
export {};
