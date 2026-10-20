import { ApnError } from "../../errors.js";
import type { MetaMaskGaslessChainId } from "../model.js";
import type { MetaMaskGaslessFailureReason } from "../reasons.js";
import type { MetaMaskReadDiagnostic } from "./read-diagnostic.js";
export interface MetaMaskProviderRefusal {
    readonly message: string;
    readonly details: Readonly<Record<string, string | number>>;
}
/** Parent side only: restate a classified read failure as the provider's answer when it is one. */
export declare function withMetaMaskProviderRefusal(error: ApnError, d: MetaMaskReadDiagnostic, chainId: MetaMaskGaslessChainId | undefined): ApnError;
/**
 * A provider answer, not an APN fault, stated as exactly what MetaMask said: which provider read, which network and
 * which field. Only closed facts, proven numbers and APN's own constants appear; no provider text crosses the helper
 * boundary. A missing relay fee is never read as a USDC shortfall: the cause is named only when the answer's own
 * numbers prove it (METAMASK-FEE-REFUSAL-ASSET-GUIDANCE-001), or APN's own balance read does.
 */
export declare function metaMaskProviderRefusal(reason: MetaMaskGaslessFailureReason, d: MetaMaskReadDiagnostic, chainId: MetaMaskGaslessChainId | undefined): MetaMaskProviderRefusal | undefined;
