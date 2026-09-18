import type { CommandOutcome, CommandRequest } from "../../commands.js";
import type { RuntimeContext } from "../../runtime.js";
/** A function-typed member keeps parameter checks strict, so a builder needing more input cannot be installed here. */
export interface SunSwapReadOnlyQuoteBuilder {
    readonly quote: (input: Extract<CommandRequest, {
        readonly command: "swap.sunswap.quote";
    }> & {
        readonly now: Date;
    }) => Promise<unknown>;
}
type Request = Extract<CommandRequest, {
    readonly command: `swap.sunswap.${string}`;
}>;
export declare function executeSunSwapCommand(request: Request, context: RuntimeContext): Promise<CommandOutcome>;
export {};
