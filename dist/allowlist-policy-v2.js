import { canonicalJson, domainHash, exactKeys, isPlainRecord } from "./canonical.js";
import { ApnError } from "./errors.js";
import { loadAllowlistInventory, resolveAllowlistAsset, } from "./allowlist-inventory.js";
import { allowlistProfileHash, canonicalAllowlistAccount, isoInstant, validateAllowlistAdmission, } from "./allowlist-policy-overlay.js";
import { ASSET_POLICY_REGISTRY_SCHEMA_V2, sealAssetPolicyRegistry, } from "./asset-policy-registry.js";
import { stateCorrupt } from "./secure-state-store.js";
export const ALLOWLIST_POLICY_OVERLAY_SCHEMA_V2 = "apn.allowlist-policy-overlay.v2";
export const ALLOWLIST_POLICY_RECORD_SCHEMA_V2 = "apn.allowlist-policy-record.v2";
/** The owner-written file format accepted by `apn allowlist policy stage --file`. */
export const ALLOWLIST_POLICY_FILE_SCHEMA = "apn.allowlist-policy-file.v1";
const DIGEST = /^[a-f0-9]{64}$/u;
const VERSION = /^[a-z0-9][a-z0-9._-]{0,63}$/u;
const FAMILIES = ["evm", "solana", "tron"];
const MAX_ADMISSIONS = 256;
/**
 * Compile many owner admissions (assets x rails, across EVM, TRON and Solana) into one sealed per-rail-cap registry.
 * Admissions of one asset on several rails merge into one registry row; every cap is copied from the owner input.
 */
export function compileAllowlistPolicyOverlayV2(raw, inventory = loadAllowlistInventory()) {
    const value = overlayInput(raw, inventory);
    const body = { schemaVersion: ALLOWLIST_POLICY_OVERLAY_SCHEMA_V2, ...value, profileHash: allowlistProfileHash(value.profile) };
    const overlay = { ...body, overlayDigest: domainHash(ALLOWLIST_POLICY_OVERLAY_SCHEMA_V2, canonicalJson(body)) };
    const merged = new Map();
    for (const admission of overlay.admissions) {
        const asset = resolveAllowlistAsset(admission, inventory);
        const key = `${asset.chain}\0${asset.kind}\0${asset.identifier ?? ""}`;
        const row = merged.get(key) ?? { asset, rails: { direct: false, gasless: false, x402: false, bridge: false, swap: false },
            railCaps: {}, pins: {} };
        row.rails[admission.rail] = true;
        row.railCaps[admission.rail] = { maximumPerTransferAtomic: admission.maximumPerTransferAtomic, dailyLimitAtomic: admission.dailyLimitAtomic };
        if (admission.mechanism !== undefined)
            row.pins[admission.rail] = admission.mechanism;
        merged.set(key, row);
    }
    const chains = new Map();
    for (const row of merged.values()) {
        const asset = {
            kind: row.asset.kind, identifier: row.asset.identifier, symbol: row.asset.symbol, decimals: row.asset.decimals,
            rails: row.rails, railCaps: row.railCaps,
            ...(Object.keys(row.pins).length === 0 ? {} : { mechanismPins: row.pins }),
        };
        const current = chains.get(row.asset.chain);
        chains.set(row.asset.chain, current === undefined
            ? { chain: row.asset.chain, family: row.asset.family, name: row.asset.networkName, assets: [asset] }
            : { ...current, assets: [...current.assets, asset] });
    }
    return { overlay, registry: sealAssetPolicyRegistry({
            schemaVersion: ASSET_POLICY_REGISTRY_SCHEMA_V2,
            registryVersion: overlay.overlayVersion,
            publishedAt: overlay.effectiveAt,
            effectiveDate: overlay.effectiveAt.slice(0, 10),
            effectiveAt: overlay.effectiveAt,
            ...(overlay.expiresAt === undefined ? {} : { expiresAt: overlay.expiresAt }),
            // Code-unit order, never locale collation: the sealed bytes must recompile identically under any locale.
            chains: [...chains.values()].sort((left, right) => codeUnitOrder(left.chain, right.chain)).map((chain) => ({
                ...chain,
                assets: [...chain.assets].sort((left, right) => codeUnitOrder(`${left.kind}:${left.identifier ?? ""}`, `${right.kind}:${right.identifier ?? ""}`)),
            })),
        }) };
}
/** Parse the owner-written policy file. Every cap, account, instant and pin must be present; nothing is filled in. */
export function parseAllowlistPolicyFile(value) {
    if (!isPlainRecord(value) || !exactKeys(value, ["schemaVersion", "overlayVersion", "accounts", "effectiveAt",
        ...(value.expiresAt === undefined ? [] : ["expiresAt"]), "admissions"]) || value.schemaVersion !== ALLOWLIST_POLICY_FILE_SCHEMA) {
        invalid(`The policy file must be one ${ALLOWLIST_POLICY_FILE_SCHEMA} object with exactly overlayVersion, accounts, effectiveAt, optional expiresAt and admissions.`, "invalid_policy_file");
    }
    return value;
}
export function validateAllowlistPolicyRecordV2(value) {
    if (!isPlainRecord(value) || !exactKeys(value, [
        "schemaVersion", "revision", "status", "preparedAt", "overlay", "registry", "recordDigest",
    ]) || value.schemaVersion !== ALLOWLIST_POLICY_RECORD_SCHEMA_V2 || value.status !== "staged_unadmitted" ||
        typeof value.revision !== "number" || !Number.isSafeInteger(value.revision) || value.revision < 1 ||
        typeof value.preparedAt !== "string" || !isoInstant(value.preparedAt) || typeof value.recordDigest !== "string" ||
        !DIGEST.test(value.recordDigest))
        corrupt("Allowlist policy record schema is invalid.");
    const { recordDigest, ...body } = value;
    if (domainHash(ALLOWLIST_POLICY_RECORD_SCHEMA_V2, canonicalJson(body)) !== recordDigest) {
        corrupt("Allowlist policy record integrity validation failed.");
    }
    const overlay = value.overlay;
    if (!isPlainRecord(overlay) || overlay.schemaVersion !== ALLOWLIST_POLICY_OVERLAY_SCHEMA_V2)
        corrupt("Allowlist policy overlay schema is invalid.");
    const { schemaVersion: _schema, profileHash: _profileHash, overlayDigest: _digest, ...input } = overlay;
    let compiled;
    try {
        compiled = compileAllowlistPolicyOverlayV2(input);
    }
    catch {
        return corrupt("Allowlist policy record no longer compiles against the frozen inventory.");
    }
    if (canonicalJson(compiled.overlay) !== canonicalJson(overlay) || canonicalJson(compiled.registry) !== canonicalJson(value.registry)) {
        corrupt("Allowlist policy record does not match its frozen inventory compilation.");
    }
    return value;
}
export function sealAllowlistPolicyRecordV2(body) {
    return validateAllowlistPolicyRecordV2({ ...body, recordDigest: domainHash(ALLOWLIST_POLICY_RECORD_SCHEMA_V2, canonicalJson(body)) });
}
function overlayInput(value, inventory) {
    if (!isPlainRecord(value) || !exactKeys(value, [
        "overlayVersion", "profile", "accounts", "datasetVersion", "datasetSha256", "inventorySha256", "effectiveAt",
        ...(value.expiresAt === undefined ? [] : ["expiresAt"]), "admissions",
    ]) || typeof value.overlayVersion !== "string" || !VERSION.test(value.overlayVersion) || typeof value.profile !== "string" ||
        value.datasetVersion !== inventory.dataset.version || value.datasetSha256 !== inventory.dataset.sha256 ||
        value.inventorySha256 !== inventory.inventorySha256 || typeof value.effectiveAt !== "string" || !isoInstant(value.effectiveAt) ||
        (value.expiresAt !== undefined && (typeof value.expiresAt !== "string" || !isoInstant(value.expiresAt) || value.expiresAt <= value.effectiveAt)) ||
        !Array.isArray(value.admissions) || value.admissions.length === 0 || value.admissions.length > MAX_ADMISSIONS) {
        invalid("Allowlist policy overlay metadata is invalid.", "invalid_overlay");
    }
    allowlistProfileHash(value.profile);
    const admissions = value.admissions.map(validateAllowlistAdmission);
    const identities = new Set();
    const families = new Set();
    for (const row of admissions) {
        const asset = resolveAllowlistAsset(row, inventory);
        families.add(asset.family);
        const identity = `${asset.chain}\0${asset.kind}\0${asset.identifier ?? ""}\0${row.rail}`;
        if (identities.has(identity))
            invalid("Allowlist policy contains a duplicate admission row.", "duplicate_admission");
        identities.add(identity);
        if (row.rail === "swap" && (row.mechanism === undefined || !("chain" in row.mechanism) || row.mechanism.chain !== asset.chain)) {
            invalid("A swap admission must pin a swap mechanism for its exact network.", "swap_mechanism_chain_mismatch");
        }
    }
    const accounts = value.accounts;
    const used = FAMILIES.filter((family) => families.has(family));
    if (!isPlainRecord(accounts) || !exactKeys(accounts, used)) {
        invalid("Owner accounts must name exactly one account for each admitted family.", "account_families_mismatch");
    }
    for (const family of used)
        canonicalAllowlistAccount(family, accounts[family]);
    return { ...value, accounts: Object.fromEntries(used.map((family) => [family, accounts[family]])), admissions };
}
function codeUnitOrder(left, right) { return left < right ? -1 : left > right ? 1 : 0; }
function invalid(message, reason) {
    throw new ApnError("APN_INVALID_INPUT", message, { reason });
}
function corrupt(message) { return stateCorrupt(message); }
//# sourceMappingURL=allowlist-policy-v2.js.map