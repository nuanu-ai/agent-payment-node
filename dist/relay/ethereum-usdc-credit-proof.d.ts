import { EvmDirectRpcGuard } from "../evm-direct-rpc-guard.js";
import { HttpsBaseRpc } from "../rpc.js";
import type { StateStore } from "../state.js";
import { validateRelayArbitrumUsdcEthereumUsdcQuote } from "./arbitrum-usdc-ethereum-quote.js";
type Quote = Awaited<ReturnType<typeof validateRelayArbitrumUsdcEthereumUsdcQuote>>;
export interface RelayEthereumUsdcTransaction {
    readonly hash: string;
    readonly chainId: number;
    readonly blockNumber: bigint | null;
    readonly blockHash: string | null;
}
export interface RelayEthereumUsdcReceipt {
    readonly transactionHash: string;
    readonly status: "success" | "reverted";
    readonly blockNumber: bigint;
    readonly blockHash: string;
    readonly logs: readonly Readonly<{
        address: string;
        topics: readonly string[];
        data: string;
        transactionHash: string;
        blockNumber: bigint;
        blockHash: string;
        removed: boolean;
        logIndex: bigint;
    }>[];
}
export interface RelayEthereumUsdcBlock {
    readonly number: bigint;
    readonly hash: string;
}
export interface RelayEthereumUsdcProofPorts {
    chainId(): Promise<number>;
    transaction(hash: string): Promise<RelayEthereumUsdcTransaction | null>;
    receipt(hash: string): Promise<RelayEthereumUsdcReceipt | null>;
    block(number: bigint): Promise<RelayEthereumUsdcBlock | null>;
    safeBlock(): Promise<RelayEthereumUsdcBlock | null>;
}
export type RelayEthereumUsdcCreditResult = Readonly<{
    relayOrderFulfillmentProven: false;
    paidAcceptance: false;
}> & (Readonly<{
    status: "recipient_credit_proven";
    proof: Readonly<{
        quoteDigest: string;
        orderId: string;
        destinationTransactionHash: string;
        destinationBlockNumber: string;
        destinationBlockHash: string;
        safeBlockNumber: string;
        safeBlockHash: string;
        token: string;
        recipient: string;
        minimumOutputAtomic: string;
        creditedAtomic: string;
        transferLogIndex: string;
        proofClass: "canonical_safe_erc20_transfer_log";
    }>;
}> | Readonly<{
    status: "pending" | "unproven" | "mismatch";
    reason: string;
}>);
/** A candidate from Relay status is only a discovery hint, including when it is a real credit. */
export declare function proveRelayEthereumUsdcCredit(quote: Quote, candidateHash: string, ports: RelayEthereumUsdcProofPorts): Promise<RelayEthereumUsdcCreditResult>;
/** Keyless, shared-guard JSON-RPC session. At most seven physical POSTs per candidate. */
export declare class RelayEthereumUsdcReadOnlyRpc implements RelayEthereumUsdcProofPorts {
    private readonly url;
    private readonly rpc;
    private readonly guard;
    constructor(url: string, state: StateStore, rpc?: HttpsBaseRpc, guard?: EvmDirectRpcGuard);
    get physicalPosts(): number;
    private read;
    chainId(): Promise<number>;
    transaction(hash: string): Promise<RelayEthereumUsdcTransaction | null>;
    receipt(hash: string): Promise<RelayEthereumUsdcReceipt | null>;
    block(number: bigint): Promise<RelayEthereumUsdcBlock | null>;
    safeBlock(): Promise<RelayEthereumUsdcBlock | null>;
}
export {};
