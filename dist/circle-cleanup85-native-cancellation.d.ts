import { type AssetUsageReservation } from "./asset-usage-ledger.js";
import { type StateStore } from "./state.js";
import type { WrappingSecretPort } from "./macos-keychain.js";
import type { OperationRecord } from "./model.js";
import { BridgeHttps } from "./lifi/https.js";
import { type VerifiedCleanup85NativeReservation, type VerifiedCleanup85NativeSettlement } from "./circle-cleanup85-native-ledger-authority.js";
import type { Cleanup85CancellationPort, Cleanup85CancellationProof, Cleanup85CancellationRequest, Cleanup85CancellationStatus } from "./circle-cleanup85-cancellation-contract.js";
export interface Cleanup85NativeLedgerPort {
    reserveCleanup85Native(authority: VerifiedCleanup85NativeReservation, now: Date): Promise<AssetUsageReservation>;
    settleCleanup85Native(authority: VerifiedCleanup85NativeSettlement, now: Date): Promise<AssetUsageReservation>;
}
export interface Cleanup85NativeCancellationOptions {
    readonly https?: Pick<BridgeHttps, "request">;
    readonly sourceArchiveRpcUrl?: string;
    readonly nativeRpcUrl?: string;
    readonly now?: () => number;
    readonly approve?: (operation: OperationRecord) => Promise<void>;
    readonly ledger?: Cleanup85NativeLedgerPort;
}
/** One fixed recovery request, normal native custody/operation/claims and finite full native accounting.
 * execute is foreground only. inspect contains no custody secret/material loader and never submits. */
export declare class Cleanup85NativeCancellation implements Cleanup85CancellationPort {
    private readonly state;
    private readonly wrapping;
    private readonly environment;
    private readonly options;
    private readonly now;
    private readonly ledger;
    private readonly accounting;
    private readonly records;
    constructor(state: StateStore, wrapping: WrappingSecretPort, environment: Readonly<Record<string, string | undefined>>, options?: Cleanup85NativeCancellationOptions);
    private identity;
    private readers;
    private policy;
    private load;
    execute(input: Cleanup85CancellationRequest): Promise<Cleanup85CancellationStatus>;
    inspect(input: Cleanup85CancellationRequest): Promise<Cleanup85CancellationStatus>;
    private status;
    private move;
    private persist;
}
/** Pure public accounting reconciliation. A owns its locks and independent canonical RPC reanchor. */
export declare function verifyCleanup85CancellationAccounting(state: StateStore, request: Cleanup85CancellationRequest, proof: Cleanup85CancellationProof): Promise<void>;
