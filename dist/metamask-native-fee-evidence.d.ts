import type { EvmFeeQuote } from "./evm-ports.js";
import type { Address, Hex } from "./model.js";
/** Version 1 quotes (0.5.40 to 0.5.43) paid this one recipient this one amount; they stay readable, never prepared. */
export declare const METAMASK_NATIVE_FEE_SELLER: "0x991e254b5c8e0aaf6c244eaa2706bad059809b04";
export declare const METAMASK_NATIVE_FEE_AMOUNT_ATOMIC: "1000";
export declare const METAMASK_NATIVE_FEE_QUOTE_SCHEMA: "apn.metamask-native-fee-quote.v1";
/** Version 2 carries the operation's own recipient and amount (OWNR-23). */
export declare const METAMASK_NATIVE_FEE_QUOTE_SCHEMA_V2: "apn.metamask-native-fee-quote.v2";
/** The receipt record names no recipient or amount; it binds to its quote by `quoteHash`, so one version serves both. */
export declare const METAMASK_NATIVE_FEE_RECEIPT_SCHEMA: "apn.metamask-native-fee-receipt.v1";
/** Networks where the native lane runs: protocol data (canonical USDC listed, Agent Wallet send support), not a person. */
export declare const METAMASK_NATIVE_CHAINS: readonly [1, 10, 143, 59144, 1329];
declare const CHAINS: readonly [1, 10, 143, 59144, 1329];
export type MetaMaskNativeFeeChainId = typeof CHAINS[number];
export interface MetaMaskNativeFeeTransaction {
    readonly type: 2;
    readonly to: Address;
    readonly data: Hex;
    readonly valueAtomic: "0";
    readonly nonceAtomic: string;
    readonly gasLimitAtomic: string;
    readonly maxFeePerGasAtomic: string;
    readonly maxPriorityFeePerGasAtomic: string;
    readonly authorizationList: readonly [];
}
/**
 * Pure binding for one native-paid USDC transfer. This is evidence validation, not signing authority:
 * callers must source `nativeFeeCapAtomic` from the current owner policy and must retain their own APN/vendor guards.
 */
interface MetaMaskNativeFeeQuoteBase {
    readonly chainId: MetaMaskNativeFeeChainId;
    readonly sender: Address;
    readonly token: Address;
    readonly tokenDecimals: 6;
    readonly nativeFeeCapAtomic: string;
    readonly transaction: MetaMaskNativeFeeTransaction;
    readonly feeQuote: EvmFeeQuote;
    readonly expiresAt: string;
    readonly quoteHash: string;
}
export interface MetaMaskNativeFeeQuoteV1 extends MetaMaskNativeFeeQuoteBase {
    readonly schemaVersion: typeof METAMASK_NATIVE_FEE_QUOTE_SCHEMA;
    readonly seller: typeof METAMASK_NATIVE_FEE_SELLER;
    readonly grossAtomic: typeof METAMASK_NATIVE_FEE_AMOUNT_ATOMIC;
    readonly netAtomic: typeof METAMASK_NATIVE_FEE_AMOUNT_ATOMIC;
    readonly tokenFeeAtomic: "0";
}
export interface MetaMaskNativeFeeQuoteV2 extends MetaMaskNativeFeeQuoteBase {
    readonly schemaVersion: typeof METAMASK_NATIVE_FEE_QUOTE_SCHEMA_V2;
    readonly recipient: Address;
    readonly amountAtomic: string;
}
export type MetaMaskNativeFeeQuote = MetaMaskNativeFeeQuoteV1 | MetaMaskNativeFeeQuoteV2;
/** The transfer a quote pays: its own recipient and amount, or the fixed pair of a version 1 quote. */
export declare function metaMaskNativeQuoteTransfer(quote: MetaMaskNativeFeeQuote): {
    readonly recipient: Address;
    readonly amountAtomic: string;
};
/** The exact `transfer(recipient, amount)` calldata of a quote. */
export declare function metaMaskNativeTransferData(recipient: Address, amountAtomic: string): Hex;
export interface MetaMaskNativeFeeLog {
    readonly address: Address;
    readonly topics: readonly Hex[];
    readonly data: Hex;
}
export interface MetaMaskNativeFeeBlock {
    readonly numberAtomic: string;
    readonly hash: Hex;
}
export interface MetaMaskOpStackFeeComponents {
    /** Exact fee data returned by the receipt source; never inferred from the EVM execution fee. */
    readonly l1DataFeeAtomic: string;
    readonly operatorFeeAtomic: string;
    readonly receiptExtensionHash: string;
}
/**
 * Source-backed transaction and receipt fields required by the pure verifier.
 * The read-side wrapper must bind `canonicalBlock`, safe head, and OP fee extension to the same RPC source.
 */
export interface MetaMaskNativeFeeReceiptEvidence {
    readonly schemaVersion: typeof METAMASK_NATIVE_FEE_RECEIPT_SCHEMA;
    readonly quoteHash: string;
    readonly transactionHash: Hex;
    readonly chainId: MetaMaskNativeFeeChainId;
    readonly sender: Address;
    readonly to: Address;
    readonly valueAtomic: "0";
    readonly transactionType: 2;
    readonly nonceAtomic: string;
    readonly data: Hex;
    readonly gasLimitAtomic: string;
    readonly maxFeePerGasAtomic: string;
    readonly maxPriorityFeePerGasAtomic: string;
    readonly authorizationList: readonly [];
    readonly status: "success" | "reverted";
    readonly gasUsedAtomic: string;
    readonly effectiveGasPriceAtomic: string;
    readonly receiptBlock: MetaMaskNativeFeeBlock;
    readonly canonicalBlock: MetaMaskNativeFeeBlock;
    readonly safeHead?: MetaMaskNativeFeeBlock;
    readonly logs: readonly MetaMaskNativeFeeLog[];
    readonly rpcOrigin: string;
    readonly observedAt: string;
    readonly opStackFeeComponents?: MetaMaskOpStackFeeComponents;
}
export interface MetaMaskNativeFeeReceiptVerdict {
    readonly schemaVersion: typeof METAMASK_NATIVE_FEE_RECEIPT_SCHEMA;
    readonly transactionHash: Hex;
    readonly quoteHash: string;
    readonly chainId: MetaMaskNativeFeeChainId;
    readonly nativeSymbol: string;
    readonly nativeDecimals: 18;
    readonly nativeFeeAtomic: string;
    readonly transferAccepted: boolean;
    readonly disposition: "exact_transfer_confirmed" | "reverted_fee_charged";
    readonly receiptBlock: MetaMaskNativeFeeBlock;
    readonly finality: "inclusion" | "safe";
}
export declare function validateMetaMaskNativeFeeQuote(value: unknown, now?: Date): MetaMaskNativeFeeQuote;
export declare function validateMetaMaskNativeFeeReceipt(value: unknown, quoteValue: unknown): MetaMaskNativeFeeReceiptVerdict;
/** The one canonical USDC listed for a native-lane network. */
export declare function metaMaskNativeUsdc(chainId: MetaMaskNativeFeeChainId): Address;
export {};
