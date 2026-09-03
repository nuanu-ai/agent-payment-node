import type { CommandRequest } from "./commands.js";
import type { RuntimeContext } from "./runtime.js";
type PermissionCommand = Extract<CommandRequest, {
    readonly command: "wallet.permission.list" | "wallet.permission.sync" | "wallet.permission.disable" | "wallet.permission.forget";
}>;
export declare class ProviderPermissionService {
    private readonly context;
    constructor(context: RuntimeContext);
    execute(request: PermissionCommand): Promise<unknown>;
}
export {};
