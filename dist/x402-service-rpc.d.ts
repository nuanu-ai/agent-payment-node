import { type X402Asset } from "./x402-network.js";
import type { RpcPort, X402RpcPort } from "./ports.js";
import type { RuntimeContext } from "./runtime.js";
import type { SettlementResponseObservation, X402OperationRecord, X402ProofClass, X402Reason, X402TerminalState, X402SettlementWaitProjection } from "./x402-state-integrity.js";
/** The command's explicit --rpc-url; a missing one is refused naming the network it must serve, never substituted. */
export declare function requireX402Rpc(context: RuntimeContext, asset: X402Asset): RpcPort;
export declare function selectX402Rpc(rpc: RpcPort, asset: X402Asset): RpcPort;
export declare function assertX402RpcChain(rpc: Partial<X402RpcPort>, chainId?: number): Promise<{
    readonly chainId: number;
    readonly rpcOrigin: string;
}>;
/** The production RPC adapter always carries the x402 read surface; an adapter without it cannot observe x402. */
export declare function x402ReadPort(rpc: RpcPort, asset: X402Asset): X402RpcPort;
export declare function boundedX402ReadPort(rpc: RpcPort, timeoutMs: number, asset: X402Asset): X402RpcPort;
/**
 * A settlement wait first proves the endpoint's chain (read once per invocation and endpoint). The safe head is not
 * read here: every poll reads it inside authorizationState, and the reconciler ignores a safe head behind the prepared block.
 */
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
export declare function waitOutcome(outcome: X402SettlementWaitProjection["outcome"], seconds: number, observations: number): X402SettlementWaitProjection;
