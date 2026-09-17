import { address as solanaAddress } from "@solana/kit";
import { getAddress } from "viem";
import { canonicalJson, domainHash, exactKeys, isPlainRecord, sha256 } from "./canonical.js";
import { ApnError } from "./errors.js";
import { evaluateAssetPolicy, validateAssetPolicyRegistry, } from "./asset-policy-registry.js";
import { parseAtomic } from "./money.js";
import { SecureStateStore } from "./secure-state-store.js";
import { tronAddress } from "./tron/codec.js";
export const ASSET_USAGE_RESERVATION_SCHEMA = "apn.asset-usage-reservation.v1";
/** Existing chain-policy convention: [00:00:00.000Z, next 00:00:00.000Z). */
export const ASSET_USAGE_WINDOW = "utc-calendar-day";
const RESERVATION_DIGEST_DOMAIN = ASSET_USAGE_RESERVATION_SCHEMA;
const MAX_UINT256 = (1n << 256n) - 1n;
const DIGEST = /^[a-f0-9]{64}$/u;
/**
 * Durable common usage ledger for all admitted rails. Money-rail owners reserve here while holding
 * no other state lock, then persist their own operation under their existing lock discipline.
 */
export class AssetUsageLedger extends SecureStateStore {
    initialized;
    async reserve(input) {
        const registry = validateAssetPolicyRegistry(input.registry);
        const at = instant(input.now);
        const initial = evaluateAssetPolicy(registry, {
            chain: input.chain, asset: input.asset, rail: input.rail,
            amountAtomic: input.amountAtomic, dailyUsageAtomic: "0", asOfDate: at.slice(0, 10),
        });
        const account = canonicalAccount(initial.chain, input.account, false);
        const idempotencyHash = idempotency(input.idempotencyKey);
        const identity = { account, chain: initial.chain, asset: exactAsset(initial.asset) };
        const reservationId = domainHash(RESERVATION_DIGEST_DOMAIN, canonicalJson({ ...identity, idempotencyHash }));
        await this.ready();
        return await this.withLocks([this.bucketLock(identity)], async () => {
            const reservations = await this.loadBucket(identity);
            const existing = reservations.find((entry) => entry.reservationId === reservationId);
            if (existing !== undefined) {
                assertReplay(existing, initial.policyDigest, initial.registryVersion, input.rail, initial.amountAtomic, idempotencyHash);
                return existing;
            }
            assertBucketWindow(reservations, at);
            const usage = sumUsage(reservations, input.now);
            evaluateAssetPolicy(registry, {
                chain: identity.chain, asset: identity.asset, rail: input.rail,
                amountAtomic: initial.amountAtomic, dailyUsageAtomic: usage, asOfDate: at.slice(0, 10),
            });
            const body = {
                schemaVersion: ASSET_USAGE_RESERVATION_SCHEMA,
                reservationId,
                idempotencyHash,
                policyDigest: initial.policyDigest,
                registryVersion: initial.registryVersion,
                ...identity,
                rail: input.rail,
                amountAtomic: initial.amountAtomic,
                state: "reserved",
                reservedAt: at,
                updatedAt: at,
                effectAt: null,
                outcomeDigest: null,
            };
            const record = seal(body);
            await this.writeJson(this.recordPath(identity, reservationId), record, true);
            return record;
        });
    }
    async transition(input) {
        const identity = validateIdentity(input);
        const reservationId = digest(input.reservationId, "Reservation id");
        const policyDigest = digest(input.policyDigest, "Policy digest");
        const at = instant(input.now);
        await this.ready();
        return await this.withLocks([this.bucketLock(identity)], async () => {
            const value = await this.readJson(this.recordPath(identity, reservationId));
            if (value === null)
                throw blocked("The usage reservation does not exist.");
            const current = validateAssetUsageReservation(value);
            if (current.policyDigest !== policyDigest || canonicalJson(exactIdentity(current)) !== canonicalJson(identity)) {
                throw blocked("The usage reservation binding does not match the requested transition.");
            }
            if (at < current.updatedAt)
                throw blocked("The usage reservation transition cannot move backward in time.");
            const terminal = input.state === "finalized" || input.state === "failed_before_effect";
            const outcomeDigest = terminal ? digest(input.outcomeDigest, "Outcome digest") : null;
            if (current.state === input.state) {
                if (current.outcomeDigest !== outcomeDigest)
                    throw blocked("The idempotent usage transition outcome does not match.");
                return current;
            }
            assertTransition(current.state, input.state);
            const body = {
                ...withoutDigest(current),
                state: input.state,
                updatedAt: at,
                effectAt: input.state === "finalized" ? at : null,
                outcomeDigest,
            };
            const next = seal(body);
            await this.writeJson(this.recordPath(identity, reservationId), next);
            return next;
        });
    }
    async usage(identityValue, now) {
        const identity = validateIdentity(identityValue);
        const at = instant(now);
        await this.ready();
        return await this.withLocks([this.bucketLock(identity)], async () => ({
            windowPolicy: ASSET_USAGE_WINDOW,
            windowStart: `${at.slice(0, 10)}T00:00:00.000Z`,
            windowEnd: new Date(Date.parse(`${at.slice(0, 10)}T00:00:00.000Z`) + 86_400_000).toISOString(),
            amountAtomic: sumUsage(await this.loadBucket(identity), now),
        }));
    }
    async load(identityValue, reservationIdValue) {
        const identity = validateIdentity(identityValue);
        const reservationId = digest(reservationIdValue, "Reservation id");
        await this.ready();
        return await this.withLocks([this.bucketLock(identity)], async () => {
            const value = await this.readJson(this.recordPath(identity, reservationId));
            return value === null ? null : validateAssetUsageReservation(value);
        });
    }
    async ready() {
        this.initialized ??= (async () => { await super.initialize(); await this.ensureDirectory("asset-usage"); })();
        await this.initialized;
    }
    async loadBucket(identity) {
        const directory = this.bucketDirectory(identity);
        await this.ensureDirectory(directory);
        const entries = await this.readDirectory(directory);
        const records = [];
        for (const entry of entries) {
            if (!entry.isFile() || !/^[a-f0-9]{64}\.json$/u.test(entry.name))
                corrupt("The usage ledger directory contains an invalid entry.");
            const value = await this.readJson(`${directory}/${entry.name}`);
            if (value === null)
                corrupt("A usage reservation disappeared during a protected read.");
            const record = validateAssetUsageReservation(value);
            if (canonicalJson(exactIdentity(record)) !== canonicalJson(identity) || `${record.reservationId}.json` !== entry.name) {
                corrupt("A usage reservation path binding is invalid.");
            }
            records.push(record);
        }
        return records;
    }
    bucketDirectory(identity) {
        return `asset-usage/${domainHash("apn.asset-usage-bucket.v1", canonicalJson(identity))}`;
    }
    recordPath(identity, reservationId) {
        return `${this.bucketDirectory(identity)}/${reservationId}.json`;
    }
    bucketLock(identity) {
        return `asset-usage:${domainHash("apn.asset-usage-lock.v1", canonicalJson(identity))}`;
    }
}
export function validateAssetUsageReservation(value) {
    if (!isPlainRecord(value) || !exactKeys(value, [
        "schemaVersion", "reservationId", "idempotencyHash", "policyDigest", "registryVersion", "account", "chain",
        "asset", "rail", "amountAtomic", "state", "reservedAt", "updatedAt", "effectAt", "outcomeDigest", "reservationDigest",
    ]) || value.schemaVersion !== ASSET_USAGE_RESERVATION_SCHEMA)
        corrupt("The usage reservation schema is invalid.");
    const { reservationDigest, ...body } = value;
    validateBody(body);
    if (typeof reservationDigest !== "string" || !DIGEST.test(reservationDigest) ||
        domainHash(RESERVATION_DIGEST_DOMAIN, canonicalJson(body)) !== reservationDigest) {
        corrupt("The usage reservation digest is invalid.");
    }
    return value;
}
function validateBody(value) {
    digest(value.reservationId, "Reservation id", true);
    digest(value.idempotencyHash, "Idempotency hash", true);
    digest(value.policyDigest, "Policy digest", true);
    if (typeof value.registryVersion !== "string" || !/^[a-z0-9][a-z0-9._-]{0,63}$/u.test(value.registryVersion))
        corrupt("The registry version binding is invalid.");
    validateIdentity(value, true);
    if (!["direct", "gasless", "x402", "bridge", "swap"].includes(value.rail))
        corrupt("The usage rail binding is invalid.");
    atomic(value.amountAtomic, true, true);
    if (!["reserved", "submitted", "unknown_finality", "finalized", "failed_before_effect"].includes(value.state))
        corrupt("The usage state is invalid.");
    const reservedAt = storedInstant(value.reservedAt);
    const updatedAt = storedInstant(value.updatedAt);
    if (updatedAt < reservedAt)
        corrupt("The usage reservation timestamps are invalid.");
    if (value.state === "finalized") {
        const effectAt = storedInstant(value.effectAt);
        if (effectAt !== updatedAt)
            corrupt("The finalized usage effect timestamp is invalid.");
        digest(value.outcomeDigest, "Outcome digest", true);
    }
    else if (value.state === "failed_before_effect") {
        if (value.effectAt !== null)
            corrupt("A pre-effect failure cannot contain an effect timestamp.");
        digest(value.outcomeDigest, "Outcome digest", true);
    }
    else if (value.effectAt !== null || value.outcomeDigest !== null) {
        corrupt("A nonterminal usage reservation contains terminal outcome data.");
    }
}
function seal(body) {
    return validateAssetUsageReservation({ ...body, reservationDigest: domainHash(RESERVATION_DIGEST_DOMAIN, canonicalJson(body)) });
}
function sumUsage(records, now) {
    const day = instant(now).slice(0, 10);
    let total = 0n;
    for (const record of records) {
        if (record.state === "failed_before_effect")
            continue;
        if (record.state === "finalized" && record.effectAt.slice(0, 10) !== day)
            continue;
        total += atomic(record.amountAtomic, true, true);
        if (total > MAX_UINT256)
            corrupt("The usage ledger total exceeds uint256.");
    }
    return total.toString();
}
function assertReplay(record, policyDigest, registryVersion, rail, amount, idempotencyHash) {
    if (record.policyDigest !== policyDigest || record.registryVersion !== registryVersion || record.rail !== rail ||
        record.amountAtomic !== amount || record.idempotencyHash !== idempotencyHash) {
        throw blocked("The idempotency key is already bound to a different usage reservation.");
    }
}
function assertBucketWindow(records, at) {
    const day = at.slice(0, 10);
    if (records.some((record) => record.updatedAt.slice(0, 10) > day)) {
        throw blocked("The usage reservation window cannot move backward in time.");
    }
}
function assertTransition(from, to) {
    const allowed = {
        reserved: ["submitted", "unknown_finality", "finalized", "failed_before_effect"],
        submitted: ["unknown_finality", "finalized"],
        unknown_finality: ["finalized", "failed_before_effect"],
        finalized: [],
        failed_before_effect: [],
    };
    if (!allowed[from].includes(to))
        throw blocked("The usage reservation transition is invalid.");
}
function validateIdentity(value, stored = false) {
    if (typeof value.chain !== "string" || value.chain.length === 0 || value.chain.length > 128)
        failure(stored, "The usage network identity is invalid.");
    const account = canonicalAccount(value.chain, value.account, stored);
    if (!isPlainRecord(value.asset) || !exactKeys(value.asset, ["kind", "identifier"]) ||
        (value.asset.kind !== "native" && value.asset.kind !== "token") ||
        (value.asset.kind === "native" ? value.asset.identifier !== null : typeof value.asset.identifier !== "string" || value.asset.identifier.length === 0 || value.asset.identifier.length > 128)) {
        failure(stored, "The usage asset identity is invalid.");
    }
    const asset = value.asset.kind === "native"
        ? { kind: "native", identifier: null }
        : { kind: "token", identifier: canonicalToken(value.chain, value.asset.identifier, stored) };
    return { account, chain: value.chain, asset };
}
function exactIdentity(value) { return { account: value.account, chain: value.chain, asset: value.asset }; }
function exactAsset(value) {
    return value.kind === "native" ? { kind: "native", identifier: null } : { kind: "token", identifier: value.identifier };
}
function withoutDigest(value) { const { reservationDigest: _digest, ...body } = value; return body; }
function canonicalAccount(chain, value, stored) {
    if (typeof value !== "string")
        return failure(stored, "The usage account identity is invalid.");
    try {
        const evm = /^eip155:([1-9][0-9]{0,77})$/u.exec(chain);
        if (evm !== null && BigInt(evm[1]) <= MAX_UINT256) {
            const canonical = getAddress(value);
            if (canonical === "0x0000000000000000000000000000000000000000" || canonical !== value)
                throw new Error();
            return canonical;
        }
        const solana = /^solana:([1-9A-HJ-NP-Za-km-z]{32,44})$/u.exec(chain);
        if (solana !== null && solanaAddress(solana[1]) === solana[1]) {
            const canonical = solanaAddress(value);
            if (canonical !== value)
                throw new Error();
            return canonical;
        }
        if (/^tron:[a-f0-9]{64}$/u.test(chain)) {
            const canonical = tronAddress(value);
            if (canonical !== value)
                throw new Error();
            return canonical;
        }
    }
    catch { }
    return failure(stored, "The usage account or network identity is not canonical.");
}
function canonicalToken(chain, value, stored) {
    try {
        if (/^eip155:[1-9][0-9]{0,77}$/u.test(chain)) {
            const canonical = getAddress(value);
            if (canonical === "0x0000000000000000000000000000000000000000" || canonical !== value)
                throw new Error();
            return canonical;
        }
        if (/^solana:[1-9A-HJ-NP-Za-km-z]{32,44}$/u.test(chain)) {
            const canonical = solanaAddress(value);
            if (canonical !== value)
                throw new Error();
            return canonical;
        }
        if (/^tron:[a-f0-9]{64}$/u.test(chain)) {
            const canonical = tronAddress(value);
            if (canonical !== value)
                throw new Error();
            return canonical;
        }
    }
    catch { }
    return failure(stored, "The usage token identity is not canonical for the network.");
}
function idempotency(value) {
    if (typeof value !== "string" || value.length < 8 || value.length > 256 || /[^\x21-\x7e]/u.test(value))
        throw invalid("The usage idempotency key is invalid.");
    return sha256(`asset-usage-idempotency\0${value}`);
}
function atomic(value, positive, stored) {
    try {
        const parsed = parseAtomic(value, { positive });
        if (parsed > MAX_UINT256)
            throw new Error();
        return parsed;
    }
    catch {
        return failure(stored, "The usage atomic amount is invalid.");
    }
}
function instant(value) {
    if (!(value instanceof Date) || !Number.isFinite(value.getTime()))
        throw invalid("The usage evaluation instant is invalid.");
    return value.toISOString();
}
function storedInstant(value) {
    if (typeof value !== "string" || !Number.isFinite(Date.parse(value)) || new Date(value).toISOString() !== value)
        corrupt("The usage reservation instant is invalid.");
    return value;
}
function digest(value, label, stored = false) {
    if (typeof value !== "string" || !DIGEST.test(value))
        failure(stored, `${label} is invalid.`);
    return value;
}
function failure(stored, message) { return stored ? corrupt(message) : invalid(message); }
function invalid(message) { throw new ApnError("APN_INVALID_INPUT", message); }
function blocked(message) { return new ApnError("APN_OPERATION_BLOCKED", message); }
function corrupt(message) { throw new ApnError("APN_STATE_CORRUPT", message); }
//# sourceMappingURL=asset-usage-ledger.js.map