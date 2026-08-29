import type { ClockPort, X402RpcHead, X402RpcLog, X402RpcPort } from "./ports.js";
import { type AuthorizationUsedCandidate, type AuthorizationUsedScan, type X402OperationRecord, type X402State } from "./x402-state-integrity.js";
type ScanAdditions = Partial<Pick<X402OperationRecord, "authorizationUsedScan" | "transactionHint" | "settlementEvidence" | "unusedExpiryEvidence">>;
type ScanPersist = (operation: X402OperationRecord, additions: ScanAdditions, stateOverride?: X402State, clearLogDerivedEvidence?: boolean) => Promise<X402OperationRecord>;
export interface X402ScanOutcome {
    readonly operation: X402OperationRecord;
    readonly reorg: boolean;
    readonly unavailable: boolean;
    readonly malformed: boolean;
    readonly read: boolean;
}
export declare class X402RpcScanner {
    private readonly rpc;
    private readonly clock;
    private readonly persist;
    constructor(rpc: X402RpcPort, clock: ClockPort, persist: ScanPersist);
    scanOneChunk(input: X402OperationRecord, observedSafe: X402RpcHead, rpcOrigin: string): Promise<X402ScanOutcome>;
    private validateScanAnchor;
    private resetScanAfterReorg;
}
export declare function isCompleteZeroScan(scan: AuthorizationUsedScan | undefined): boolean;
export declare function scanCoversObservedSafe(scan: AuthorizationUsedScan | undefined, safe: X402RpcHead): boolean;
export declare function removeLogDerivedEvidence(operation: Omit<X402OperationRecord, "integrityHash">): Omit<X402OperationRecord, "integrityHash" | "transactionHint" | "settlementEvidence">;
export declare function sameRpcOrigin(left: string, right: string): boolean;
export declare function validX402Head(head: X402RpcHead): boolean;
export declare function candidateFromLog(log: X402RpcLog, operation: X402OperationRecord): AuthorizationUsedCandidate;
export declare function matchingAuthorizationUsed(log: X402RpcLog, operation: X402OperationRecord): boolean;
export declare function matchingTransfer(log: X402RpcLog, operation: X402OperationRecord): boolean;
export {};
