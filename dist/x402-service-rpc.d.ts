import type { EvmChainId } from "./evm-asset.js";
import type { RpcPort, X402RpcPort } from "./ports.js";
import type { SettlementResponseObservation, X402OperationRecord, X402ProofClass, X402Reason, X402TerminalState, X402SettlementWaitProjection } from "./x402-state-integrity.js";
export declare function selectX402Rpc(rpc: RpcPort, chainId?: EvmChainId): RpcPort;
export declare function boundedX402PrepareRpc(rpc: RpcPort, timeoutMs: number): Pick<RpcPort, "assertBaseChain" | "getX402PrepareEvidence"> & Partial<X402RpcPort>;
export declare function assertX402RpcChain(rpc: Pick<RpcPort, "assertBaseChain"> & Partial<X402RpcPort>, chainId?: EvmChainId): Promise<{
    readonly chainId: EvmChainId;
    readonly rpcOrigin: string;
}>;
export declare function x402ReadPort(rpc: RpcPort, chainId?: EvmChainId): X402RpcPort | null;
export declare function boundedX402ReadPort(rpc: RpcPort, timeoutMs: number, chainId?: EvmChainId): X402RpcPort | null;
export declare function assertWaitRpcProvenance(rpc: X402RpcPort, operation: X402OperationRecord): Promise<void>;
export declare function isRecoverableX402RpcObservationFailure(error: unknown): boolean;
export declare function isPostExposureWaitState(operation: X402OperationRecord): boolean;
export declare function terminalClassification(state: X402TerminalState): {
    readonly reason: X402Reason;
    readonly proofClass: X402ProofClass;
};
export declare function settlementResponseTransaction(response: SettlementResponseObservation): string | undefined;
export declare function remainingWaitMs(deadline: number, nowMs: number): number;
export declare function waitTimeout(seconds: number, observations: number): X402SettlementWaitProjection;
