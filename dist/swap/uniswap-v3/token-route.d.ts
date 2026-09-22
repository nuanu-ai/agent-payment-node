import { type Hex } from "viem";
import type { EvmRpcCall } from "../../evm-ports.js";
export declare const UNISWAP_V3_SWAP_ROUTER: "0xE592427A0AEce92De3Edee1F18E0157C05861564";
export declare const UNISWAP_V3_USDC_USDT_100: "0x3416cF6C708Da44DB2624D63ea0AAef7113527C6";
export declare const UNISWAP_V3_SWAP_ROUTER_CODE_HASH: "0xbb90113d2f9a5e9b7feb15a1d1fff06c1ee1575b3f9b1181778ffd0cf633e7ea";
export declare const UNISWAP_V3_USDC_USDT_100_CODE_HASH: "0x2ff673bacc60a73fc85c678888296c6bce3de2a9d7475c032fe7aa6e0eacba86";
export declare const UNISWAP_TOKEN_ROUTE_SCHEMA: "apn.uniswap-v3.swap-router.exact-input-single.v1";
export declare const UNISWAP_TOKEN_MECHANISM_PIN: import("../pin.js").SwapMechanismPin;
export declare const UNISWAP_TOKEN_PROTOCOL_REGISTRY: import("../protocol-registry.js").SwapProtocolRegistry;
export interface UniswapTokenRoute {
    readonly schemaVersion: typeof UNISWAP_TOKEN_ROUTE_SCHEMA;
    readonly inputToken: string;
    readonly outputToken: string;
    readonly recipient: string;
    readonly amountIn: string;
    readonly amountOutMinimum: string;
    readonly deadline: number;
    readonly router: typeof UNISWAP_V3_SWAP_ROUTER;
    readonly pool: typeof UNISWAP_V3_USDC_USDT_100;
    readonly fee: 100;
    readonly calldata: Hex;
    readonly routeHash: string;
}
export declare function createUniswapTokenRoute(input: {
    readonly inputToken: string;
    readonly outputToken: string;
    readonly recipient: string;
    readonly amountIn: string;
    readonly amountOutMinimum: string;
    readonly deadline: number;
}): UniswapTokenRoute;
export declare function validateUniswapTokenRoute(value: unknown): UniswapTokenRoute;
export declare function encodeUniswapTokenApproval(tokenAddress: string, amount: string): {
    readonly to: string;
    readonly spender: string;
    readonly data: Hex;
    readonly amount: string;
};
export declare function verifyUniswapTokenRoutePins(call: EvmRpcCall, tag: Hex): Promise<void>;
