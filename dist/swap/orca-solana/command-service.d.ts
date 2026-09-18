import type { CommandOutcome, CommandRequest } from "../../commands.js";
import type { RuntimeContext } from "../../runtime.js";
type Request = Extract<CommandRequest, {
    readonly command: `swap.orca.${string}`;
}>;
/** Inventory is the owner's source for the keyless pin and digest; nothing here admits or signs anything. */
export declare function orcaInventory(runtimeInstalled: boolean): unknown;
export declare function executeOrcaCommand(request: Request, context: RuntimeContext): Promise<CommandOutcome>;
export {};
