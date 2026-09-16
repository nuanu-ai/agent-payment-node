/** Provider inventory candidates are deliberately outside the executable bridge asset registry. */
export declare const BASE_SOLANA_USDC_CANDIDATE: {
    readonly fromChainId: 8453;
    readonly toChainId: 1151111081099710;
    readonly fromToken: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";
    readonly toToken: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
    readonly providerRouteState: "unverified_by_static_capabilities";
    readonly executable: false;
};
/** LI.FI inventory only. TRON is TVM, not an executable APN bridge chain. */
export declare const BASE_TRON_USDT_CANDIDATE: {
    readonly fromChainId: 8453;
    readonly toChainId: 728126428;
    readonly fromToken: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";
    readonly toToken: "TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t";
    readonly tool: "near";
    readonly providerRouteState: "unverified_by_static_capabilities";
    readonly executable: false;
};
