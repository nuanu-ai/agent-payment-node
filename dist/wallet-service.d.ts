import type { RuntimeContext } from "./runtime.js";
import type { CommandRequest } from "./commands.js";
import type { Address } from "./model.js";
export declare class WalletService {
    private readonly context;
    constructor(context: RuntimeContext);
    doctorKeychain(profileInput: string): Promise<unknown>;
    ensure(profileInput: string): Promise<unknown>;
    importNew(profileInput: string, keyFile: string, keyName: string, expectedAddress: string): Promise<unknown>;
    private materializeLocalProfile;
    status(profileInput: string): Promise<unknown>;
    private initializedStatus;
    balance(profileInput: string): Promise<unknown>;
    policyShow(profileInput: string, chainId?: number, asset?: Address, solanaMint?: string): Promise<unknown>;
    policySet(request: Extract<CommandRequest, {
        readonly command: "wallet.policy.set";
    }>): Promise<unknown>;
    private policyBindingForProfile;
}
