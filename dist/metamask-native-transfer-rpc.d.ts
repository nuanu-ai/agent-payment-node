import { type MetaMaskNativeDeadlineInput } from "./metamask-native-diagnostic.js";
import { type Address } from "viem";
import { EvmRpc } from "./evm-rpc.js";
import type { EvmBalanceSnapshot } from "./evm-ports.js";
import type { Hex } from "./model.js";
import { type MetaMaskNativeFeeChainId, type MetaMaskNativeFeeQuote, type MetaMaskNativeFeeReceiptEvidence, type MetaMaskNativeFeeReceiptVerdict } from "./metamask-native-fee-evidence.js";
export type MetaMaskNativeObservation = {
    readonly kind: "accepted";
    readonly receipt: MetaMaskNativeFeeReceiptVerdict;
    readonly evidence: MetaMaskNativeFeeReceiptEvidence;
} | {
    readonly kind: "pending" | "inconclusive";
    readonly reason: string;
};
export interface MetaMaskNativeQuoteInput {
    readonly chainId: MetaMaskNativeFeeChainId;
    readonly maximumNativeFeeWei: string;
    readonly sender: Address;
    readonly recipient: Address;
    readonly amountAtomic: string;
}
/** Funding read on one endpoint: the sender's native and USDC balances, and its pending nonce when asked for. */
export interface MetaMaskNativeFunding {
    readonly balances: EvmBalanceSnapshot;
    readonly nonceAtomic?: string;
}
/** The last pre-send read: balances and the pending nonce through one endpoint, so its chain id is proven once. */
export declare function readMetaMaskNativeFunding(chainId: MetaMaskNativeFeeChainId, sender: Address, deadline: MetaMaskNativeDeadlineInput): Promise<Required<MetaMaskNativeFunding>>;
export declare function fundingWithRpc(rpc: EvmRpc, chainId: MetaMaskNativeFeeChainId, sender: Address, withNonce: boolean): Promise<MetaMaskNativeFunding>;
/** Quote and the sender's balances through one endpoint (one chain-id proof for the whole prepare). */
export declare function prepareMetaMaskNativeQuote(input: MetaMaskNativeQuoteInput): Promise<{
    readonly quote: MetaMaskNativeFeeQuote;
    readonly funding: MetaMaskNativeFunding;
}>;
/** Test injection is the existing EvmRpc read-only transport, never a signing or payment callback. */
export declare function prepareWithRpc(rpc: EvmRpc, input: MetaMaskNativeQuoteInput): Promise<MetaMaskNativeFeeQuote>;
export declare function observeMetaMaskNativeTransfer(quote: MetaMaskNativeFeeQuote, transactionHash: Hex): Promise<MetaMaskNativeObservation>;
/**
 * One observation of the stored hash on one endpoint of the quote's chain (any endpoint: its eth_chainId binds it, and
 * its origin is recorded as provenance only). P2: the chain id once, the receipt once, the receipt's block by
 * number, the finality head and the transaction once. The receipt's block hash binds everything read with it; nothing
 * is re-read around it, and the quote's own block is not re-proven (it says nothing about the transfer). OP-stack
 * only: the operator fee is read at the receipt block, a history read that a non-archive node serves for recent blocks;
 * when refused the observation stays inconclusive and can be repeated.
 */
export declare function observeWithRpc(rpc: EvmRpc, rpcOrigin: string, quoteValue: MetaMaskNativeFeeQuote, transactionHash: Hex): Promise<MetaMaskNativeObservation>;
