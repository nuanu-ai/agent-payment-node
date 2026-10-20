import { ApnError } from "../../errors.js";
import type { MetaMaskGaslessChainId } from "../model.js";
import type { MetaMaskGaslessFailureReason } from "../reasons.js";
import type { MetaMaskReadDiagnostic } from "./read-diagnostic.js";
/** The pinned SDK's own words for a low fee tier without `tokenFees` (vendor chunk-IFNW6LVK.mjs, function O). */
export declare const MM_SDK_MISSING_TOKEN_FEES_READING = "Insufficient balance to cover the transfer and gasless relay fee.";
export interface MetaMaskProviderRefusal {
    readonly message: string;
    readonly details: Readonly<Record<string, string | number>>;
}
/** Parent side only: restate a classified read failure as the provider's answer when it is one. */
export declare function withMetaMaskProviderRefusal(error: ApnError, d: MetaMaskReadDiagnostic, chainId: MetaMaskGaslessChainId | undefined): ApnError;
/**
 * A provider answer, not an APN fault, stated as exactly what MetaMask said: which provider read, which network and
 * which field. Only closed facts and APN's own constants appear; no provider text crosses the helper boundary.
 */
export declare function metaMaskProviderRefusal(reason: MetaMaskGaslessFailureReason, d: MetaMaskReadDiagnostic, chainId: MetaMaskGaslessChainId | undefined): MetaMaskProviderRefusal | undefined;
