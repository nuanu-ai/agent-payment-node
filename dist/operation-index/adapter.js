import { isAddress } from "viem";
import { bridgeConflictDomain, conflictDomainKey, evmConflictDomain, railConflictDomain, SOLANA_BRIDGE_CHAIN_ID } from "../operation-conflict-domain.js";
export const RECORD_NAME = /^[a-f0-9]{64}\.json$/u;
export const STATE_HASH = /^[a-f0-9]{64}$/u;
/** `<directory>[/<profileHash>]/<operationId>.json`, split back into its parts; null for any other shape. */
export function parseRecordPath(recordPath) {
    const parts = recordPath.split("/");
    const name = parts.at(-1) ?? "";
    if (!RECORD_NAME.test(name) || parts.length < 2 || parts.length > 3)
        return null;
    const profileHash = parts.length === 3 ? parts[1] : null;
    if (profileHash !== null && !STATE_HASH.test(profileHash))
        return null;
    return { directory: parts[0], profileHash, operationId: name.slice(0, -".json".length) };
}
export function requiredRecordPath(recordPath, store) {
    const parsed = parseRecordPath(recordPath);
    if (parsed === null || parsed.directory !== store.directory || (parsed.profileHash !== null) !== store.perProfile) {
        throw new Error("Operation record path does not name this store.");
    }
    return parsed;
}
export function domainClaims(domains) {
    return domains.map(domain => domain.shared === true ? { key: conflictDomainKey(domain), shared: true } : { key: conflictDomainKey(domain) });
}
/** Unreadable account fields yield null, exactly as `storedOperationDomains` reported them. */
export function readableClaims(claims) {
    try {
        return claims();
    }
    catch {
        return null;
    }
}
export function field(value, ...path) {
    let current = value;
    for (const key of path) {
        if (current === null || typeof current !== "object" || Array.isArray(current) || !Object.hasOwn(current, key))
            return undefined;
        current = current[key];
    }
    return current;
}
function doubtful() { throw new Error("Salvaged field is not canonical."); }
const canonicalChain = (chainId) => (typeof chainId === "number" && Number.isSafeInteger(chainId) && chainId > 0) ||
    (typeof chainId === "string" && /^[1-9][0-9]{0,15}$/u.test(chainId)) ? chainId : doubtful();
/** Salvage accepts only a lowercase or correctly checksummed EVM address. */
export function salvageEvm(chainId, account, shared = false) {
    if (typeof account !== "string" || !isAddress(account, { strict: true }))
        doubtful();
    const key = conflictDomainKey(evmConflictDomain(canonicalChain(chainId), account));
    return shared ? { key, shared: true } : { key };
}
const SOLANA_ADDRESS = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/u, TRON_ADDRESS = /^T[1-9A-HJ-NP-Za-km-z]{33}$/u;
export function salvageRail(rail, account) {
    const pattern = rail === "solana" ? SOLANA_ADDRESS : rail === "tron" ? TRON_ADDRESS : null;
    if (pattern === null || typeof account !== "string" || !pattern.test(account))
        doubtful();
    return { key: conflictDomainKey(railConflictDomain(rail, account)) };
}
export function salvageBridge(chainId, account) {
    if (String(chainId) !== SOLANA_BRIDGE_CHAIN_ID)
        return salvageEvm(chainId, account);
    if (typeof account !== "string" || !SOLANA_ADDRESS.test(account))
        doubtful();
    return { key: conflictDomainKey(bridgeConflictDomain(SOLANA_BRIDGE_CHAIN_ID, account)) };
}
export function salvageHash(value) {
    return typeof value === "string" && STATE_HASH.test(value) ? value : doubtful();
}
/** Identity fields plus the family's account extraction; any doubtful account field makes the claims unknown. */
export function salvageRecord(raw, extract, profileFields = ["profileHash"]) {
    const profileHashes = [...new Set(profileFields.map(name => field(raw, name))
            .filter((value) => typeof value === "string" && STATE_HASH.test(value)))];
    const idempotency = field(raw, "idempotencyHash");
    let claims = null;
    try {
        claims = extract(raw);
    }
    catch {
        claims = null;
    }
    return { profileHashes, idempotencyHash: typeof idempotency === "string" && STATE_HASH.test(idempotency) ? idempotency : null, claims };
}
/** Every covered record carries these identity fields under the same names. */
export function standardIdentity(record) {
    return { profileHash: record.profileHash, operationId: record.operationId, idempotencyHash: record.idempotencyHash, requestHash: record.requestHash };
}
//# sourceMappingURL=adapter.js.map