import type { CommandOutcome, CommandRequest } from "../../commands.js";
import type { RuntimeContext } from "../../runtime.js";
type Request = Extract<CommandRequest, {
    readonly command: `swap.uniswap-bnb-token.${string}`;
}>;
/** `apn swap bnb uniswap-token …`: the Ethereum token lane's seven actions over the BNB Smart Chain token runtime. */
export declare function executeUniswapBnbTokenCommand(request: Request, context: RuntimeContext): Promise<CommandOutcome>;
export {};
