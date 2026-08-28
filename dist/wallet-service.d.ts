import type { RuntimeContext } from "./runtime.js";
import type { CommandRequest } from "./commands.js";
export declare class WalletService {
    private readonly context;
    constructor(context: RuntimeContext);
    ensure(profileInput: string): Promise<unknown>;
    status(profileInput: string): Promise<unknown>;
    balance(profileInput: string): Promise<unknown>;
    policyShow(profileInput: string): Promise<unknown>;
    policySet(request: Extract<CommandRequest, {
        readonly command: "wallet.policy.set";
    }>): Promise<unknown>;
}
