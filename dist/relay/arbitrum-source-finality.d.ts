/** Read-only Arbitrum source finality. A proof here says nothing about Ethereum delivery. */
import type { Hex } from "viem";
import { type EvmUnsentOutcome } from "../evm-unsent-outcome.js";
import { EvmDirectRpcGuard } from "../evm-direct-rpc-guard.js";
import { HttpsBaseRpc } from "../rpc.js";
import type { StateStore } from "../state.js";
export interface RelayArbitrumExpectedEffect {
    readonly transactionHash: Hex;
    readonly from: string;
    readonly to: string;
    readonly data: Hex;
    readonly valueWei: bigint;
}
export interface RelayArbitrumSourceProof {
    readonly sourceChainId: 42161;
    readonly rpcOrigin: string;
    readonly deposit: Readonly<{
        transactionHash: Hex;
        blockNumber: string;
        blockHash: Hex;
    }>;
    readonly approval: Readonly<{
        transactionHash: Hex;
        blockNumber: string;
        blockHash: Hex;
    }> | null;
    readonly safeHead: Readonly<{
        number: string;
        hash: Hex;
    }>;
    readonly proofClass: "canonical_safe_source_receipts";
    readonly destinationDeliveryProven: false;
    readonly causalLinkCryptographicallyProven: false;
    readonly paidAcceptance: false;
}
/** A source effect whose receipt reverted at safe finality. A revert at that depth is final; nothing is resent. */
export interface RelayArbitrumRevertProof {
    readonly sourceChainId: 42161;
    readonly rpcOrigin: string;
    readonly reverted: Readonly<{
        transactionHash: Hex;
        blockNumber: string;
        blockHash: Hex;
    }>;
    readonly safeHead: Readonly<{
        number: string;
        hash: Hex;
    }>;
    readonly proofClass: "canonical_safe_source_revert";
}
/** Sealed bytes that never crossed `submitting`: another transaction consumed their nonce at safe depth. */
export interface RelayArbitrumNeverLandedProof {
    readonly sourceChainId: 42161;
    readonly rpcOrigin: string;
    readonly transactionHash: Hex;
    readonly signedNonce: string;
    readonly safeNonce: string;
    readonly safeHead: Readonly<{
        number: string;
        hash: Hex;
    }>;
    readonly proofClass: "canonical_safe_nonce_consumed";
}
/** One shared 24-POST guard; at most two batches per effect plus one joint final recheck. */
export declare class RelayArbitrumSourceFinalityObserver {
    private readonly url;
    private readonly state;
    private readonly guardFactory;
    private readonly holdAfterPost;
    private readonly rpc;
    constructor(url: string, state: StateStore, rpc?: Pick<HttpsBaseRpc, "batchCall">, guardFactory?: () => EvmDirectRpcGuard, holdAfterPost?: () => Promise<void>);
    observe(deposit: RelayArbitrumExpectedEffect, approval?: RelayArbitrumExpectedEffect): Promise<RelayArbitrumSourceProof | null>;
    /** One read-only POST: the safe nonce is past the signed nonce and the node does not know the signed hash. */
    observeUnsent(effect: Readonly<{
        transactionHash: Hex;
        from: string;
        nonce: bigint;
    }>): Promise<Readonly<{
        outcome: EvmUnsentOutcome;
        proof: RelayArbitrumNeverLandedProof | null;
    }>>;
    /** The same canonical safe reads as `observe`, accepting only a reverted receipt. */
    observeRevert(effect: RelayArbitrumExpectedEffect): Promise<RelayArbitrumRevertProof | null>;
    private batch;
    private confirmTogether;
    private effect;
}
