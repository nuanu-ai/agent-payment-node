import { ApnError } from "../../errors.js";
import { directEvmNetwork } from "../../evm-direct-networks.js";
import { formatAtomic } from "../../money.js";
import { mmUsdcShortfallMessage } from "../refusals.js";
import { mmSentinelQuoteEndpoint, MM_PROJECT_WALLETS_ENDPOINT, MM_SENTINEL_NETWORKS_ENDPOINT, MM_SERVER_WALLET_NETWORKS_ENDPOINT } from "./provider-endpoints.js";
/** Parent side only: restate a classified read failure as the provider's answer when it is one. */
export function withMetaMaskProviderRefusal(error, d, chainId, binding) {
    const reason = error.details?.reason;
    const refusal = typeof reason === "string" ? metaMaskProviderRefusal(reason, d, chainId, binding) : undefined;
    return refusal === undefined ? error : new ApnError(error.code, refusal.message, { ...error.details, ...refusal.details });
}
/**
 * A provider answer, not an APN fault, stated as exactly what MetaMask said: which provider read, which network and
 * which field. Only closed facts, proven numbers and APN's own constants appear; no provider text crosses the helper
 * boundary. A missing relay fee is never read as a USDC shortfall: the cause is named only when the answer's own
 * numbers prove it, or APN's own balance read does.
 */
export function metaMaskProviderRefusal(reason, d, chainId, binding) {
    if (chainId === undefined)
        return undefined;
    if ((reason === "mm_gasless_project_has_no_wallets" || reason === "mm_gasless_wallet_not_in_project") && binding !== undefined &&
        d.stage === "project_wallets")
        return projectWalletRefusal(reason, d, binding);
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
        const symbol = directEvmNetwork(chainId).nativeSymbol, native = (wei) => `${wei} wei (${formatAtomic(wei, 18)} ${symbol})`;
        return { message: `${answer}. Its simulation of the transfer needs native ${symbol} for gas: required ${native(d.nativeRequiredWei)} = ` +
                `${d.nativeGasUnits} gas x ${d.nativeMaxFeePerGasWei} wei per gas, current server-wallet balance ${native(d.nativeCurrentWei)}. ` +
                "MetaMask reported a native gas shortfall, not a USDC one.",
            details: { ...read, provider_cause: "native_gas_below_required", native_symbol: symbol } };
    }
    if (reason === "mm_gasless_balance" && d.usdcCurrentAtomic !== undefined && d.usdcRequiredAtomic !== undefined) {
        return { message: mmUsdcShortfallMessage(chainId, d.usdcCurrentAtomic, d.usdcRequiredAtomic, "at the fee quote"),
            details: { chain_id: chainId, network, usdc_current_atomic: d.usdcCurrentAtomic, usdc_required_atomic: d.usdcRequiredAtomic } };
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
/**
 * The login's project, as MetaMask's own wallet list states it: no server wallet, or EVM server wallets that do not
 * include the profile's. Only their count is named; the project id and every other address stay out. The bound
 * address and the profile revision it was quoted under travel with the refusal for its next actions.
 */
function projectWalletRefusal(reason, d, binding) {
    const owner = binding.address;
    const count = d.projectWalletCount, read = `MetaMask's project wallet list (${MM_PROJECT_WALLETS_ENDPOINT})`;
    const answer = reason === "mm_gasless_project_has_no_wallets"
        ? `has no server wallet, so it does not hold the connected wallet ${owner}: ${read} names no EVM server wallet`
        : `does not hold the connected wallet ${owner}: ${read} names ${count === undefined ? "only other"
            : `${count} other`} EVM server wallet${count === 1 ? "" : "s"}`;
    return { message: `The MetaMask login in mm belongs to a project that ${answer}. Nothing was signed or sent.`,
        details: { provider_read: "metamask project wallet list", provider_endpoint: MM_PROJECT_WALLETS_ENDPOINT, wallet_address: owner,
            profile_revision: binding.revision } };
}
//# sourceMappingURL=provider-refusal.js.map