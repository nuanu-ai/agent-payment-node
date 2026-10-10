import type { EvmFeeQuote } from "./evm-ports.js";
import type { Address, Hex } from "./model.js";
export declare const METAMASK_NATIVE_FEE_SELLER: "0x991e254b5c8e0aaf6c244eaa2706bad059809b04";
export declare const METAMASK_NATIVE_FEE_AMOUNT_ATOMIC: "1000";
export declare const METAMASK_NATIVE_FEE_QUOTE_SCHEMA: "apn.metamask-native-fee-quote.v1";
export declare const METAMASK_NATIVE_FEE_RECEIPT_SCHEMA: "apn.metamask-native-fee-receipt.v1";
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
 * Pure binding for one fixed native-paid USDC transfer. This is evidence validation, not signing authority:
 * callers must source `nativeFeeCapAtomic` from the current owner policy and must retain their own APN/vendor guards.
 */
export interface MetaMaskNativeFeeQuote {
    readonly schemaVersion: typeof METAMASK_NATIVE_FEE_QUOTE_SCHEMA;
    readonly chainId: MetaMaskNativeFeeChainId;
    readonly sender: Address;
    readonly token: Address;
    readonly tokenDecimals: 6;
    readonly seller: typeof METAMASK_NATIVE_FEE_SELLER;
    readonly grossAtomic: typeof METAMASK_NATIVE_FEE_AMOUNT_ATOMIC;
    readonly netAtomic: typeof METAMASK_NATIVE_FEE_AMOUNT_ATOMIC;
    readonly tokenFeeAtomic: "0";
    readonly nativeFeeCapAtomic: string;
    readonly transaction: MetaMaskNativeFeeTransaction;
    readonly feeQuote: EvmFeeQuote;
    readonly expiresAt: string;
    readonly quoteHash: string;
}
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
export {};
