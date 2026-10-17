export interface UniswapDecodedRoute {
    readonly command: "V2_SWAP_EXACT_IN" | "V3_SWAP_EXACT_IN";
    readonly recipient: string;
    readonly inputAmountAtomic: string;
    readonly minimumOutputAtomic: string;
    readonly deadline: number;
    readonly routeHash: string;
}
/** Strict Universal Router proof for an explicit pinned output token; the path must end at exactly that token. */
export declare function decodeUniswapRouterCalldataFor(data: `0x${string}`, expected: {
    readonly recipient: string;
    readonly inputAmountAtomic: string;
    readonly minimumOutputAtomic: string;
    readonly deadline: number;
    readonly outputToken: string;
}): UniswapDecodedRoute;
