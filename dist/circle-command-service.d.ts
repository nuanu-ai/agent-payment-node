import type { CommandRequest, CommandOutcome } from "./commands.js";
import type { RuntimeContext } from "./runtime.js";
/** Dispatch preserves the distinct legacy approval and finite EVM operation boundaries. */
export declare function executeCircleCommand(request: Extract<CommandRequest, {
    command: `circle.${string}`;
}>, context: RuntimeContext): Promise<CommandOutcome>;
