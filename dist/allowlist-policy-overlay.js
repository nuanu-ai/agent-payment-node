import { address as solanaAddress } from "@solana/kit";
import { getAddress } from "viem";
import { canonicalJson, domainHash, exactKeys, isPlainRecord } from "./canonical.js";
import { ApnError } from "./errors.js";
import { ALLOWLIST_DATASET_SCHEMA, loadAllowlistInventory, resolveAllowlistAsset, } from "./allowlist-inventory.js";
import { sealAssetPolicyRegistry, } from "./asset-policy-registry.js";
import { parseAtomic } from "./money.js";
import { SecureStateStore, stateCorrupt } from "./secure-state-store.js";
import { tronAddress } from "./tron/codec.js";
export const ALLOWLIST_POLICY_OVERLAY_SCHEMA = "apn.allowlist-policy-overlay.v1";
export const ALLOWLIST_POLICY_RECORD_SCHEMA = "apn.allowlist-policy-record.v1";
const MAX_UINT256 = (1n << 256n) - 1n;
const DIGEST = /^[a-f0-9]{64}$/u;
const PROFILE = /^[a-z0-9][a-z0-9._-]{0,63}$/u;
const VERSION = /^[a-z0-9][a-z0-9._-]{0,63}$/u;
const PIN = /^[A-Za-z0-9][A-Za-z0-9._:/@+-]{0,255}$/u;
export function compileAllowlistPolicyOverlay(raw, inventory = loadAllowlistInventory()) {
    const value = overlayInput(raw, inventory);
    const profileHash = domainHash(ALLOWLIST_POLICY_OVERLAY_SCHEMA, `profile\0${value.profile}`);
    const body = { schemaVersion: ALLOWLIST_POLICY_OVERLAY_SCHEMA, ...value, profileHash };
    const overlay = {
        ...body,
        overlayDigest: domainHash(ALLOWLIST_POLICY_OVERLAY_SCHEMA, canonicalJson(body)),
    };
    const chains = new Map();
    for (const admission of overlay.admissions) {
        const asset = resolveAllowlistAsset(admission, inventory);
        const rails = { direct: admission.rail === "direct", gasless: admission.rail === "gasless",
            x402: admission.rail === "x402", bridge: admission.rail === "bridge", swap: false };
        const row = {
            kind: asset.kind,
            identifier: asset.identifier,
            symbol: asset.symbol,
            decimals: asset.decimals,
            rails,
            caps: {
                maximumPerTransferAtomic: admission.maximumPerTransferAtomic,
                dailyLimitAtomic: admission.dailyLimitAtomic,
            },
            ...(admission.mechanism === undefined ? {} : { mechanismPins: { [admission.rail]: admission.mechanism } }),
        };
        const current = chains.get(asset.chain);
        if (current === undefined) {
            chains.set(asset.chain, { chain: asset.chain, family: asset.family, name: asset.networkName, assets: [row] });
        }
        else {
            chains.set(asset.chain, { ...current, assets: [...current.assets, row] });
        }
    }
    const unsigned = {
        schemaVersion: "apn.asset-policy-registry.v1",
        registryVersion: overlay.overlayVersion,
        publishedAt: overlay.effectiveAt,
        effectiveDate: overlay.effectiveAt.slice(0, 10),
        effectiveAt: overlay.effectiveAt,
        ...(overlay.expiresAt === undefined ? {} : { expiresAt: overlay.expiresAt }),
        chains: [...chains.values()].sort((left, right) => left.chain.localeCompare(right.chain)).map((chain) => ({
            ...chain,
            assets: [...chain.assets].sort((left, right) => `${left.kind}:${left.identifier ?? ""}`.localeCompare(`${right.kind}:${right.identifier ?? ""}`)),
        })),
    };
    return { overlay, registry: sealAssetPolicyRegistry(unsigned) };
}
export function validateAllowlistPolicyRecord(value) {
    if (!isPlainRecord(value) || !exactKeys(value, [
        "schemaVersion", "revision", "status", "preparedAt", "overlay", "registry", "recordDigest",
    ]) || value.schemaVersion !== ALLOWLIST_POLICY_RECORD_SCHEMA || value.status !== "staged_unadmitted" ||
        typeof value.revision !== "number" || !Number.isSafeInteger(value.revision) || value.revision < 1 ||
        typeof value.preparedAt !== "string" || !isoInstant(value.preparedAt) || typeof value.recordDigest !== "string" ||
        !DIGEST.test(value.recordDigest))
        corrupt("Allowlist policy record schema is invalid.");
    const { recordDigest, ...body } = value;
    if (domainHash(ALLOWLIST_POLICY_RECORD_SCHEMA, canonicalJson(body)) !== recordDigest) {
        corrupt("Allowlist policy record integrity validation failed.");
    }
    const compiled = compileAllowlistPolicyOverlay(overlayBody(value.overlay));
    if (canonicalJson(compiled.overlay) !== canonicalJson(value.overlay) ||
        canonicalJson(compiled.registry) !== canonicalJson(value.registry)) {
        corrupt("Allowlist policy record does not match its frozen inventory compilation.");
    }
    return value;
}
export class AllowlistPolicyStore extends SecureStateStore {
    initialized;
    async prepare(input) {
        const { expectedRevision, now, ...overlayInputValue } = input;
        const compiled = compileAllowlistPolicyOverlay(overlayInputValue);
        const preparedAt = instant(now, "Preparation time");
        await this.ready();
        return await this.withLocks([`profile:${compiled.overlay.profileHash}`], async () => {
            const current = await this.latest(compiled.overlay.profileHash);
            if (current === null) {
                if (expectedRevision !== undefined)
                    conflict("The initial allowlist policy must omit expected revision.");
            }
            else if (expectedRevision === undefined || expectedRevision !== current.revision) {
                conflict("Allowlist policy expected revision does not match durable state.");
            }
            const revision = (current?.revision ?? 0) + 1;
            const body = { schemaVersion: ALLOWLIST_POLICY_RECORD_SCHEMA, revision, status: "staged_unadmitted",
                preparedAt, overlay: compiled.overlay, registry: compiled.registry };
            const record = { ...body,
                recordDigest: domainHash(ALLOWLIST_POLICY_RECORD_SCHEMA, canonicalJson(body)) };
            await this.ensureDirectory(`allowlist-policies/${compiled.overlay.profileHash}`);
            await this.writeJson(this.path(compiled.overlay.profileHash, revision), record, true);
            return record;
        });
    }
    async status(profile) {
        if (!PROFILE.test(profile))
            invalid("Allowlist policy profile is invalid.", "invalid_profile");
        await this.ready();
        return await this.latest(domainHash(ALLOWLIST_POLICY_OVERLAY_SCHEMA, `profile\0${profile}`));
    }
    async latest(profileHash) {
        const entries = await this.readDirectory(`allowlist-policies/${profileHash}`);
        let latest = null;
        for (const entry of entries) {
            if (!entry.isFile() || entry.isSymbolicLink() || !/^v[0-9]{8}\.json$/u.test(entry.name)) {
                corrupt("Allowlist policy directory contains an unsafe entry.");
            }
            const value = await this.readJson(`allowlist-policies/${profileHash}/${entry.name}`);
            if (value === null)
                corrupt("Allowlist policy version disappeared during validation.");
            const record = validateAllowlistPolicyRecord(value);
            if (record.overlay.profileHash !== profileHash || entry.name !== `v${String(record.revision).padStart(8, "0")}.json`) {
                corrupt("Allowlist policy path binding is invalid.");
            }
            if (latest === null || record.revision > latest.revision)
                latest = record;
        }
        return latest;
    }
    path(profileHash, revision) {
        return `allowlist-policies/${profileHash}/v${String(revision).padStart(8, "0")}.json`;
    }
    async ready() {
        this.initialized ??= (async () => { await this.initialize(); await this.ensureDirectory("allowlist-policies"); })();
        await this.initialized;
    }
}
export async function executeAllowlistPolicyCommand(request, stateRoot, now) {
    const store = new AllowlistPolicyStore(stateRoot);
    if (request.command === "allowlist.policy.status") {
        const record = await store.status(request.profile);
        return record ?? { configured: false, status: "not_present", profile: request.profile, activation: "not_available" };
    }
    if ((request.mechanismProvider === undefined) !== (request.mechanismReference === undefined)) {
        invalid("Pinned mechanism provider and reference must be supplied together.", "invalid_mechanism");
    }
    const inventory = loadAllowlistInventory();
    return await store.prepare({ overlayVersion: request.overlayVersion, profile: request.profile, account: request.account,
        datasetVersion: inventory.dataset.version, datasetSha256: inventory.dataset.sha256,
        inventorySha256: inventory.inventorySha256, effectiveAt: request.effectiveAt,
        ...(request.expiresAt === undefined ? {} : { expiresAt: request.expiresAt }),
        admissions: [{ chain: request.chain, kind: request.kind,
                ...(request.identifier === undefined ? {} : { identifier: request.identifier }), rail: request.rail,
                maximumPerTransferAtomic: request.maximumPerTransferAtomic, dailyLimitAtomic: request.dailyLimitAtomic,
                ...(request.mechanismProvider === undefined ? {} : { mechanism: {
                        provider: request.mechanismProvider, reference: request.mechanismReference,
                    } }) }],
        ...(request.expectedRevision === undefined ? {} : { expectedRevision: request.expectedRevision }), now });
}
function overlayInput(value, inventory) {
    if (!isPlainRecord(value) || !exactKeys(value, [
        "overlayVersion", "profile", "account", "datasetVersion", "datasetSha256", "inventorySha256", "effectiveAt",
        ...(value.expiresAt === undefined ? [] : ["expiresAt"]), "admissions",
    ]) || typeof value.overlayVersion !== "string" || !VERSION.test(value.overlayVersion) ||
        typeof value.profile !== "string" || !PROFILE.test(value.profile) || typeof value.account !== "string" ||
        value.datasetVersion !== inventory.dataset.version || value.datasetSha256 !== inventory.dataset.sha256 ||
        value.inventorySha256 !== inventory.inventorySha256 || typeof value.effectiveAt !== "string" || !isoInstant(value.effectiveAt) ||
        (value.expiresAt !== undefined && (typeof value.expiresAt !== "string" || !isoInstant(value.expiresAt) || value.expiresAt <= value.effectiveAt)) ||
        !Array.isArray(value.admissions) || value.admissions.length === 0 || value.admissions.length > 256) {
        invalid("Allowlist policy overlay metadata is invalid.", "invalid_overlay");
    }
    const admissions = value.admissions.map(admission);
    const identities = new Set();
    let family;
    for (const row of admissions) {
        const asset = resolveAllowlistAsset(row, inventory);
        if (family === undefined)
            family = asset.family;
        if (asset.family !== family)
            invalid("One overlay cannot widen across account families.", "family_widening");
        const identity = `${asset.chain}\0${asset.kind}\0${asset.identifier ?? ""}\0${row.rail}`;
        if (identities.has(identity))
            invalid("Allowlist policy contains a duplicate admission row.", "duplicate_admission");
        identities.add(identity);
    }
    canonicalAccount(family, value.account);
    return { ...value, admissions };
}
function admission(value) {
    if (!isPlainRecord(value) || !exactKeys(value, [
        "chain", "kind", ...(value.identifier === undefined ? [] : ["identifier"]), "rail", "maximumPerTransferAtomic",
        "dailyLimitAtomic", ...(value.mechanism === undefined ? [] : ["mechanism"]),
    ]) || typeof value.chain !== "string" || (value.kind !== "native" && value.kind !== "token") ||
        (value.identifier !== undefined && typeof value.identifier !== "string") ||
        (value.rail !== "direct" && value.rail !== "gasless" && value.rail !== "x402" && value.rail !== "bridge" && value.rail !== "swap")) {
        invalid("Allowlist admission row is invalid.", "invalid_admission");
    }
    if (value.rail === "swap")
        invalid("Swap admission belongs to Card3 and is unavailable here.", "swap_not_supported");
    const maximum = positiveAtomic(value.maximumPerTransferAtomic, "maximum_per_transfer");
    const daily = positiveAtomic(value.dailyLimitAtomic, "daily_limit");
    if (BigInt(maximum) > BigInt(daily))
        invalid("Per-transfer cap cannot exceed daily cap.", "cap_order");
    const mechanism = mechanismPin(value.mechanism);
    if (value.rail !== "direct" && mechanism === undefined) {
        invalid("The selected rail requires a nonempty pinned provider mechanism.", "mechanism_required");
    }
    if (value.rail === "direct" && mechanism !== undefined) {
        invalid("Direct admission does not accept provider mechanism metadata.", "mechanism_not_applicable");
    }
    return { chain: value.chain, kind: value.kind, ...(value.identifier === undefined ? {} : { identifier: value.identifier }),
        rail: value.rail, maximumPerTransferAtomic: maximum, dailyLimitAtomic: daily,
        ...(mechanism === undefined ? {} : { mechanism }) };
}
function mechanismPin(value) {
    if (value === undefined)
        return undefined;
    if (!isPlainRecord(value) || !exactKeys(value, ["provider", "reference"]) || typeof value.provider !== "string" ||
        typeof value.reference !== "string" || !PIN.test(value.provider) || !PIN.test(value.reference)) {
        invalid("Pinned mechanism metadata is invalid.", "invalid_mechanism");
    }
    return value;
}
function overlayBody(value) {
    if (!isPlainRecord(value) || value.schemaVersion !== ALLOWLIST_POLICY_OVERLAY_SCHEMA || typeof value.overlayDigest !== "string" ||
        typeof value.profileHash !== "string")
        corrupt("Allowlist policy overlay schema is invalid.");
    const { schemaVersion: _schema, profileHash: _profileHash, overlayDigest: _digest, ...body } = value;
    return body;
}
function positiveAtomic(value, field) {
    try {
        if (typeof value !== "string" || value.length > 78)
            throw new Error("bounded");
        const parsed = parseAtomic(value, { positive: true });
        if (parsed > MAX_UINT256)
            throw new Error("uint256");
        return parsed.toString();
    }
    catch {
        return invalid("Atomic caps must be positive canonical uint256 values.", field);
    }
}
function canonicalAccount(family, value) {
    try {
        if (family === "evm") {
            const result = getAddress(value);
            if (result !== value || result === "0x0000000000000000000000000000000000000000")
                throw new Error("account");
            return result;
        }
        if (family === "solana")
            return solanaAddress(value);
        const result = tronAddress(value);
        if (result !== value)
            throw new Error("account");
        return result;
    }
    catch {
        return invalid("Owner account is not canonical for the selected family.", "account_mismatch");
    }
}
function isoInstant(value) {
    const parsed = Date.parse(value);
    return Number.isFinite(parsed) && new Date(parsed).toISOString() === value;
}
function instant(value, label) {
    if (!(value instanceof Date) || !Number.isFinite(value.getTime()))
        invalid(`${label} is invalid.`, "invalid_time");
    return value.toISOString();
}
function invalid(message, reason) {
    throw new ApnError("APN_INVALID_INPUT", message, { reason });
}
function conflict(message) {
    throw new ApnError("APN_PROFILE_REVISION_CONFLICT", message, { reason: "stale_policy_revision" });
}
function corrupt(message) { return stateCorrupt(message); }
//# sourceMappingURL=allowlist-policy-overlay.js.map