import { ApnError } from "../../errors.js";
import { directEvmNetwork } from "../../evm-direct-networks.js";
import type { MetaMaskGaslessChainId } from "../model.js";
import type { MetaMaskGaslessFailureReason } from "../reasons.js";
import { mmSentinelQuoteEndpoint, MM_SENTINEL_NETWORKS_ENDPOINT, MM_SERVER_WALLET_NETWORKS_ENDPOINT } from "./provider-endpoints.js";
import type { MetaMaskReadDiagnostic } from "./read-diagnostic.js";

/** The pinned SDK's own words for a low fee tier without `tokenFees` (vendor chunk-IFNW6LVK.mjs, function O). */
export const MM_SDK_MISSING_TOKEN_FEES_READING = "Insufficient balance to cover the transfer and gasless relay fee.";

export interface MetaMaskProviderRefusal { readonly message: string; readonly details: Readonly<Record<string, string | number>> }

/** Parent side only: restate a classified read failure as the provider's answer when it is one. */
export function withMetaMaskProviderRefusal(error: ApnError, d: MetaMaskReadDiagnostic,
  chainId: MetaMaskGaslessChainId | undefined): ApnError {
  const reason = error.details?.reason;
  const refusal = typeof reason === "string" ? metaMaskProviderRefusal(reason as MetaMaskGaslessFailureReason, d, chainId) : undefined;
  return refusal === undefined ? error : new ApnError(error.code, refusal.message, { ...error.details, ...refusal.details });
}

/**
 * A provider answer, not an APN fault, stated as exactly what MetaMask said: which provider read, which network and
 * which field. Only closed facts and APN's own constants appear; no provider text crosses the helper boundary.
 */
export function metaMaskProviderRefusal(reason: MetaMaskGaslessFailureReason, d: MetaMaskReadDiagnostic,
  chainId: MetaMaskGaslessChainId | undefined): MetaMaskProviderRefusal | undefined {
  if (chainId === undefined) return undefined;
  const network = directEvmNetwork(chainId).name;
  if (reason === "mm_gasless_fee_unquoted" && d.tokenFeesKind !== undefined && d.sentinelSimulation !== undefined) {
    const sdkReading = d.tokenFeesKind === "missing" || d.tokenFeesKind === "null";
    return { message: `MetaMask quoted no USDC relay fee for this transfer on ${network} (chain ${chainId}): its fee quote answered ` +
      `HTTP ${String(d.httpStatus)} with result.transactions[-1].fees[0].tokenFees ${d.tokenFeesKind === "missing" ? "missing" : `set to ${d.tokenFeesKind}`}.` +
      (sdkReading ? ` The pinned MetaMask client reads this answer as: ${MM_SDK_MISSING_TOKEN_FEES_READING}` : ""),
    details: { provider_read: "metamask-tx-sentinel fee quote", provider_endpoint: mmSentinelQuoteEndpoint(chainId),
      provider_method: "infura_simulateTransactions", provider_missing_field: "result.transactions[-1].fees[0].tokenFees",
      chain_id: chainId, network,
      ...(sdkReading ? { provider_client_reading: MM_SDK_MISSING_TOKEN_FEES_READING } : {}) } };
  }
  if (reason === "mm_gasless_relay_unsupported" && d.relayServerWalletNetwork !== undefined && d.relaySentinelFlag !== undefined) {
    const missing = [
      ...(d.relayServerWalletNetwork === "unlisted" ? [`the server-wallet network list (${MM_SERVER_WALLET_NETWORKS_ENDPOINT}) does not list chain ${chainId}`] : []),
      ...(d.relaySentinelFlag !== "enabled" ? [`the relay network list (${MM_SENTINEL_NETWORKS_ENDPOINT}) ${d.relaySentinelFlag === "absent"
        ? `has no row for chain ${chainId}` : `marks chain ${chainId} relayTransactions false`}`] : []),
    ];
    return { message: `MetaMask offers no gasless relay on ${network} (chain ${chainId}): ${missing.length === 0
      ? "both provider network lists name the chain, yet the pinned MetaMask client reported no relay support" : missing.join("; ")}.`,
    details: { provider_read: "metamask relay network lists", provider_endpoint: MM_SENTINEL_NETWORKS_ENDPOINT,
      provider_server_wallet_endpoint: MM_SERVER_WALLET_NETWORKS_ENDPOINT, chain_id: chainId, network } };
  }
  return undefined;
}
