import type { CommandOutcome, CommandRequest } from "../../commands.js";
import type { RuntimeContext } from "../../runtime.js";
type Request = Extract<CommandRequest, {
    readonly command: `swap.sunswap.${string}`;
}>;
export declare function executeSunSwapCommand(request: Request, context: RuntimeContext): Promise<CommandOutcome>;
export {};
