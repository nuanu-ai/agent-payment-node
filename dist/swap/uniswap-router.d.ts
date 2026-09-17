export interface UniswapDecodedRoute {
    readonly command: "V2_SWAP_EXACT_IN" | "V3_SWAP_EXACT_IN";
    readonly recipient: string;
    readonly inputAmountAtomic: string;
    readonly minimumOutputAtomic: string;
    readonly deadline: number;
    readonly routeHash: string;
}
export declare function decodeUniswapRouterCalldata(data: `0x${string}`, expected: {
    readonly recipient: string;
    readonly inputAmountAtomic: string;
    readonly minimumOutputAtomic: string;
    readonly deadline: number;
}): UniswapDecodedRoute;
