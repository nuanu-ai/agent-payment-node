import type { CommandOutcome, CommandRequest } from "../../commands.js";
import type { RuntimeContext } from "../../runtime.js";
export interface SunSwapReadOnlyQuoteBuilder {
    quote(input: Extract<CommandRequest, {
        readonly command: "swap.sunswap.quote";
    }> & {
        readonly now: Date;
    }): Promise<unknown>;
}
type Request = Extract<CommandRequest, {
    readonly command: `swap.sunswap.${string}`;
}>;
export declare function executeSunSwapCommand(request: Request, context: RuntimeContext): Promise<CommandOutcome>;
export {};
