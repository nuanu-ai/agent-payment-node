/** Provider inventory candidates are deliberately outside the executable bridge asset registry. */
export const BASE_SOLANA_USDC_CANDIDATE = {
  fromChainId: 8453,
  toChainId: 1151111081099710,
  fromToken: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
  toToken: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
  providerRouteState: "unverified_by_static_capabilities",
  executable: false,
} as const;

/** LI.FI inventory only. TRON is TVM, not an executable APN bridge chain. */
export const BASE_TRON_USDT_CANDIDATE = {
  fromChainId: 8453,
  toChainId: 728126428,
  fromToken: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
  toToken: "TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t",
  tool: "near",
  providerRouteState: "unverified_by_static_capabilities",
  executable: false,
} as const;
