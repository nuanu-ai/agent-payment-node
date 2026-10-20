import type { CommandOutcome, CommandRequest } from "../commands.js";
import type { RuntimeContext } from "../runtime.js";
import type { UniswapTokenOperation } from "./uniswap-v3/token-operation.js";
type Request = Extract<CommandRequest, {
    readonly command: `swap.uniswap.${string}` | `swap.uniswap-token.${string}`;
}>;
export declare function executeUniswapCommand(request: Request, context: RuntimeContext): Promise<CommandOutcome>;
/**
 * A swap that requires cleanup names its one exit, the owner's consented cleanup; when the fee cap refused it before
 * signing, the same cleanup may instead re-quote its own caps under fresh consent. An owner-abandoned swap still holding a
 * principal no proof released names execute, which opens custody to prove its swap never signed; execute itself, having
 * found signed bytes and changed nothing, does not name itself again.
 */
export declare function uniswapTokenNextActions(op: UniswapTokenOperation, after?: "execute"): readonly string[];
export {};
