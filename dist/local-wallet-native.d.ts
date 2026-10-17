import type { Permit2ProductionSigningFence } from "./x402-permit2/production-signing-fence.js";
import type { Permit2ProductionJournal, Permit2SignedOrigin, Permit2SigningContinuation } from "./x402-permit2/production-journal.js";
import { publicPermit2Production } from "./x402-permit2/production-repository.js";
import type { WrappingSecretPort } from "./macos-keychain.js";
import type { NativePort, NativeRequest } from "./ports.js";
import type { StateStore } from "./state.js";
import { type TransferApprovalPort } from "./tty-approval.js";
export declare class LocalWalletNative implements NativePort {
    #private;
    private readonly state;
    private readonly approval;
    private readonly wallets;
    constructor(state: StateStore, wrappingSecret: WrappingSecretPort, approval?: TransferApprovalPort);
    /** The exact local wallet native of `root` may sign Permit2 production bundles; a subclass or another native may not. */
    static permit2Signer(native: NativePort, root: string): LocalWalletNative;
    /**
     * The one Permit2 production signer. Under the operation's metadata locks it re-reads the saved record and lease and
     * signs only while they equal the continuation's (integrity hash, lease digest, wallet binding), the owner's approval
     * names that record and is at most 60 s old, and a chain observation of at most 5 s, taken before and again after the
     * key load, still holds. The saved signed record, not an object identity, is then what one request may send.
     */
    static signPermit2Production(native: NativePort, fence: Permit2ProductionSigningFence, journal: Permit2ProductionJournal, continuation: Permit2SigningContinuation, clock: () => Date): Promise<{
        readonly status: ReturnType<typeof publicPermit2Production>;
        readonly origin: Permit2SignedOrigin;
    }>;
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
