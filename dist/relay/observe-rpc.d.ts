/** Bounded, keyless JSON-RPC adapters. Every batchCall here is one physical POST. */
import type { Hex } from "viem";
import { EvmDirectRpcGuard } from "../evm-direct-rpc-guard.js";
import { HttpsBaseRpc } from "../rpc.js";
import type { StateStore } from "../state.js";
import type { RelayDepositObservation } from "./deposit-effect.js";
import { type RelayBnbProofPorts, type RelayBnbBlock, type RelayBnbReceipt, type RelayBnbTransaction } from "./destination-proof.js";
import type { RelaySourceFinalityPorts } from "./observe.js";
/** Physical POSTs of one finalized source proof: chain, transaction, receipt and finality head; then the inclusion block. */
export declare const RELAY_SOURCE_FINALITY_POSTS = 2;
export declare class RelayEthereumFinalityRpc implements RelaySourceFinalityPorts {
    private readonly url;
    private readonly guardFactory;
    private readonly expectedChainId;
    private readonly rpc;
    constructor(url: string, state: StateStore, rpc?: HttpsBaseRpc, guardFactory?: () => EvmDirectRpcGuard, expectedChainId?: 1 | 56 | 8453);
    private read;
    /** P2: the finality head is read with the receipt, before the inclusion block; a canonical inclusion block at or
     * below that head is final, so neither header is re-read. */
    finalizedDeposit(hash: Hex): Promise<RelayDepositObservation | null>;
}
/** Reads requested in the same turn of the event loop leave as one JSON-RPC batch POST (P3); the chain id is read once. */
export declare class RelayBnbReadOnlyRpc implements RelayBnbProofPorts {
    private readonly url;
    private readonly expectedChainId;
    private readonly rpc;
    private readonly guard;
    private queued;
    private chain;
    constructor(url: string, state: StateStore, rpc?: HttpsBaseRpc, guard?: EvmDirectRpcGuard, expectedChainId?: 56 | 137 | 143 | 8453 | 4326);
    get physicalPosts(): number;
    private read;
    private flush;
    chainId(): Promise<number>;
    transaction(hash: string): Promise<RelayBnbTransaction | null>;
    receipt(hash: string): Promise<RelayBnbReceipt | null>;
    block(number: bigint): Promise<RelayBnbBlock | null>;
    finalityCheckpoint(): Promise<RelayBnbBlock | null>;
    polygonFinalizedCheckpoint(): Promise<RelayBnbBlock | null>;
}
