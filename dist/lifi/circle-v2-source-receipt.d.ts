export declare const BASE_CCTP_V2_TOKEN_MESSENGER_WITH_FEES: `0x${string}`;
/** This live path admits only a FORWARD quote. The wrapper then selects Standard CCTP with zero burn maxFee. */
export declare function circleV2BurnTermsFromQuote(responseValue: unknown): {
    maxFeeAtomic: string;
    minFinalityThreshold: 1000 | 2000;
};
