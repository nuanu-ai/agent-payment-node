import { ApnError } from "../errors.js";
import { parsePublicHttpsUrl } from "../network-policy.js";
/** Canonical Multicall3 deployment; used only for read-only `eth_call` aggregation in `apn wallet portfolio`. */
export const MULTICALL3_ADDRESS = "0xcA11bde05977b3631167028862bE2a173976CA11";
/**
 * keccak256 of the runtime code returned by `eth_getCode(MULTICALL3_ADDRESS, "latest")`, observed on 2026-09-18
 * through each default endpoint below. Linea and Sei carry byte-identical code except the 32-byte solc IPFS
 * metadata hash, so their hash differs. A chain whose hash is null is read with one plain JSON-RPC batch array.
 */
const MULTICALL3_CODE = "0xd5c15df687b16f2ff992fc8d767b4216323184a2bbc6ee2f9c398c318e770891";
const MULTICALL3_CODE_ALTERNATE_METADATA = "0x8ec8aa5d07a37e47597b3a254f5cbf39fa2080526ae34db3a564fffed82b99ad";
const evm = (chainId, env, defaultEndpoint, multicall3CodeHash) => ({ chain: `eip155:${chainId}`, family: "evm", env, defaultEndpoint, evmChainId: chainId, multicall3CodeHash });
/** Read-only portfolio endpoints. Money-moving rails never consult this registry and keep owner-named RPC only. */
export const PORTFOLIO_NETWORK_RPC = Object.freeze([
    evm(1, "APN_ETHEREUM_RPC_URL", "https://ethereum-rpc.publicnode.com", MULTICALL3_CODE),
    evm(8453, "APN_BASE_RPC_URL", "https://mainnet.base.org", MULTICALL3_CODE),
    evm(42161, "APN_ARBITRUM_RPC_URL", "https://arb1.arbitrum.io/rpc", MULTICALL3_CODE),
    evm(10, "APN_OPTIMISM_RPC_URL", "https://mainnet.optimism.io", MULTICALL3_CODE),
    evm(137, "APN_POLYGON_RPC_URL", "https://polygon-bor-rpc.publicnode.com", MULTICALL3_CODE),
    evm(56, "APN_BNB_RPC_URL", "https://bsc-rpc.publicnode.com", MULTICALL3_CODE),
    evm(43114, "APN_AVALANCHE_RPC_URL", "https://api.avax.network/ext/bc/C/rpc", MULTICALL3_CODE),
    evm(130, "APN_UNICHAIN_RPC_URL", "https://mainnet.unichain.org", MULTICALL3_CODE),
    evm(59144, "APN_LINEA_RPC_URL", "https://rpc.linea.build", MULTICALL3_CODE_ALTERNATE_METADATA),
    evm(143, "APN_MONAD_RPC_URL", "https://rpc.monad.xyz", MULTICALL3_CODE),
    evm(1329, "APN_SEI_RPC_URL", "https://evm-rpc.sei-apis.com", MULTICALL3_CODE_ALTERNATE_METADATA),
    { chain: "tron:00000000000000001ebf88508a03865c71d452e25f4d51194196a1d22b6653dc", family: "tron", env: "APN_TRON_RPC_URL",
        defaultEndpoint: "https://api.trongrid.io", evmChainId: null, multicall3CodeHash: null },
    { chain: "solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d", family: "solana", env: "APN_SOLANA_RPC_URL",
        defaultEndpoint: "https://api.mainnet-beta.solana.com", evmChainId: null, multicall3CodeHash: null },
].map((row) => Object.freeze(row)));
export function portfolioNetworkRpc(chain) {
    return PORTFOLIO_NETWORK_RPC.find((row) => row.chain === chain);
}
/** An empty variable counts as unset; an invalid owner value is reported, never replaced by the default. */
export function portfolioEndpoint(chain, environment) {
    const row = portfolioNetworkRpc(chain);
    if (row === undefined)
        return { source: "not_configured", env: null };
    const value = environment[row.env];
    if (value === undefined || value.length === 0) {
        return { source: "default_public", env: row.env, url: portfolioUrl(row.family, row.defaultEndpoint), display: row.defaultEndpoint };
    }
    try {
        return { source: "env", env: row.env, url: portfolioUrl(row.family, value) };
    }
    catch {
        return { source: "invalid_env", env: row.env };
    }
}
function portfolioUrl(family, value) {
    const url = parsePublicHttpsUrl(value, "APN_RPC_CONFIG", "Portfolio RPC endpoint", 2048);
    // Solana and TRON keep their existing rule: no credentials in the query and no non-default port.
    if (family !== "evm" && (url.search !== "" || (url.port !== "" && url.port !== "443"))) {
        throw new ApnError("APN_RPC_CONFIG", "Solana and TRON portfolio RPC endpoints forbid query parameters and non-default ports.");
    }
    return url;
}
//# sourceMappingURL=registry.js.map