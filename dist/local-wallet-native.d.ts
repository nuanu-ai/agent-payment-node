import type { Permit2LocalCapability } from "./x402-permit2/production-native-capability.js";
import type { WrappingSecretPort } from "./macos-keychain.js";
import type { NativePort, NativeRequest } from "./ports.js";
import type { StateStore } from "./state.js";
import { type TransferApprovalPort } from "./tty-approval.js";
export declare class LocalWalletNative implements NativePort {
    #private;
    private readonly state;
    private readonly approval;
    static resolvePermit2LocalCapability(native: NativePort, root: string): Permit2LocalCapability;
    static assertPermit2LocalCapability(capability: Permit2LocalCapability, native: NativePort, root: string): StateStore;
    private readonly wallets;
    constructor(state: StateStore, wrappingSecret: WrappingSecretPort, approval?: TransferApprovalPort);
    request(request: NativeRequest): Promise<unknown>;
    private ensureWallet;
    private importWallet;
    private describeWallet;
    private approveAndSign;
    private getEffect;
    private approveX402;
    private getX402;
    private withWallet;
}
