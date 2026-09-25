import { loadAllowlistInventory } from "./allowlist-inventory.js";
import { ApnError } from "./errors.js";
import { DIRECT_EVM_SUPPLEMENTAL_ASSETS } from "./evm-direct-supplemental-assets.js";
const network = (chainId, name, nativeSymbol, feeModel, finality) => ({ chainId, caip2: `eip155:${chainId}`, name, nativeSymbol, nativeDecimals: 18, feeModel, finality });
/**
 * The networks on which a local wallet may prepare a direct native or list-token transfer. It is deliberately separate
 * from `EVM_NETWORKS`, which x402, LI.FI, wallet policy and portfolio share: widening that list would enable those
 * rails too. Fee and finality behaviour was checked read-only against each mainnet on 2026-09-18 (docs/evm-assets.md).
 */
export const DIRECT_EVM_NETWORKS = [
    network(1, "Ethereum", "ETH", "eip1559", "inclusion"),
    network(8453, "Base", "ETH", "op-stack", "inclusion"),
    network(42161, "Arbitrum One", "ETH", "arbitrum-inclusive", "safe"),
    network(10, "OP Mainnet", "ETH", "op-stack", "inclusion"),
    network(137, "Polygon PoS", "POL", "eip1559", "inclusion"),
    network(56, "BNB Smart Chain", "BNB", "eip1559", "safe"),
    network(43114, "Avalanche C-Chain", "AVAX", "eip1559", "safe"),
    network(130, "Unichain", "ETH", "op-stack", "inclusion"),
    network(59144, "Linea", "ETH", "eip1559", "inclusion"),
    network(143, "Monad", "MON", "monad-gas-limit", "safe"),
    network(1329, "Sei EVM", "SEI", "eip1559", "safe"),
];
export function directEvmChain(value) {
    const selected = DIRECT_EVM_NETWORKS.find((entry) => value === entry.chainId || value === entry.caip2);
    if (selected === undefined)
        throw new ApnError("APN_INVALID_INPUT", "Select a direct-transfer EVM mainnet by its exact CAIP-2 identity.");
    return selected.chainId;
}
export function directEvmNetwork(chainId) {
    const selected = DIRECT_EVM_NETWORKS.find((entry) => entry.chainId === chainId);
    if (selected === undefined)
        throw new ApnError("APN_INVALID_INPUT", "The EVM network is not enabled for direct transfers.");
    return selected;
}
export function directEvmNetworkByCaip2(chain) {
    return DIRECT_EVM_NETWORKS.find((entry) => entry.caip2 === chain);
}
export function directEvmQuoteFeeModel(chainId) {
    const model = directEvmNetwork(chainId).feeModel;
    return model === "arbitrum-inclusive" || model === "monad-gas-limit" ? model : undefined;
}
export function directEvmRequiresSafeHead(chainId) {
    return directEvmNetwork(chainId).finality === "safe";
}
/**
 * Direct rows of one network: frozen native/token identities plus the three C1-12 direct-only token deployments.
 * The registry's native coin must agree with the frozen row, so a list revision cannot silently rename or re-scale it.
 */
export function directEvmListRows(chainId) {
    const selected = directEvmNetwork(chainId);
    const rows = loadAllowlistInventory().assets.filter((row) => row.chain === selected.caip2);
    const native = rows.filter((row) => row.kind === "native");
    if (native.length !== 1 || native[0]?.symbol !== selected.nativeSymbol || native[0].decimals !== selected.nativeDecimals ||
        rows.some((row) => row.family !== "evm")) {
        throw new ApnError("APN_STATE_CORRUPT", "The direct EVM network registry disagrees with the frozen allowlist.", { chain: selected.caip2 });
    }
    return [...rows, ...DIRECT_EVM_SUPPLEMENTAL_ASSETS.filter((row) => row.chain === selected.caip2)];
}
//# sourceMappingURL=evm-direct-networks.js.map