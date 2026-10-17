import type { CommandOutcome, CommandRequest } from "../../commands.js";
import type { RuntimeContext } from "../../runtime.js";
type Request = Extract<CommandRequest, {
    readonly command: `swap.jupiter.${string}`;
}>;
export declare function executeJupiterCommand(request: Request, context: RuntimeContext): Promise<CommandOutcome>;
export {};
