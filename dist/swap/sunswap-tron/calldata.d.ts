import { type Hex } from "viem";
import { SUNSWAP_NATIVE_TRX, SUNSWAP_USDT, SUNSWAP_V4_UNIVERSAL_ROUTER } from "./catalog.js";
declare const COMMAND: "0x08";
export interface SunSwapCalldataIntent {
    readonly owner: string;
    readonly recipient: string;
    readonly inputAmountAtomic: string;
    readonly minimumOutputAtomic: string;
    readonly deadlineSeconds: string;
}
export interface DecodedSunSwapCalldata extends SunSwapCalldataIntent {
    readonly router: typeof SUNSWAP_V4_UNIVERSAL_ROUTER;
    readonly sourceAsset: typeof SUNSWAP_NATIVE_TRX;
    readonly destinationAsset: typeof SUNSWAP_USDT;
    readonly command: typeof COMMAND;
    readonly callValueAtomic: string;
}
export declare function encodeSunSwapCalldata(input: SunSwapCalldataIntent): Hex;
export declare function decodeSunSwapCalldata(calldata: string, callValueAtomic: string, expected: SunSwapCalldataIntent): DecodedSunSwapCalldata;
export {};
