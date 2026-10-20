import { ApnError } from "../../errors.js";
import { directEvmNetwork } from "../../evm-direct-networks.js";
import { formatAtomic } from "../../money.js";
import type { MetaMaskGaslessChainId } from "../model.js";
import type { MetaMaskGaslessFailureReason } from "../reasons.js";
import { mmSentinelQuoteEndpoint, MM_SENTINEL_NETWORKS_ENDPOINT, MM_SERVER_WALLET_NETWORKS_ENDPOINT } from "./provider-endpoints.js";
import type { MetaMaskReadDiagnostic } from "./read-diagnostic.js";

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
 * which field. Only closed facts, proven numbers and APN's own constants appear; no provider text crosses the helper
 * boundary. A missing relay fee is never read as a USDC shortfall: the cause is named only when the answer's own
 * numbers prove it (METAMASK-FEE-REFUSAL-ASSET-GUIDANCE-001), or APN's own balance read does.
 */
export function metaMaskProviderRefusal(reason: MetaMaskGaslessFailureReason, d: MetaMaskReadDiagnostic,
  chainId: MetaMaskGaslessChainId | undefined): MetaMaskProviderRefusal | undefined {
  if (chainId === undefined) return undefined;
  const network = directEvmNetwork(chainId).name, where = `on ${network} (chain ${chainId})`;
  if (reason === "mm_gasless_fee_unquoted" && d.tokenFeesKind !== undefined && d.sentinelSimulation !== undefined) {
    const field = `result.transactions[-1].fees[0].tokenFees ${d.tokenFeesKind === "missing" ? "missing" : `set to ${d.tokenFeesKind}`}`;
    const read = { provider_read: "metamask-tx-sentinel fee quote", provider_endpoint: mmSentinelQuoteEndpoint(chainId),
      provider_method: "infura_simulateTransactions", provider_missing_field: "result.transactions[-1].fees[0].tokenFees",
      chain_id: chainId, network };
    const answer = `MetaMask quoted no USDC relay fee for this transfer ${where}: its fee quote answered HTTP ${String(d.httpStatus)} with ${field}`;
    if (d.nativeRequiredWei === undefined || d.nativeCurrentWei === undefined) {
      return { message: `${answer} and named no cause APN can verify. APN does not read a missing relay fee as a USDC or native gas shortfall.`,
        details: { ...read, provider_cause: "unverified" } };
    }
    const symbol = directEvmNetwork(chainId).nativeSymbol, native = (wei: string) => `${wei} wei (${formatAtomic(wei, 18)} ${symbol})`;
    return { message: `${answer}. Its simulation of the transfer needs native ${symbol} for gas: required ${native(d.nativeRequiredWei)} = ` +
      `${d.nativeGasUnits!} gas x ${d.nativeMaxFeePerGasWei!} wei per gas, current server-wallet balance ${native(d.nativeCurrentWei)}. ` +
      "MetaMask reported a native gas shortfall, not a USDC one.",
    details: { ...read, provider_cause: "native_gas_below_required", native_symbol: symbol } };
  }
  if (reason === "mm_gasless_balance" && d.usdcCurrentAtomic !== undefined && d.usdcRequiredAtomic !== undefined) {
    const usdc = (atoms: string) => `${atoms} USDC atoms (${formatAtomic(atoms, 6)} USDC)`;
    return { message: `The MetaMask server wallet ${where} holds ${usdc(d.usdcCurrentAtomic)}, below the ${usdc(d.usdcRequiredAtomic)} ` +
      "this transfer plus MetaMask's quoted USDC relay fee needs (APN's own balanceOf read at the fee quote).",
    details: { chain_id: chainId, network } };
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
