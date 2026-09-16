/** Selected first-lane design; direct Circle is outside LI.FI inventory and executable admission. */
export declare const BASE_SOLANA_CIRCLE_V2_CANDIDATE: {
    readonly fromChainId: 8453;
    readonly toChain: "solana-mainnet";
    readonly fromToken: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";
    readonly toToken: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
    readonly provider: "Circle";
    readonly protocol: "CCTP V2";
    readonly delivery: "Forwarding Service";
    readonly feeQuote: "signed_upfront_separate_from_burned_principal";
    readonly providerRouteState: "selected_design_unverified_for_execution";
    readonly executable: false;
};
/** LI.FI inventory candidate; the separate captured Mayan evidence remains exploratory only. */
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
