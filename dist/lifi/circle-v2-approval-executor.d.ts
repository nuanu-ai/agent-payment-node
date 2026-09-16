import type { WrappingSecretPort } from "../macos-keychain.js";
import type { StateStore } from "../state.js";
import { type Hex } from "viem";
import { type CircleV2ApprovalLimits, type CircleV2ApprovalPreparation, type CircleV2ApprovalStateReader } from "./circle-v2-approval-preparation.js";
import type { BridgeProtocolReceipt } from "./model.js";
import type { BridgeRpcPort } from "./ports.js";
export type CircleApprovalPhase = "prepared" | "signing_started" | "sealed" | "submitting" | "unknown_finality" | "completed" | "confirmed_revert" | "failed_before_effect";
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
}
export interface CircleApprovalSigner {
    sign(record: CircleApprovalRecord): Promise<Hex>;
}
export declare function publicCircleApproval(record: CircleApprovalRecord): {
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
    integrityHash: string;
};
/** Use APN's canonical Base RPC reader, which verifies receipt membership and safe block ancestry. */
export declare function circleApprovalRpcFromBridge(rpc: BridgeRpcPort): CircleApprovalRpc;
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
