import { sha256 } from "../../canonical.js";
import { ApnError } from "../../errors.js";
import { parsePublicHttpsUrl } from "../../network-policy.js";
import { rpcEndpointIdentity, rpcProviderFamily } from "../../lifi/rpc-session.js";
export const TOKEN_PRIMARY_POOL_ENV = "APN_UNISWAP_TOKEN_PRIMARY_RPC_URLS";
export const TOKEN_PRIMARY_POOL_MAX = 3;
export function tokenPrimaryCandidates(environment) {
    const configured = environment[TOKEN_PRIMARY_POOL_ENV];
    const values = configured === undefined || configured === "" ? scalar(environment) : array(configured);
    const endpoints = values.map((value) => endpoint(value));
    const identities = new Set(), families = new Set();
    for (const candidate of endpoints) {
        const identity = rpcEndpointIdentity(candidate.toString()), family = rpcProviderFamily(candidate.toString());
        if (identities.has(identity) || families.has(family))
            invalid("duplicate_primary_provider");
        identities.add(identity);
        families.add(family);
    }
    const archiveValue = environment.APN_ETHEREUM_ARCHIVE_RPC_URL;
    if (archiveValue !== undefined && archiveValue !== "") {
        const archive = endpoint(archiveValue);
        if (endpoints.some((candidate) => candidate.origin === archive.origin))
            invalid("archive_primary_not_distinct");
    }
    return endpoints.map((url) => ({ url, id: sha256(`apn.uniswap-token-primary-provider.v1\0${url.toString()}`),
        familyHash: sha256(`rpc-provider-family\0${rpcProviderFamily(url.toString())}`) }));
}
function scalar(environment) {
    const value = environment.APN_ETHEREUM_RPC_URL;
    if (value === undefined || value === "")
        throw new ApnError("APN_RPC_CONFIG", "Uniswap token RPC requires an Ethereum primary endpoint.", { reason: "missing_APN_ETHEREUM_RPC_URL" });
    return [value];
}
function array(raw) {
    if (Buffer.byteLength(raw, "utf8") > 8_192)
        invalid("primary_pool_size");
    let value;
    try {
        value = JSON.parse(raw);
    }
    catch {
        return invalid("primary_pool_json");
    }
    if (!Array.isArray(value) || value.length < 1 || value.length > TOKEN_PRIMARY_POOL_MAX ||
        value.some((item) => typeof item !== "string" || item.length === 0))
        invalid("primary_pool_shape");
    return value;
}
function endpoint(value) {
    const parsed = parsePublicHttpsUrl(value, "APN_RPC_CONFIG", "Uniswap token primary RPC endpoint", 2_048);
    if (parsed.search !== "" || parsed.hash !== "")
        invalid("primary_RPC_query_forbidden");
    return parsed;
}
function invalid(reason) {
    throw new ApnError("APN_RPC_CONFIG", "Uniswap token primary RPC pool configuration is invalid.", { reason });
}
//# sourceMappingURL=token-rpc-pool.js.map