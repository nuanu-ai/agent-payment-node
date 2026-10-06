import { Permit2ProductionSigningFence, type Permit2MetadataLockScope } from "./x402-permit2/production-signing-fence.js";
import { Permit2ProductionJournal, type Permit2SigningContinuation } from "./x402-permit2/production-journal.js";
import type { Permit2NativeRequestExecution, Permit2NativeSigningOrigin, Permit2NativeSigningExecution, Permit2LocalCapability } from "./x402-permit2/production-native-capability.js";
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
    static assertPermit2SigningExecution(execution: Permit2NativeSigningExecution, journal: Permit2ProductionJournal, id: string): {
        readonly native: LocalWalletNative;
        readonly capability: Permit2LocalCapability;
        readonly state: StateStore;
        readonly root: string;
        readonly journal: Permit2ProductionJournal;
        readonly fence: Permit2ProductionSigningFence;
        readonly scope: Permit2MetadataLockScope;
        readonly operationId: string;
    };
    static assertPermit2RequestExecution(execution: Permit2NativeRequestExecution, journal: Permit2ProductionJournal, id: string): OwnedPermit2SigningOrigin;
    private readonly wallets;
    constructor(state: StateStore, wrappingSecret: WrappingSecretPort, approval?: TransferApprovalPort);
    /** Direct chosen-native entry only: no JSON request, caller plan, callback or transport permission. */
    signPermit2Production(journal: Permit2ProductionJournal, fence: Permit2ProductionSigningFence, operationId: string, continuation: Permit2SigningContinuation): Promise<Readonly<{
        status: {
            lifecycle: string;
            observeOnly: boolean;
            operationId: string;
            state: import("./x402-permit2/production-repository.js").Permit2ProductionState;
            terminal: boolean;
            capability: string;
            chain: "eip155:43114";
            payer: `0x${string}`;
            token: `0x${string}`;
            recipient: `0x${string}`;
            amountAtomic: string;
            deadline: string;
            resource: {
                origin: string;
                urlHash: string;
            };
            blockerCodes: string[];
        };
        signingOrigin: Readonly<{
            kind: "permit2-native-signing-origin";
        }>;
    }>>;
    /** Claims a genuine paid origin once; metadata admission only, with no key, RPC or HTTP. */
    beginPermit2ProductionRequest(journal: Permit2ProductionJournal, fence: Permit2ProductionSigningFence, operationId: string, signingOrigin: Permit2NativeSigningOrigin): Promise<Readonly<{
        status: {
            lifecycle: string;
            observeOnly: boolean;
            operationId: string;
            state: import("./x402-permit2/production-repository.js").Permit2ProductionState;
            terminal: boolean;
            capability: string;
            chain: "eip155:43114";
            payer: `0x${string}`;
            token: `0x${string}`;
            recipient: `0x${string}`;
            amountAtomic: string;
            deadline: string;
            resource: {
                origin: string;
                urlHash: string;
            };
            blockerCodes: string[];
        };
        requestGrant: null;
    }> | Readonly<{
        status: {
            lifecycle: string;
            observeOnly: boolean;
            operationId: string;
            state: import("./x402-permit2/production-repository.js").Permit2ProductionState;
            terminal: boolean;
            capability: string;
            chain: "eip155:43114";
            payer: `0x${string}`;
            token: `0x${string}`;
            recipient: `0x${string}`;
            amountAtomic: string;
            deadline: string;
            resource: {
                origin: string;
                urlHash: string;
            };
            blockerCodes: string[];
        };
        requestGrant: Readonly<{
            kind: "permit2-native-request-grant";
        }>;
    }>>;
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
type OwnedPermit2SigningOrigin = {
    readonly native: LocalWalletNative;
    readonly capability: Permit2LocalCapability;
    readonly journal: Permit2ProductionJournal;
    readonly root: string;
    readonly operationId: string;
    readonly requestHash: string;
    readonly challengeHash: string;
    readonly materialHash: string;
    readonly signedHash: string;
    readonly grant: ReturnType<typeof Permit2ProductionJournal.nativeOriginBinding>;
};
export {};
