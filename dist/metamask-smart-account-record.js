import { exactKeys, isPlainRecord, sha256 } from "./canonical.js";
import { ApnError } from "./errors.js";
export const SMART_ACCOUNT_PERMISSION_RECORD_VERSION = "apn.metamask-smart-account-permission.v1";
export const METAMASK_SMART_ACCOUNT_PROVIDER_ID = "metamask-smart-account";
const HASH = /^[a-f0-9]{64}$/u;
const ADDRESS = /^0x[0-9a-fA-F]{40}$/u;
const PRIVATE_KEY = /^0x[0-9a-f]{64}$/u;
const HEX = /^0x(?:[0-9a-fA-F]{2})*$/u;
const POSITIVE = /^[1-9][0-9]*$/u;
export function validateSmartAccountPermissionRecord(value) {
    if (!isPlainRecord(value))
        invalid();
    const granted = value.phase !== "pending_consent";
    const expected = [
        "schema_version", "profile", "profile_hash", "provider_id", "idempotency_hash", "intent_fingerprint",
        "phase", "revision", "requested_cap_atomic", "requested_expires_at_unix", "starts_at_unix",
        "session_address", "session_private_key", "created_at", "updated_at", "max_observed_unix",
        "revocation_freshness",
        ...(value.last_foreground_sync_at === undefined ? [] : ["last_foreground_sync_at"]),
        ...(granted ? [
            "owner_address", "granted_cap_atomic", "granted_expires_at_unix", "grant_context",
            "grant_fingerprint", "delegation_manager", "permission_response",
        ] : []),
    ];
    if (!exactKeys(value, expected))
        invalid();
    if (value.schema_version !== SMART_ACCOUNT_PERMISSION_RECORD_VERSION ||
        typeof value.profile !== "string" || !/^[a-z0-9][a-z0-9._-]{0,63}$/u.test(value.profile) ||
        typeof value.profile_hash !== "string" || !HASH.test(value.profile_hash) ||
        value.profile_hash !== sha256(`profile\0${value.profile}`) ||
        value.provider_id !== METAMASK_SMART_ACCOUNT_PROVIDER_ID ||
        typeof value.idempotency_hash !== "string" || !HASH.test(value.idempotency_hash) ||
        typeof value.intent_fingerprint !== "string" || !HASH.test(value.intent_fingerprint) ||
        !["pending_consent", "grant_committed_pending_profile", "active", "disabled", "expired", "revoked", "drift_blocked"].includes(String(value.phase)) ||
        !Number.isSafeInteger(value.revision) || Number(value.revision) < 1 ||
        typeof value.requested_cap_atomic !== "string" || !POSITIVE.test(value.requested_cap_atomic) ||
        !safeUnix(value.requested_expires_at_unix) || !safeUnix(value.starts_at_unix) ||
        Number(value.starts_at_unix) >= Number(value.requested_expires_at_unix) ||
        typeof value.session_address !== "string" || !ADDRESS.test(value.session_address) ||
        typeof value.session_private_key !== "string" || !PRIVATE_KEY.test(value.session_private_key) ||
        !canonicalTimestamp(value.created_at) || !canonicalTimestamp(value.updated_at) ||
        !safeUnix(value.max_observed_unix) || Number(value.max_observed_unix) < Number(value.starts_at_unix) ||
        !["never_synced", "confirmed_present", "confirmed_absent", "unverified"].includes(String(value.revocation_freshness)) ||
        (value.last_foreground_sync_at !== undefined && !canonicalTimestamp(value.last_foreground_sync_at)))
        invalid();
    if (granted)
        validateGrantedFields(value);
    return value;
}
export function isGrantedPermissionRecord(record) {
    return record.phase !== "pending_consent";
}
export function projectPermissionBinding(record, nowUnix) {
    const state = record.phase === "active" &&
        Math.max(record.max_observed_unix, nowUnix) >= record.granted_expires_at_unix
        ? "expired"
        : record.phase;
    return {
        owner_address: record.owner_address,
        session_address: record.session_address,
        state,
        revision: record.revision,
        requested_cap_atomic: record.requested_cap_atomic,
        granted_cap_atomic: record.granted_cap_atomic,
        starts_at_unix: record.starts_at_unix,
        expires_at_unix: record.granted_expires_at_unix,
        grant_fingerprint: record.grant_fingerprint,
        ...(record.last_foreground_sync_at === undefined ? {} : { last_foreground_sync_at: record.last_foreground_sync_at }),
        revocation_freshness: record.revocation_freshness,
        observed_at: record.updated_at,
    };
}
export function projectPendingPermissionBinding(record) {
    return {
        session_address: record.session_address,
        state: "pending_consent",
        revision: record.revision,
        requested_cap_atomic: record.requested_cap_atomic,
        starts_at_unix: record.starts_at_unix,
        expires_at_unix: record.requested_expires_at_unix,
        revocation_freshness: record.revocation_freshness,
        observed_at: record.updated_at,
    };
}
function validateGrantedFields(value) {
    if (typeof value.owner_address !== "string" || !ADDRESS.test(value.owner_address) ||
        typeof value.granted_cap_atomic !== "string" || !POSITIVE.test(value.granted_cap_atomic) ||
        BigInt(value.granted_cap_atomic) > BigInt(String(value.requested_cap_atomic)) ||
        !safeUnix(value.granted_expires_at_unix) ||
        Number(value.granted_expires_at_unix) > Number(value.requested_expires_at_unix) ||
        Number(value.granted_expires_at_unix) <= Number(value.starts_at_unix) ||
        typeof value.grant_context !== "string" || !HEX.test(value.grant_context) || value.grant_context.length < 4 ||
        typeof value.grant_fingerprint !== "string" || !HASH.test(value.grant_fingerprint) ||
        typeof value.delegation_manager !== "string" || !ADDRESS.test(value.delegation_manager) ||
        !isPlainRecord(value.permission_response))
        invalid();
}
function safeUnix(value) {
    return Number.isSafeInteger(value) && Number(value) > 0;
}
function canonicalTimestamp(value) {
    if (typeof value !== "string")
        return false;
    const parsed = Date.parse(value);
    return Number.isFinite(parsed) && new Date(parsed).toISOString() === value;
}
function invalid() {
    throw new ApnError("APN_STATE_CORRUPT", "MetaMask Smart Account permission state is invalid.");
}
//# sourceMappingURL=metamask-smart-account-record.js.map