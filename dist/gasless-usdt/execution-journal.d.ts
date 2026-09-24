import { SecureStateStore } from "../secure-state-store.js";
import { type UsdtBoundOperation } from "./bound-operation.js";
import type { UsdtPreparePort } from "./policy-prepare.js";
import type { UsdtSettlement } from "./receipt.js";
export declare const USDT_EXECUTION_SCHEMA: "apn.gasless-usdt-execution.v1";
export type UsdtExecutionState = "planned" | "reserved" | "failed_before_effect" | "submitting" | "submitted_pending" | "unknown_finality" | "finalized" | "failed_confirmed_revert";
export interface UsdtExecutionIntent {
    readonly operationId: string;
    readonly profileHash: string;
    readonly bindingHash: string;
    readonly policyDigest: string;
    readonly policyRevision: number;
    readonly activationDigest: string;
    readonly sender: string;
    readonly smartAccount: string;
    readonly recipient: string;
    readonly entryPointNonce: string;
    readonly eoaNonce: string;
    readonly safeBlockNumber: string;
    readonly safeBlockHash: string;
    readonly quoteHash: string;
    readonly paymasterValidUntil: string;
    readonly maxFeeAtomic: string;
}
export interface UsdtExecutionRecord extends UsdtExecutionIntent {
    readonly schemaVersion: typeof USDT_EXECUTION_SCHEMA;
    readonly reservationId: string;
    readonly state: UsdtExecutionState;
    readonly userOperationHash: string | null;
    readonly createdAt: string;
    readonly updatedAt: string;
    readonly integrityHash: string;
    readonly outcomeDigest?: string;
    readonly settlement?: UsdtSettlement | null;
}
export declare function validateUsdtExecutionRecord(value: unknown): UsdtExecutionRecord;
/** Separate v1 effect journal. It cannot sign or send; each phase is fsynced before returning. */
export declare class UsdtExecutionJournal extends SecureStateStore {
    private readonly usage;
    constructor(root: string);
    private path;
    private lock;
    /** OS advisory lock held from pre-submit recovery through signing and the durable may-have-sent marker. */
    withEffectLock<T>(operationId: string, action: (abortUnsent: (bound: UsdtBoundOperation, now: Date) => Promise<UsdtExecutionRecord | null>) => Promise<T>): Promise<T>;
    abortUnsent(bound: UsdtBoundOperation, now: Date): Promise<UsdtExecutionRecord | null>;
    /** Caller holds the effect lock. The terminal marker is fsynced before releasing a reserved usage lease. */
    private abortUnsentLocked;
    load(operationId: string): Promise<UsdtExecutionRecord | null>;
    private ready;
    protected syncExecutionDirectoryParent(): Promise<void>;
    private write;
    private otherUsage;
    private guard;
    /** Last read fence immediately before the submitting marker. Dispatch must perform its own fresh guard. */
    private submissionFence;
    /** Create a durable intent, then atomically reserve common usage. Retry repairs only the exact planned intent. */
    reserve(boundValue: UsdtBoundOperation, intent: UsdtExecutionIntent, port: UsdtPreparePort): Promise<UsdtExecutionRecord>;
    /** Persist the may-have-sent boundary. A retry cannot issue another send from this state. */
    markSubmitting(boundValue: UsdtBoundOperation, port: UsdtPreparePort, userOperationHash: string): Promise<UsdtExecutionRecord>;
    /** A matching bundler acknowledgement does not settle the transfer; observation remains required. */
    markSubmitted(boundValue: UsdtBoundOperation, userOperationHash: string, now: Date): Promise<UsdtExecutionRecord>;
    /** Explicit uncertainty classification only; there is no send or automatic retry path. */
    markUnknownFinality(boundValue: UsdtBoundOperation, now: Date): Promise<UsdtExecutionRecord>;
    /** Replaying the same observation repairs a crash between the ledger and journal writes. */
    recordObservedOutcome(boundValue: UsdtBoundOperation, outcome: {
        readonly state: "finalized" | "failed_confirmed_revert";
        readonly digest: string;
        readonly settlement: UsdtSettlement | null;
    }, now: Date): Promise<UsdtExecutionRecord>;
}
/** Build the caller's exact execution intent from an authenticated bound operation. */
export declare function usdtExecutionIntent(bound: UsdtBoundOperation): UsdtExecutionIntent;
