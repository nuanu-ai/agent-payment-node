import type { RuntimeContext } from "./runtime.js";
export declare class WalletService {
    private readonly context;
    constructor(context: RuntimeContext);
    ensure(profileInput: string): Promise<unknown>;
    status(profileInput: string): Promise<unknown>;
    balance(profileInput: string): Promise<unknown>;
}
