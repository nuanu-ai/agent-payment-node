import type { AssetPolicyRegistry } from "../asset-policy-registry.js";
import type { AssetUsageLedger } from "../asset-usage-ledger.js";
import type { ClockPort } from "../ports.js";
import { SecureStateStore } from "../secure-state-store.js";
import { type SwapOperationRecord } from "./model.js";
import type { SwapProtocolRegistry } from "./protocol-registry.js";
import { type SwapQuoteInput, type SwapQuoteSnapshot } from "./quote.js";
import { SwapOperationRepository } from "./repository.js";
import { GuardedSwapService } from "./service.js";
export declare const GUARDED_SWAP_APPROVAL_SCHEMA: "apn.guarded-swap-approval.v1";
export interface GuardedSwapPreparedMaterial {
    readonly quote: SwapQuoteInput | SwapQuoteSnapshot;
    readonly approvalCapAtomic: string;
    /** Exact gas or energy fields displayed to the owner. Values must be canonical unsigned integers. */
    readonly gasOrEnergy: Readonly<Record<string, string>>;
    /** Chain-specific unsigned material. The execution driver must bind it to quote.unsignedTransactionPayloadHash. */
    readonly execution: unknown;
}
export interface GuardedSwapReadOnlyBuilder<Request> {
    quote(input: Request & {
        readonly now: Date;
    }): Promise<unknown>;
    load(quoteHash: string): Promise<GuardedSwapPreparedMaterial | null>;
}
/**
 * Resolves the owner's active sealed asset policy for one profile. Null means no owner admission is installed and
 * every preparation or approval refuses with swap_owner_admission_required. The allowlist activation supplies it.
 */
export type GuardedSwapPolicyResolver = (profile: string) => Promise<AssetPolicyRegistry | null>;
export interface GuardedSwapOwnerAdmissionPort {
    /** Fails closed when the owner, wallet, or active policy no longer matches. Any returned value is ignored. */
    assert(operation: SwapOperationRecord, material: GuardedSwapPreparedMaterial): Promise<unknown>;
}
export interface GuardedSwapApprovalIntent {
    readonly operationId: string;
    readonly profile: string;
    readonly account: string;
    readonly recipient: string;
    readonly inputAmountAtomic: string;
    readonly expectedOutputAtomic: string;
    readonly minimumOutputAtomic: string;
    readonly slippageBps: number;
    readonly gasOrEnergy: Readonly<Record<string, string>>;
    readonly deadline: string;
    readonly quoteHash: string;
    readonly policyDigest: string;
    readonly mechanismDigest: string;
    readonly protocolRegistryDigest: string;
}
export interface GuardedSwapApprovalArtifact extends GuardedSwapApprovalIntent {
    readonly schemaVersion: typeof GUARDED_SWAP_APPROVAL_SCHEMA;
    readonly approvedAt: string;
    readonly expiresAt: string;
    readonly verifierProofHash: string;
    readonly artifactHash: string;
}
export interface GuardedSwapForegroundApprovalPort {
    /** MCP implementations must refuse or hand off. Only a foreground verifier may return an artifact. */
    approve(intent: GuardedSwapApprovalIntent): Promise<unknown>;
}
export interface GuardedSwapExecutionDriver {
    /** Must persist the submission marker before signing and attempt the sender at most once. */
    execute(input: GuardedSwapExecutionInput): Promise<SwapOperationRecord>;
    /** Must only observe. It may never sign or send. */
    observe(input: GuardedSwapObservationInput): Promise<SwapOperationRecord>;
}
export interface GuardedSwapExecutionInput {
    readonly operation: SwapOperationRecord;
    readonly material: GuardedSwapPreparedMaterial;
    readonly approval: GuardedSwapApprovalArtifact;
    readonly dependencies: GuardedSwapExecutionDependencies;
    readonly now: Date;
}
export interface GuardedSwapObservationInput extends Omit<GuardedSwapExecutionInput, "approval"> {
}
/** Every effectful dependency is mandatory on an installed runtime. No environment fallback is consulted. */
export interface GuardedSwapExecutionDependencies {
    readonly rpc: object;
    readonly effectStore: object;
    readonly signer: object;
    readonly sender: object;
    readonly observer: object;
    readonly caps: Readonly<Record<string, string>>;
}
export interface GuardedSwapRuntimeDependencies<Request> extends GuardedSwapExecutionDependencies {
    readonly chain: string;
    readonly builder: GuardedSwapReadOnlyBuilder<Request>;
    readonly policy: GuardedSwapPolicyResolver;
    /** Read again after every human prompt: consent time is never the command start time. */
    readonly clock: ClockPort;
    readonly protocolRegistry: SwapProtocolRegistry;
    readonly usage: AssetUsageLedger;
    readonly operations: SwapOperationRepository;
    readonly ownerAdmission: GuardedSwapOwnerAdmissionPort;
    readonly foregroundApproval: GuardedSwapForegroundApprovalPort;
    readonly execution: GuardedSwapExecutionDriver;
    readonly approvals: GuardedSwapApprovalRepository;
}
export declare class GuardedSwapApprovalRepository extends SecureStateStore {
    private initialized;
    store(operationValue: SwapOperationRecord, artifactValue: unknown): Promise<GuardedSwapApprovalArtifact>;
    load(operationValue: SwapOperationRecord): Promise<GuardedSwapApprovalArtifact | null>;
    private path;
    private ready;
}
/** Explicitly injected command runtime. Installed builds do not construct this class by default. */
export declare class GuardedSwapRuntime<Request> {
    readonly dependencies: GuardedSwapRuntimeDependencies<Request>;
    readonly service: GuardedSwapService;
    constructor(dependencies: GuardedSwapRuntimeDependencies<Request>);
    quote(request: Request, now: Date): Promise<unknown>;
    prepare(request: {
        readonly profile: string;
        readonly quoteHash: string;
        readonly idempotencyKey: string;
    }, now: Date): Promise<SwapOperationRecord>;
    approve(operationId: string, now: Date): Promise<SwapOperationRecord>;
    /** The foreground CLI folds consent and the single send into one command. MCP never reaches this method. */
    approveAndExecute(operationId: string, now: Date): Promise<SwapOperationRecord>;
    execute(operationId: string, now: Date): Promise<SwapOperationRecord>;
    status(operationId: string, now: Date): Promise<SwapOperationRecord>;
    private observe;
    private now;
    private activePolicy;
    private required;
    private material;
}
export declare function sealGuardedSwapApproval(intent: GuardedSwapApprovalIntent, approvedAt: Date, verifierProofHash: string): GuardedSwapApprovalArtifact;
export declare function validateGuardedSwapApprovalArtifact(value: unknown, operation: SwapOperationRecord, expected?: GuardedSwapApprovalIntent, now?: Date): GuardedSwapApprovalArtifact;
