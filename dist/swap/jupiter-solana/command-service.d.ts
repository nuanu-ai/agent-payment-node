import type { CommandOutcome, CommandRequest } from "../../commands.js";
import type { RuntimeContext } from "../../runtime.js";
export interface JupiterReadOnlyQuoteBuilder {
    quote(input: Extract<CommandRequest, {
        readonly command: "swap.jupiter.quote";
    }> & {
        readonly now: Date;
    }): Promise<unknown>;
}
type Request = Extract<CommandRequest, {
    readonly command: `swap.jupiter.${string}`;
}>;
export declare function executeJupiterCommand(request: Request, context: RuntimeContext): Promise<CommandOutcome>;
export {};
