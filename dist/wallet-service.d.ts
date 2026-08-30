import type { RuntimeContext } from "./runtime.js";
import type { CommandRequest } from "./commands.js";
export declare class WalletService {
    private readonly context;
    constructor(context: RuntimeContext);
    doctorKeychain(): Promise<unknown>;
    ensure(profileInput: string): Promise<unknown>;
    private materializeLocalProfile;
    status(profileInput: string): Promise<unknown>;
    private initializedStatus;
    balance(profileInput: string): Promise<unknown>;
    policyShow(profileInput: string): Promise<unknown>;
    policySet(request: Extract<CommandRequest, {
        readonly command: "wallet.policy.set";
    }>): Promise<unknown>;
    private policyBindingForProfile;
}
