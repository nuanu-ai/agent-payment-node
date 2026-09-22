import type { CommandOutcome, CommandRequest } from "../commands.js";
import type { RuntimeContext } from "../runtime.js";
type Request = Extract<CommandRequest, {
    readonly command: `swap.uniswap.${string}` | `swap.uniswap-token.${string}`;
}>;
export declare function executeUniswapCommand(request: Request, context: RuntimeContext): Promise<CommandOutcome>;
export {};
