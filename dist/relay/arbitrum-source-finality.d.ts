/** Read-only Arbitrum source finality. A proof here says nothing about Ethereum delivery. */
import type { Hex } from "viem";
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
/** Each invocation has one shared 24-POST guard; each effect consumes at most two read-only batches. */
export declare class RelayArbitrumSourceFinalityObserver {
    private readonly url;
    private readonly state;
    private readonly guardFactory;
    private readonly rpc;
    constructor(url: string, state: StateStore, rpc?: Pick<HttpsBaseRpc, "batchCall">, guardFactory?: () => EvmDirectRpcGuard);
    observe(deposit: RelayArbitrumExpectedEffect, approval?: RelayArbitrumExpectedEffect): Promise<RelayArbitrumSourceProof | null>;
    private batch;
    private effect;
}
