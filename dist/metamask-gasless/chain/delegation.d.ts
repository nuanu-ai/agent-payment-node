import type { Hex } from "../../model.js";
import type { MetaMaskGaslessIntent } from "../model.js";
export interface VerifiedRedemption {
    readonly calldata: Hex;
    readonly signature: Hex;
    readonly executionCallData: Hex;
}
/** Decode and independently authenticate the one-root MetaMask delegation redemption. */
export declare function verifyRedemption(calldataInput: Hex, intent: MetaMaskGaslessIntent): Promise<VerifiedRedemption>;
