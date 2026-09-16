/** Selected first-lane design; direct Circle is outside LI.FI inventory and executable admission. */
export const BASE_SOLANA_CIRCLE_V2_CANDIDATE = {
    fromChainId: 8453,
    toChain: "solana-mainnet",
    fromToken: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
    toToken: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
    provider: "Circle",
    protocol: "CCTP V2",
    delivery: "Forwarding Service",
    feeQuote: "signed_upfront_separate_from_burned_principal",
    providerRouteState: "selected_design_unverified_for_execution",
    executable: false,
};
/** LI.FI inventory candidate; the separate captured Mayan evidence remains exploratory only. */
export const BASE_SOLANA_USDC_CANDIDATE = {
    fromChainId: 8453,
    toChainId: 1151111081099710,
    fromToken: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
    toToken: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
    providerRouteState: "unverified_by_static_capabilities",
    executable: false,
};
/** LI.FI inventory only. TRON is TVM, not an executable APN bridge chain. */
export const BASE_TRON_USDT_CANDIDATE = {
    fromChainId: 8453,
    toChainId: 728126428,
    fromToken: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
    toToken: "TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t",
    tool: "near",
    providerRouteState: "unverified_by_static_capabilities",
    executable: false,
};
//# sourceMappingURL=discovery-candidates.js.map