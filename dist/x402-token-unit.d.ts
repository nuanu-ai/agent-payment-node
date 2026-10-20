/**
 * What an owner reads beside an x402 policy's token address: the released USDC of Base, Ethereum or Arbitrum, or the
 * symbol and decimals APN's frozen token list names for that exact chain and contract; null when the list has no row.
 */
export declare function x402TokenUnit(chainId: number, token: string): {
    readonly symbol: string;
    readonly decimals: number;
} | null;
