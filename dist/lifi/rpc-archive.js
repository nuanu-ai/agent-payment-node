import { parsePublicHttpsUrl } from "../network-policy.js";
import { bridgeChain } from "./asset-registry.js";
import { bridgeFailure } from "./validation.js";
/**
 * Owner-named archive endpoints. Public full nodes prune historical state, so re-verifying an older bridge operation's
 * frozen deployment identity, L1 fee inputs, or transaction receipt needs an archive-capable reader. The operation stays
 * bound to its original RPC origin; only state reads pinned to one explicit block and exact-hash receipt reads go to this
 * endpoint, and only when the owner names it for that chain. Nothing is inferred or defaulted.
 */
export const BRIDGE_ARCHIVE_RPC_ENV = {
    1: "APN_ETHEREUM_ARCHIVE_RPC_URL",
    56: "APN_BNB_ARCHIVE_RPC_URL",
    143: "APN_MONAD_ARCHIVE_RPC_URL",
    8453: "APN_BASE_ARCHIVE_RPC_URL",
    42161: "APN_ARBITRUM_ARCHIVE_RPC_URL",
    59144: "APN_LINEA_ARCHIVE_RPC_URL",
};
const TAG_INDEX = { eth_getCode: 1, eth_getStorageAt: 2, eth_call: 1 };
export function bridgeArchiveEndpoint(chainId, environment) {
    bridgeChain(chainId, "APN_RPC_CONFIG");
    const name = BRIDGE_ARCHIVE_RPC_ENV[chainId];
    const value = environment[name];
    if (value === undefined || value.length === 0)
        return null;
    const endpoint = parsePublicHttpsUrl(value, "APN_RPC_CONFIG", "Bridge archive RPC endpoint", 2048);
    if (endpoint.search !== "")
        bridgeFailure("APN_RPC_CONFIG", "bridge_archive_RPC_query_forbidden");
    return endpoint;
}
/** A state read pinned to one block number or block hash. Moving tags (latest, safe, finalized, pending) never qualify. */
export function isHistoricalStateRead(method, params) {
    const index = TAG_INDEX[method];
    if (index === undefined || params.length !== index + 1)
        return false;
    const tag = params[index];
    if (typeof tag === "string")
        return /^0x(?:0|[1-9a-f][0-9a-f]*)$/u.test(tag);
    return typeof tag === "object" && tag !== null && !Array.isArray(tag) &&
        isBlockHash(tag.blockHash);
}
/** The complete archive surface: exact block-pinned state plus a receipt addressed by one exact transaction hash. */
export function isArchiveRead(method, params) {
    return isHistoricalStateRead(method, params) ||
        (method === "eth_getTransactionReceipt" && params.length === 1 && isBlockHash(params[0]));
}
function isBlockHash(value) { return typeof value === "string" && /^0x[0-9a-fA-F]{64}$/u.test(value); }
//# sourceMappingURL=rpc-archive.js.map