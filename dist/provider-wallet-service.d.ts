import type { CommandRequest } from "./commands.js";
import type { RuntimeContext } from "./runtime.js";
export declare class ProviderWalletService {
    private readonly context;
    constructor(context: RuntimeContext);
    connect(request: Extract<CommandRequest, {
        readonly command: "wallet.connect";
    }>): Promise<unknown>;
    status(profileInput: string): Promise<unknown | null>;
    balance(profileInput: string): Promise<unknown | null>;
    assertPaymentAvailable(profileInput: string, kind: "direct" | "x402"): Promise<void>;
    private connectPermissionProfile;
}
