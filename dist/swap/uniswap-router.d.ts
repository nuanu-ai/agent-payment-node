export interface UniswapDecodedRoute {
    readonly command: "V2_SWAP_EXACT_IN" | "V3_SWAP_EXACT_IN";
    readonly recipient: string;
    readonly inputAmountAtomic: string;
    readonly minimumOutputAtomic: string;
    readonly deadline: number;
    readonly routeHash: string;
}
/** The official Trading API catalog pair: native ETH to USDC only. */
export declare function decodeUniswapRouterCalldata(data: `0x${string}`, expected: {
    readonly recipient: string;
    readonly inputAmountAtomic: string;
    readonly minimumOutputAtomic: string;
    readonly deadline: number;
}): UniswapDecodedRoute;
/** Same strict proof for an explicit pinned output token; the path must end at exactly that token. */
export declare function decodeUniswapRouterCalldataFor(data: `0x${string}`, expected: {
    readonly recipient: string;
    readonly inputAmountAtomic: string;
    readonly minimumOutputAtomic: string;
    readonly deadline: number;
    readonly outputToken: string;
}): UniswapDecodedRoute;
