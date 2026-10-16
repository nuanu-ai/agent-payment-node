import type { EvmRpcCall } from "../evm-ports.js";
import { type SolanaRpcPort } from "../solana/rpc.js";
import type { SwapOperationRecord } from "./model.js";
export declare const SWAP_UNLANDED_PROOF_SCHEMA: "apn.swap-expired-unlanded-proof.v1";
/**
 * Chain evidence that a marked swap effect can never land. The bound fields (network, transaction identity and the
 * lifetime bound) are stable for one operation, so a retried terminal transition reproduces the same outcome digest.
 * The observed fields record what proved the bound passed; they are reported but not part of the digest.
 */
export type SwapUnlandedProof = {
    readonly network: "solana";
    readonly transactionId: string | null;
    readonly lastValidBlockHeight: string;
    readonly observedFinalizedBlockHeight: string;
} | {
    readonly network: "evm";
    readonly transactionId: string | null;
    readonly deadlineSeconds: string;
    readonly observedFinalizedBlockNumber: string;
    readonly observedFinalizedTimestamp: string;
} | {
    readonly network: "tron";
    readonly transactionId: string;
    readonly expirationMs: string;
    readonly observedSolidifiedBlockNumber: string;
    readonly observedSolidifiedTimestampMs: string;
};
export declare function validateSwapUnlandedProof(value: unknown, chain: string): SwapUnlandedProof;
/** The terminal outcome digest: one value per operation and transaction identity, independent of when it was observed. */
export declare function swapUnlandedProofHash(operation: SwapOperationRecord, proof: SwapUnlandedProof): string;
/**
 * Solana: the finalized block height passed the message's lastValidBlockHeight, so no later block can include it, and
 * the signature (when one was ever persisted) has no status with full history. The height is read first: a signature
 * persisted afterwards can only be sent into an expired lifetime. Two reads at most.
 */
export declare function proveSolanaUnlanded(rpc: Pick<SolanaRpcPort, "call">, input: {
    readonly lastValidBlockHeight: string;
    readonly loadSignature: () => Promise<string | null>;
}): Promise<SwapUnlandedProof | null>;
/**
 * EVM: the finalized block's timestamp passed the router deadline, so any later inclusion reverts and the input cannot
 * move, and the signed transaction (when one was ever persisted) has no receipt up to that finalized block.
 */
export declare function proveEvmUnlanded(call: EvmRpcCall, input: {
    readonly chainId: bigint;
    readonly deadlineSeconds: number;
    readonly loadTransactionHash: () => Promise<string | null>;
}): Promise<SwapUnlandedProof | null>;
export type TronUnlandedMethod = "walletsolidity/getnowblock" | "walletsolidity/gettransactionbyid" | "walletsolidity/gettransactioninfobyid";
/**
 * TRON: the solidified head's timestamp passed the transaction expiration, so no later block may include it, and the
 * solidified node has neither the transaction nor its info. Every earlier block is already solidified.
 */
export declare function proveTronUnlanded(rpc: {
    call(method: TronUnlandedMethod, body: Readonly<Record<string, unknown>>): Promise<unknown>;
}, input: {
    readonly transactionId: string;
    readonly expirationMs: string;
}): Promise<SwapUnlandedProof | null>;
