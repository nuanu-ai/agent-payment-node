import type { BridgeChainId } from "./chains.js";
/** Proofs recorded with the Base operator fee proven by the pinned GasPriceOracle at the inclusion block (0.5.42 and older records;
 * read-only, validated by operation-validation.ts). */
export declare const BRIDGE_FEE_RULE_HASH: string;
/** Proofs whose Base L1 and operator fees come from the receipt's own fee fields, as for the L1 fee before. */
export declare const BRIDGE_RECEIPT_FEE_RULE_HASH: string;
/**
 * The paid fee of one source effect, from its receipt alone. Base: the receipt's `l1Fee` and the Jovian operator fee from
 * its `operatorFeeScalar`/`operatorFeeConstant` (absent fields are zero parameters), exactly as the Relay rail decodes it.
 * Arbitrum: the poster gas is inside gasUsed * effectiveGasPrice. Other chains: execution plus any EIP-4844 blob fee.
 */
export declare function bridgeActualFees(chainId: BridgeChainId, receipt: Readonly<Record<string, unknown>>): {
    gasUsedAtomic: string;
    effectiveGasPriceAtomic: string;
    executionFeeWei: string;
    l1DataFeeWei: string;
    operatorFeeWei: string;
    blobFeeWei: string;
    actualTotalFeeWei: string;
    feeEvidence: {
        receiptHash: string;
        ruleHash: string;
        baseOracle: null;
        arbitrumPosterGasAtomic: string | null;
    };
};
