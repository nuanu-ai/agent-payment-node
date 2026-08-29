import type { RpcPort, X402RpcPort } from "./ports.js";
import type { SettlementResponseObservation, X402OperationRecord, X402ProofClass, X402Reason, X402TerminalState } from "./x402-state-integrity.js";
export declare function x402ReadPort(rpc: RpcPort): X402RpcPort | null;
export declare function boundedX402ReadPort(rpc: RpcPort, timeoutMs: number): X402RpcPort | null;
export declare function assertWaitRpcProvenance(rpc: X402RpcPort, operation: X402OperationRecord): Promise<void>;
export declare function isRecoverableX402RpcObservationFailure(error: unknown): boolean;
export declare function isPostExposureWaitState(operation: X402OperationRecord): boolean;
export declare function terminalClassification(state: X402TerminalState): {
    readonly reason: X402Reason;
    readonly proofClass: X402ProofClass;
};
export declare function settlementResponseTransaction(response: SettlementResponseObservation): string | undefined;
