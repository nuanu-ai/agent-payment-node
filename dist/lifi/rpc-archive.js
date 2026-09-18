import { parsePublicHttpsUrl } from "../network-policy.js";
import { bridgeFailure } from "./validation.js";
/**
 * Owner-named archive endpoints. Public full nodes prune historical state, so re-verifying an older bridge operation's
 * frozen deployment identity or L1 fee inputs at its own block needs an archive-capable reader. The operation stays bound
 * to its original RPC origin; only state reads pinned to one explicit block go to this endpoint, and only when the owner
 * names it for that chain. Nothing is inferred or defaulted.
 */
export const BRIDGE_ARCHIVE_RPC_ENV = {
    1: "APN_ETHEREUM_ARCHIVE_RPC_URL",
    8453: "APN_BASE_ARCHIVE_RPC_URL",
    42161: "APN_ARBITRUM_ARCHIVE_RPC_URL",
};
const TAG_INDEX = { eth_getCode: 1, eth_getStorageAt: 2, eth_call: 1 };
export function bridgeArchiveEndpoint(chainId, environment) {
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
        typeof tag.blockHash === "string";
}
//# sourceMappingURL=rpc-archive.js.map