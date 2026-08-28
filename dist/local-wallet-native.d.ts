import type { WrappingSecretPort } from "./macos-keychain.js";
import type { NativePort, NativeRequest } from "./ports.js";
import type { StateStore } from "./state.js";
import { type TransferApprovalPort } from "./tty-approval.js";
export declare class LocalWalletNative implements NativePort {
    private readonly state;
    private readonly approval;
    private readonly wallets;
    constructor(state: StateStore, wrappingSecret: WrappingSecretPort, approval?: TransferApprovalPort);
    request(request: NativeRequest): Promise<unknown>;
    private ensureWallet;
    private describeWallet;
    private approveAndSign;
    private getEffect;
    private approveX402;
    private getX402;
    private withWallet;
}
