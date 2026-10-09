import { validateCleanup85NativeUsage } from "./asset-usage-ledger-cleanup85-native.js";
import { address as solanaAddress } from "@solana/kit";
import { getAddress } from "viem";
import { canonicalJson, hashObject, domainHash, exactKeys, isPlainRecord, sha256 } from "./canonical.js";
import { ApnError } from "./errors.js";
import { parseAtomic } from "./money.js";
import { tronAddress } from "./tron/codec.js";
export const ASSET_USAGE_RESERVATION_SCHEMA = "apn.asset-usage-reservation.v1";
/** Existing chain-policy convention: [00:00:00.000Z, next 00:00:00.000Z). */
export const ASSET_USAGE_WINDOW = "utc-calendar-day";
const RESERVATION_DIGEST_DOMAIN = ASSET_USAGE_RESERVATION_SCHEMA;
const MAX_UINT256 = (1n << 256n) - 1n;
const DIGEST = /^[a-f0-9]{64}$/u;
/** The reservation id that `reserve` creates or replays for this exact identity and idempotency key. */
export function assetUsageReservationId(identityValue, idempotencyKey) {
    return reservationIdFor(validateIdentity(identityValue), idempotency(idempotencyKey));
}
export function validateAssetUsageReservation(value) {
    if (!isPlainRecord(value) || !(exactKeys(value, [
        "schemaVersion", "reservationId", "idempotencyHash", "policyDigest", "registryVersion", "account", "chain",
        "asset", "rail", "amountAtomic", "state", "reservedAt", "updatedAt", "effectAt", "outcomeDigest", "reservationDigest",
    ]) || exactKeys(value, [
        "schemaVersion", "reservationId", "idempotencyHash", "policyDigest", "registryVersion", "account", "chain",
        "asset", "rail", "amountAtomic", "consumedAtomic", "state", "reservedAt", "updatedAt", "effectAt", "outcomeDigest", "reservationDigest",
    ]) || exactKeys(value, ["schemaVersion", "reservationId", "idempotencyHash", "policyDigest", "registryVersion", "account", "chain", "asset", "rail", "amountAtomic", "consumedAtomic", "merchantNativeActualFee", "state", "reservedAt", "updatedAt", "effectAt", "outcomeDigest", "reservationDigest"]) || exactKeys(value, ["schemaVersion", "reservationId", "idempotencyHash", "policyDigest", "registryVersion", "account", "chain", "asset", "rail", "amountAtomic", "consumedAtomic", "cleanup85NativeReservation", "cleanup85NativeActual", "state", "reservedAt", "updatedAt", "effectAt", "outcomeDigest", "reservationDigest"]) || exactKeys(value, ["schemaVersion", "reservationId", "idempotencyHash", "policyDigest", "registryVersion", "account", "chain", "asset", "rail", "amountAtomic", "cleanup85NativeReservation", "state", "reservedAt", "updatedAt", "effectAt", "outcomeDigest", "reservationDigest"])) || value.schemaVersion !== ASSET_USAGE_RESERVATION_SCHEMA)
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
    if (value.consumedAtomic !== undefined && (value.state !== "failed_confirmed_revert" && value.merchantNativeActualFee === undefined && value.cleanup85NativeActual === undefined ||
        atomic(value.consumedAtomic, false, true) > atomic(value.amountAtomic, true, true))) {
        corrupt("Confirmed-revert consumption is invalid.");
    }
    if (value.cleanup85NativeActual !== undefined || value.cleanup85NativeReservation !== undefined)
        validateCleanup85NativeUsage(value);
    if (value.merchantNativeActualFee !== undefined) {
        const p = value.merchantNativeActualFee;
        if (!isPlainRecord(p) || !exactKeys(p, ["kind", "operationId", "fingerprint", "receiptHash", "actualFee", "reservedFee"]) || p.kind !== "merchant_mega_native_actual_fee" || ![p.operationId, p.fingerprint, p.receiptHash].every(x => typeof x === "string" && DIGEST.test(x)) || value.state !== "finalized" || value.account !== "0x0B4Dd0C3dA001Fa146EEd3f80B01860BEF6B8a14" || value.chain !== "eip155:4326" || value.rail !== "x402" || !isPlainRecord(value.asset) || value.asset.kind !== "native" || value.asset.identifier !== null || value.idempotencyHash !== idempotency(`apn.merchant-native:${p.operationId}`) || value.reservationId !== assetUsageReservationId(value, `apn.merchant-native:${p.operationId}`) || p.reservedFee !== value.amountAtomic || p.actualFee !== value.consumedAtomic || value.outcomeDigest !== hashObject(p))
            corrupt("Merchant native actual fee proof binding is invalid.");
    }
    if (!["reserved", "submitted", "unknown_finality", "finalized", "failed_before_effect", "released_unsubmitted", "failed_confirmed_revert"].includes(value.state))
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
    else if (value.state === "failed_before_effect" || value.state === "released_unsubmitted" || value.state === "failed_confirmed_revert") {
        if (value.state === "failed_confirmed_revert" && value.consumedAtomic !== undefined) {
            if (storedInstant(value.effectAt) !== updatedAt)
                corrupt("Confirmed-revert consumption time is invalid.");
        }
        else if (value.effectAt !== null)
            corrupt("A released usage failure cannot contain an effect timestamp.");
        digest(value.outcomeDigest, "Outcome digest", true);
    }
    else if (value.effectAt !== null || value.outcomeDigest !== null) {
        corrupt("A nonterminal usage reservation contains terminal outcome data.");
    }
}
export function expectedStates(value) {
    const allowed = ["reserved", "submitted", "unknown_finality", "finalized", "failed_before_effect", "released_unsubmitted", "failed_confirmed_revert"];
    if (!Array.isArray(value) || value.length === 0 || value.some((state) => !allowed.includes(state))) {
        throw invalid("Expected usage reservation source states are invalid.");
    }
    return [...new Set(value)];
}
export function reservationIdFor(identity, idempotencyHash) {
    return domainHash(RESERVATION_DIGEST_DOMAIN, canonicalJson({ ...exactIdentity(identity), idempotencyHash }));
}
export function seal(body) {
    return validateAssetUsageReservation({ ...body, reservationDigest: domainHash(RESERVATION_DIGEST_DOMAIN, canonicalJson(body)) });
}
export function sumUsage(records, now) {
    const day = instant(now).slice(0, 10);
    let total = 0n;
    for (const record of records) {
        if (record.state === "failed_before_effect" || record.state === "released_unsubmitted")
            continue;
        if (record.state === "failed_confirmed_revert" && record.consumedAtomic === undefined)
            continue;
        if (record.state === "finalized" && record.effectAt.slice(0, 10) !== day)
            continue;
        if (record.state === "failed_confirmed_revert" && record.effectAt.slice(0, 10) !== day)
            continue;
        total += atomic(record.state === "failed_confirmed_revert" || record.merchantNativeActualFee !== undefined || record.cleanup85NativeActual !== undefined ? record.consumedAtomic : record.amountAtomic, record.state !== "failed_confirmed_revert" && record.merchantNativeActualFee === undefined && record.cleanup85NativeActual === undefined, true);
        if (total > MAX_UINT256)
            corrupt("The usage ledger total exceeds uint256.");
    }
    return total.toString();
}
export function assertReplay(record, policyDigest, registryVersion, rail, amount, idempotencyHash) {
    if (record.policyDigest !== policyDigest || record.registryVersion !== registryVersion || record.rail !== rail ||
        record.amountAtomic !== amount || record.idempotencyHash !== idempotencyHash) {
        throw blocked("The idempotency key is already bound to a different usage reservation.");
    }
}
export function assertBucketWindow(records, at) {
    const day = at.slice(0, 10);
    if (records.some((record) => record.updatedAt.slice(0, 10) > day)) {
        throw blocked("The usage reservation window cannot move backward in time.");
    }
}
export function assertTransition(from, to) {
    const allowed = {
        reserved: ["submitted", "unknown_finality", "finalized", "failed_before_effect", "released_unsubmitted"],
        submitted: ["unknown_finality", "finalized", "failed_confirmed_revert"],
        unknown_finality: ["finalized", "failed_confirmed_revert", "released_unsubmitted"],
        finalized: [],
        failed_before_effect: [],
        released_unsubmitted: [],
        failed_confirmed_revert: [],
    };
    if (!allowed[from].includes(to))
        throw blocked("The usage reservation transition is invalid.");
}
export function validateIdentity(value, stored = false) {
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
export function exactIdentity(value) { return { account: value.account, chain: value.chain, asset: value.asset }; }
export function exactAsset(value) {
    return value.kind === "native" ? { kind: "native", identifier: null } : { kind: "token", identifier: value.identifier };
}
export function withoutDigest(value) { const { reservationDigest: _digest, ...body } = value; return body; }
export function canonicalAccount(chain, value, stored) {
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
export function idempotency(value) {
    if (typeof value !== "string" || value.length < 8 || value.length > 256 || /[^\x21-\x7e]/u.test(value))
        throw invalid("The usage idempotency key is invalid.");
    return sha256(`asset-usage-idempotency\0${value}`);
}
export function atomic(value, positive, stored) {
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
export function instant(value) {
    if (!(value instanceof Date) || !Number.isFinite(value.getTime()))
        throw invalid("The usage evaluation instant is invalid.");
    return value.toISOString();
}
function storedInstant(value) {
    if (typeof value !== "string" || !Number.isFinite(Date.parse(value)) || new Date(value).toISOString() !== value)
        corrupt("The usage reservation instant is invalid.");
    return value;
}
export function digest(value, label, stored = false) {
    if (typeof value !== "string" || !DIGEST.test(value))
        failure(stored, `${label} is invalid.`);
    return value;
}
function failure(stored, message) { return stored ? corrupt(message) : invalid(message); }
export function invalid(message) { throw new ApnError("APN_INVALID_INPUT", message); }
export function blocked(message) { return new ApnError("APN_OPERATION_BLOCKED", message); }
export function corrupt(message) { throw new ApnError("APN_STATE_CORRUPT", message); }
//# sourceMappingURL=asset-usage-ledger-record.js.map