import { exactKeys, isPlainRecord } from "./canonical.js";
const RESERVED_STREAM_KEYS = new Set(["_notice", "_summary", "_hint", "_error"]);
/**
 * MetaMask Agent Wallet 6.1.5 writes either one ordinary JSON envelope or a
 * newline-delimited stream. Once a command emits a notice, subsequent success
 * is `{ "_summary": ... }` on stdout and failure is `{ "_error": ... }` on
 * stderr. APN captures stdout only, so a notice-only stream is meaningful
 * durable pending evidence rather than malformed JSON.
 */
export function parseMetaMaskProcessOutput(bytes) {
    const text = bytes.toString("utf8").trim();
    if (text.length === 0)
        return null;
    const whole = parseRecord(text);
    if (whole !== null && typeof whole.ok === "boolean" &&
        !Object.keys(whole).some((key) => RESERVED_STREAM_KEYS.has(key))) {
        return { envelope: whole, notices: [] };
    }
    const lines = text.split(/\r?\n/u);
    if (lines.some((line) => line.trim().length === 0))
        return null;
    const notices = [];
    let envelope = null;
    let terminalSeen = false;
    for (const line of lines) {
        const record = parseRecord(line);
        if (record === null || terminalSeen)
            return null;
        if (exactKeys(record, ["_notice"]) && isPlainRecord(record._notice)) {
            notices.push(record._notice);
            continue;
        }
        if ((exactKeys(record, ["_summary"]) || exactKeys(record, ["_summary", "_hint"])) &&
            isPlainRecord(record._summary) &&
            (record._hint === undefined || typeof record._hint === "string")) {
            envelope = { ok: true, data: record._summary, ...(record._hint === undefined ? {} : { hint: record._hint }) };
            terminalSeen = true;
            continue;
        }
        if (exactKeys(record, ["_error"]) && isPlainRecord(record._error)) {
            envelope = { ok: false, error: record._error };
            terminalSeen = true;
            continue;
        }
        return null;
    }
    if (notices.length === 0)
        return null;
    return { envelope, notices };
}
export function classifyMetaMaskPendingNotices(notices, expectedRecoveryToken) {
    if (notices.length === 0)
        return { disposition: "none" };
    let recoveryToken;
    for (const notice of notices) {
        const state = notice.kind === "AWAITING_MFA" || notice.status === "AWAITING_MFA"
            ? "AWAITING_MFA" : undefined;
        const token = typeof notice.pollingId === "string" && validRecoveryToken(notice.pollingId)
            ? notice.pollingId : undefined;
        if (state === undefined || token === undefined) {
            return { disposition: "invalid", reason: "provider_response_malformed" };
        }
        if ((expectedRecoveryToken !== undefined && token !== expectedRecoveryToken) ||
            (recoveryToken !== undefined && token !== recoveryToken))
            return { disposition: "invalid", reason: "provider_recovery_identity_mismatch" };
        recoveryToken = token;
    }
    return recoveryToken === undefined
        ? { disposition: "invalid", reason: "provider_response_malformed" }
        : { disposition: "pending", recoveryToken, providerState: "AWAITING_MFA" };
}
/**
 * The owner-facing fields of the last notice of a stream `classifyMetaMaskPendingNotices` found pending. 6.1.5 writes
 * `{kind, pollingId, expiresAt?, authMethod, message}`; a field that is absent or not in its exact form is null, never
 * guessed. The provider's free-text message (which may carry a link) is not kept.
 */
export function metaMaskMfaNotice(notices) {
    const last = notices.at(-1) ?? {}, expiresAt = last.expiresAt, authMethod = last.authMethod;
    return {
        expiresAt: typeof expiresAt === "string" && Number.isFinite(Date.parse(expiresAt)) && new Date(expiresAt).toISOString() === expiresAt ? expiresAt : null,
        authMethod: typeof authMethod === "string" && /^[a-z][a-z0-9_-]{0,31}$/u.test(authMethod) ? authMethod : null,
    };
}
const LOCAL_STATE_HINT = "Run `mm wallet requests list` to see open requests, then copy a polling ID.";
const SERVER_HINT = "The request was not found on the server — it may have expired or already completed. Run `mm wallet requests list`, or re-run the command.";
/**
 * The miss in mm's parsed stderr answer (`{"ok":false,"error":{…}}`, or `{"_error":{…}}` after a notice) for the watched
 * id, by 6.1.5's exact wording: the local miss names the id itself ("No pending wallet request found for polling id
 * <id>.") beside its fixed hint; a server miss carries its own fixed hint. Undefined for any other answer.
 */
export function metaMaskRequestNotFound(answer, requestId) {
    if (!isPlainRecord(answer))
        return undefined;
    const error = exactKeys(answer, ["ok", "error"]) && answer.ok === false ? answer.error
        : exactKeys(answer, ["_error"]) ? answer._error : undefined;
    if (!isPlainRecord(error) || error.code !== "REQUEST_NOT_FOUND")
        return undefined;
    if (error.message === `No pending wallet request found for polling id ${requestId}.` && error.hint === LOCAL_STATE_HINT)
        return "local_state";
    return error.hint === SERVER_HINT ? "server" : "unattributed";
}
/**
 * The reason for a watch that wrote nothing to stdout because it answered REQUEST_NOT_FOUND on stderr (the runner's
 * `requestNotFound`); undefined for every other watch, which keeps its own classification.
 */
export function metaMaskWatchMissReason(result) {
    if (result.requestNotFound === undefined || result.stdout.toString("utf8").trim().length !== 0)
        return undefined;
    return result.requestNotFound === "local_state" ? "metamask_request_not_in_local_state"
        : result.requestNotFound === "server" ? "metamask_request_not_found_on_server" : "provider_request_not_found";
}
function parseRecord(text) {
    try {
        const value = JSON.parse(text);
        return isPlainRecord(value) ? value : null;
    }
    catch {
        return null;
    }
}
function validRecoveryToken(value) {
    return /^[A-Za-z0-9._:-]{1,256}$/u.test(value);
}
//# sourceMappingURL=metamask-process-output.js.map