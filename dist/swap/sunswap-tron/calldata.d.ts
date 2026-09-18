import { type Hex } from "viem";
import { SUNSWAP_USDT, SUNSWAP_V2_ROUTER, SUNSWAP_WTRX } from "./catalog.js";
declare const SELECTOR: "7ff36ab5";
export interface SunSwapCalldataIntent {
    readonly owner: string;
    readonly recipient: string;
    readonly inputAmountAtomic: string;
    readonly minimumOutputAtomic: string;
    readonly deadlineSeconds: string;
}
export interface DecodedSunSwapCalldata extends SunSwapCalldataIntent {
    readonly router: typeof SUNSWAP_V2_ROUTER;
    readonly selector: typeof SELECTOR;
    readonly path: readonly [typeof SUNSWAP_WTRX, typeof SUNSWAP_USDT];
    readonly callValueAtomic: string;
}
export interface SunSwapV2SwapCall {
    readonly amountOutMinAtomic: string;
    readonly path: readonly string[];
    readonly to: string;
    readonly deadlineSeconds: string;
}
/** Encodes the only admitted call: router.swapExactETHForTokens(minOut, [WTRX, USDT], owner, deadline) with call_value = input. */
export declare function encodeSunSwapCalldata(input: SunSwapCalldataIntent): Hex;
/** Parses exactly one canonical swapExactETHForTokens call without applying any expectation. */
export declare function parseSunSwapV2SwapCall(calldata: unknown): SunSwapV2SwapCall;
export declare function decodeSunSwapCalldata(calldata: string, callValueAtomic: string, expected: SunSwapCalldataIntent): DecodedSunSwapCalldata;
export {};
