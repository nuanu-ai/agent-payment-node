export { parseRpcResultEnvelope, parseRpcBatchResultEnvelope, parseRpcLogEnvelope, classifyX402LogAvailabilityMessage, acceptRpcHttpBody } from "./rpc-envelope.js";
export { isPublicIp } from "./network-policy.js";
import { type X402Asset } from "./x402-network.js";
import { type X402Permit2PrepareEvidence } from "./x402-permit2-rpc.js";
import { EvmRpc } from "./evm-rpc.js";
import type { StateStore } from "./state.js";
import type { Address, Hex } from "./model.js";
import type { BalanceSnapshot, FeeEstimate, RpcPort, RpcReceipt, X402AuthorizationState, X402AuthorizationUsedLogs, X402BlockReference, X402PrepareEvidence, X402RpcBlock, X402RpcHead, X402RpcPort, X402RpcReceipt, X402TransferLogs } from "./ports.js";
export type ReadOnlyRpcBatchCall = {
    readonly method: string;
    readonly params: readonly unknown[];
};
export declare class HttpsBaseRpc implements RpcPort, X402RpcPort {
    readonly evm: EvmRpc;
    readonly endpoint: URL;
    readonly rpcOrigin: string;
    private sequence;
    private readonly observationCounters;
    get observationMetrics(): Readonly<import("./rpc-observation-metrics.js").RpcObservationCounters>;
    /** The x402 network and token every x402 read of this instance binds; none unless the caller selected one. */
    private readonly x402;
    private pinnedAddresses;
    /** One eth_chainId per command invocation and endpoint, shared by every bounded or network-selected copy. */
    private chainIdCell;
    private readonly totalDeadlineMs;
    private readonly abortSignal;
    private directGuard;
    private readonly directGuardState;
    constructor(endpoint: string, options?: {
        readonly totalDeadlineMs?: number;
        readonly x402Asset?: X402Asset;
        readonly abortSignal?: AbortSignal;
        readonly directGuardState?: StateStore;
    });
    /** The selected x402 asset; an instance built without one (direct transfers, relays, Permit2 reads) answers no x402 read. */
    private bound;
    /** The first arm of an invocation sets its cap; direct EVM steps pass the cap derived from their read plan. */
    armEvmDirectRpcGuard(maxPhysicalRequests?: number): void;
    /** Relay uses a single cancellation signal for all POSTs in one execute invocation. */
    withAbortSignal(signal: AbortSignal): HttpsBaseRpc;
    /** Resolve and validate public addresses before a caller reserves a physical POST start. */
    primePublicAddresses(): Promise<void>;
    withTotalTimeout(milliseconds: number): X402RpcPort;
    forX402Network(chainId: number, token?: Address): HttpsBaseRpc;
    assertX402Chain(chainId: number): Promise<{
        readonly chainId: number;
        readonly rpcOrigin: string;
    }>;
    /** Proven once per instance (its IP is pinned); later Base reads in the same invocation do not re-ask. */
    assertBaseChain(): Promise<{
        readonly chainId: 8453;
        readonly rpcOrigin: string;
    }>;
    private endpointChainId;
    getBalances(address: Address): Promise<BalanceSnapshot>;
    /**
     * One header at the asset's proof tag, then one batch pinned to it (EIP-1898, no header recheck): balance and
     * DOMAIN_SEPARATOR; for a token outside the released USDC pairs also decimals() and authorizationState(payer, nonce)
     * of the fresh nonce, which proves the EIP-3009 state the settlement proof reads exists and answers.
     */
    getX402PrepareEvidence(address: Address, nonce?: Hex): Promise<X402PrepareEvidence>;
    getX402Head(tag: "safe" | "finalized"): Promise<X402RpcHead>;
    getX402Block(number: string): Promise<X402RpcBlock>;
    getX402Receipt(transactionHash: Hex): Promise<X402RpcReceipt | null>;
    getX402AuthorizationState(authorizer: Address, nonce: Hex, block: X402BlockReference): Promise<X402AuthorizationState>;
    /** Prepare evidence of a Permit2 offer for this instance's asset (src/x402-permit2-rpc.ts). */
    getX402Permit2PrepareEvidence(address: Address, nonce: Hex, permitNeeded: (allowanceAtomic: string) => boolean): Promise<X402Permit2PrepareEvidence>;
    /** Permit2's nonce bit, read like `getX402AuthorizationState` at a tag's or a number's block. */
    getX402Permit2NonceState(owner: Address, nonce: Hex, block: X402BlockReference): Promise<X402AuthorizationState>;
    getX402AuthorizationUsedLogs(input: {
        readonly authorizer: Address;
        readonly nonce: Hex;
        readonly fromBlock: string;
        readonly toBlock: string;
    }): Promise<X402AuthorizationUsedLogs>;
    getX402TransferLogs(input: {
        readonly from: Address;
        readonly to?: Address;
        readonly fromBlock: string;
        readonly toBlock: string;
    }): Promise<X402TransferLogs>;
    getPendingNonce(address: Address): Promise<string>;
    estimateDirectTransfer(input: {
        readonly from: Address;
        readonly to: Address;
        readonly data: Hex;
    }): Promise<FeeEstimate>;
    estimateTransaction(input: {
        readonly from: Address;
        readonly to: Address;
        readonly data: Hex;
    }): Promise<FeeEstimate>;
    /** The pre-transport refusal a guarded POST would meet now (cap spent, provider cooling down); sends nothing. */
    assertPostCapacity(): Promise<void>;
    submitRawTransaction(rawTransaction: Hex, beforeSend?: () => void): Promise<Hex>;
    getReceipt(transactionHash: Hex): Promise<RpcReceipt | null>;
    coinbaseGaslessCall(method: Parameters<NonNullable<RpcPort["coinbaseGaslessCall"]>>[0], params: readonly unknown[]): Promise<unknown>;
    coinbaseGaslessLogs(filter: Readonly<Record<string, unknown>>): Promise<readonly unknown[]>;
    private call;
    batchCall(calls: readonly ReadOnlyRpcBatchCall[]): Promise<readonly unknown[]>;
    private callX402Logs;
    private resolvePublicAddresses;
    private postDirectGuarded;
    private remainingTimeoutMs;
}
