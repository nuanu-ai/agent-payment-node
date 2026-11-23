import type { CommandOutcome, CommandRequest } from "../../commands.js";
import type { RuntimeContext } from "../../runtime.js";
type Request = Extract<CommandRequest, {
    readonly command: `swap.uniswap-bnb.${string}`;
}>;
/** `apn swap bnb uniswap …`: the same six guarded actions as the Ethereum keyless lane, over the BNB runtime. */
export declare function executeUniswapBnbCommand(request: Request, context: RuntimeContext): Promise<CommandOutcome>;
export {};
