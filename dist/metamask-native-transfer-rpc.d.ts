import { EvmRpc } from "./evm-rpc.js";
import type { EvmBalanceSnapshot } from "./evm-ports.js";
import type { Hex } from "./model.js";
import { type MetaMaskNativeFeeChainId, type MetaMaskNativeFeeQuote, type MetaMaskNativeFeeReceiptEvidence, type MetaMaskNativeFeeReceiptVerdict } from "./metamask-native-fee-evidence.js";
export declare const METAMASK_NATIVE_FIXED_SENDER: `0x${string}`;
export type FixedMetaMaskNativeObservation = {
    readonly kind: "accepted";
    readonly receipt: MetaMaskNativeFeeReceiptVerdict;
    readonly evidence: MetaMaskNativeFeeReceiptEvidence;
} | {
    readonly kind: "pending" | "inconclusive";
    readonly reason: string;
};
/** Recheck the fixed owner's current pending nonce before a private signing handoff. */
export declare function readFixedMetaMaskNativeNonce(chainId: MetaMaskNativeFeeChainId): Promise<string>;
export declare function readFixedMetaMaskNativeBalances(chainId: MetaMaskNativeFeeChainId): Promise<EvmBalanceSnapshot>;
export declare function prepareFixedMetaMaskNativeQuote(input: {
    readonly chainId: MetaMaskNativeFeeChainId;
    readonly maximumNativeFeeWei: string;
}): Promise<MetaMaskNativeFeeQuote>;
/** Test injection is the existing EvmRpc read-only transport, never a signing or payment callback. */
export declare function prepareWithRpc(rpc: EvmRpc, input: {
    readonly chainId: MetaMaskNativeFeeChainId;
    readonly maximumNativeFeeWei: string;
}): Promise<MetaMaskNativeFeeQuote>;
export declare function observeFixedMetaMaskNativeTransfer(quote: MetaMaskNativeFeeQuote, transactionHash: Hex): Promise<FixedMetaMaskNativeObservation>;
export declare function observeWithRpc(rpc: EvmRpc, quoteValue: MetaMaskNativeFeeQuote, transactionHash: Hex): Promise<FixedMetaMaskNativeObservation>;
