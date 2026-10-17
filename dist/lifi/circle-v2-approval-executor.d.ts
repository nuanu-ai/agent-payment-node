import type { WrappingSecretPort } from "../macos-keychain.js";
import type { StateStore } from "../state.js";
import { type Hex } from "viem";
import { type CircleV2ApprovalLimits, type CircleV2ApprovalPreparation, type CircleV2ApprovalStateReader } from "./circle-v2-approval-preparation.js";
import type { BridgeProtocolReceipt } from "./model.js";
import type { BridgeRpcPort } from "./ports.js";
import { type EvmBatchRead, type EvmUnlandedEvidence } from "../evm-unlanded-proof.js";
import type { OperationAbandonApprovalPort } from "../operation-abandon-approval.js";
/**
 * Every phase of a Circle Base USDC approval, and its outcomes: a safe receipt either way, proven never sent, or proven
 * never to land (another transaction took its nonce at finality while the node knows neither it nor a receipt).
 */
export declare const CIRCLE_APPROVAL_PHASES: readonly ["prepared", "signing_started", "sealed", "submitting", "unknown_finality", "completed", "confirmed_revert", "failed_before_effect", "failed_proven_superseded", "abandoned_unknown"];
export type CircleApprovalPhase = typeof CIRCLE_APPROVAL_PHASES[number];
export declare const CIRCLE_APPROVAL_RESOLVED_PHASES: readonly CircleApprovalPhase[];
export interface CircleApprovalRecord {
    readonly schemaVersion: "apn.circle-v2-approval.v1";
    readonly id: string;
    readonly profile: string;
    readonly profileHash: string;
    readonly rpcOrigin: string;
    readonly walletBindingHash: string;
    readonly walletCreatedAt: string;
    readonly preparation: CircleV2ApprovalPreparation;
    readonly limits: CircleV2ApprovalLimits;
    readonly phase: CircleApprovalPhase;
    readonly rawTransaction: Hex | null;
    readonly transactionHash: Hex | null;
    readonly submissionAttempts: 0 | 1;
    readonly observedAllowanceAtomic: string | null;
    readonly failureReason?: string;
    /** `failed_proven_superseded` only: the payer's nonce at the `finalized` tag when status proved the approval can never land. */
    readonly finalizedNonceAtomic?: string;
    readonly integrityHash: string;
}
export interface CircleApprovalRpc {
    readonly chainId: 8453;
    readonly origin: string;
    /** This reader must obtain balance and allowance from the same fresh Base block. */
    readonly read: CircleV2ApprovalStateReader;
    send(raw: Hex): Promise<Hex>;
    /** Returns a chain-verified receipt at safe finality, or null while unresolved. */
    observe(hash: Hex): Promise<{
        readonly receipt: BridgeProtocolReceipt;
        readonly status: "success" | "reverted";
        readonly safe: true;
    } | null>;
    /** One batch on the same endpoint: the payer's nonce at the `finalized` tag, and whether the node knows the transaction or a receipt. */
    unlanded(payer: string, hash: Hex): Promise<EvmUnlandedEvidence>;
}
export interface CircleApprovalSigner {
    sign(record: CircleApprovalRecord): Promise<Hex>;
}
export declare function publicCircleApproval(record: CircleApprovalRecord): {
    allowance: {
        effect: string;
        token: string;
        owner: string;
        spender: string;
        approvedAtomic: string;
        observedAtCompletionAtomic: string | null;
        spentBy: string;
        revoke: string;
    } | {
        effect: string;
        token?: never;
        owner?: never;
        spender?: never;
        approvedAtomic?: never;
        observedAtCompletionAtomic?: never;
        spentBy?: never;
        revoke?: never;
    };
    schemaVersion: "apn.circle-v2-approval.v1";
    id: string;
    profile: string;
    profileHash: string;
    rpcOrigin: string;
    walletBindingHash: string;
    walletCreatedAt: string;
    preparation: CircleV2ApprovalPreparation;
    limits: CircleV2ApprovalLimits;
    phase: CircleApprovalPhase;
    transactionHash: Hex | null;
    submissionAttempts: 0 | 1;
    observedAllowanceAtomic: string | null;
    failureReason?: string;
    finalizedNonceAtomic?: string;
    integrityHash: string;
};
/**
 * Use APN's canonical Base RPC reader, which verifies receipt membership and safe block ancestry. Each call reads through
 * its own command session on the primary endpoint: a state read is one batch (chain identity, head, account, Base fee
 * inputs and the approval's own simulation), and the estimate and fee quote reuse it.
 */
export declare function circleApprovalRpcFromBridge(input: BridgeRpcPort | (() => BridgeRpcPort), proofBatch: () => EvmBatchRead): CircleApprovalRpc;
/** The never-lands proof reads the same configured Base endpoint as every other approval read, in one batch. */
export declare function circleApprovalProofBatch(environment: Readonly<Record<string, string | undefined>>): () => EvmBatchRead;
/** Lock-free read of one approval journal (the operation index's reader). */
export declare function loadCircleApproval(root: string, id: string): Promise<CircleApprovalRecord | null>;
/** APN encrypted local wallet is opened solely in the signing call; no secret enters the journal. */
export declare class LocalCircleApprovalSigner implements CircleApprovalSigner {
    private readonly state;
    private readonly wallets;
    private readonly journal;
    constructor(state: StateStore, wrapping: WrappingSecretPort);
    sign(record: CircleApprovalRecord): Promise<Hex>;
}
export declare class CircleV2ApprovalExecutor {
    private readonly state;
    private readonly rpc;
    private readonly signer;
    private readonly limits;
    private readonly now;
    private readonly journal;
    constructor(state: StateStore, rpc: CircleApprovalRpc, signer: CircleApprovalSigner, limits: CircleV2ApprovalLimits, now?: () => number);
    prepare(input: {
        readonly profile: string;
        readonly payer: string;
        readonly walletBindingHash: string;
        readonly walletCreatedAt: string;
        readonly approvalCapAtomic: string;
    }): Promise<CircleApprovalRecord>;
    execute(id: string, confirm: (record: CircleApprovalRecord) => Promise<boolean>): Promise<CircleApprovalRecord>;
    status(id: string): Promise<CircleApprovalRecord>;
    private fresh;
    private unknown;
    private observe;
}
/**
 * The owner exit (R4 exit 3) of an approval whose send may have left APN and that no proof decides yet: once its
 * preparation expired, TTY consent ends it `abandoned_unknown`. Nothing is signed or sent; the transaction may still land
 * and set the allowance. Reads only the state root, as `apn operation abandon` does; status remains the proof path.
 */
export declare function abandonCircleApproval(state: StateStore, id: string, consent: OperationAbandonApprovalPort, now: () => number): Promise<CircleApprovalRecord>;
