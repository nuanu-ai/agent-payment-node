import { ApnError } from "../errors.js";
import type { MetaMaskGaslessChainId, MetaMaskGaslessRequest } from "./model.js";
/** The server wallet's token balance, on APN's own validated `balanceOf` read, below the net amount plus the quoted fee. */
export declare function mmUsdcShortfallMessage(chainId: MetaMaskGaslessChainId, current: bigint | string, required: bigint | string, read: string, token?: string): string;
export declare function mmUsdcShortfall(chainId: MetaMaskGaslessChainId, current: bigint, required: bigint, read: string, facts: Readonly<Record<string, string | number>>, token?: string): ApnError;
/**
 * The owner's fee cap is the lower of the fee ceiling and the room the amounts leave (gross minus the recipient floor);
 * the refusal names whichever set it, in the request's own mode.
 */
export declare function mmFeeCapRefusal(request: MetaMaskGaslessRequest, fee: bigint, cap: bigint): ApnError;
/** Prepare-time next action: a higher cap, only if the owner accepts the quoted fee; the same prepare may then run. */
export declare function mmFeeCapNextAction(request: MetaMaskGaslessRequest, fee: bigint): string;
