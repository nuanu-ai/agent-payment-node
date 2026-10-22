/**
 * What an owner reads beside an x402 policy's token address: the released USDC of Base, Ethereum or Arbitrum, or the
 * symbol and decimals APN's frozen token list names for that exact chain and contract; null when the list has no row.
 */
export declare function x402TokenUnit(chainId: number, token: string): {
    readonly symbol: string;
    readonly decimals: number;
} | null;
/** How an error names an x402 asset: "MXNB (0xF197…, 6 decimals) on eip155:8453", or the bare address the list does not name. */
export declare function x402AssetLabel(chainId: number, token: string): string;
