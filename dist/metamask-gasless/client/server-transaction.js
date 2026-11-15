import { isPlainRecord } from "../../canonical.js";
import { mmFail } from "../reasons.js";
import { mmCanonicalAddress, mmExact, mmHash, mmHex, mmIso, mmUuid } from "../validation.js";
import { jobTx } from "./job-tx.js";
import { submitToken } from "./submit-diagnostic.js";
const INPUT = "mm_gasless_input", ANSWER = "mm_gasless_submit_unknown";
/** `0x` and the lowest-case hex digits of a quantity with no leading zero, as `mm` writes `0x${value.toString(16)}`. */
const QUANTITY = /^0x(?:0|[1-9a-f][0-9a-f]{0,63})$/u;
const INTENT = /^[\x21-\x7e](?:[\x20-\x7e]{0,510}[\x21-\x7e])?$/u;
const TX_KEYS = ["from", "to", "chainId", "data", "value", "nonce", "gasLimit", "maxFeePerGas", "maxPriorityFeePerGas"];
export function serverTransactionInput(value) {
    const i = mmExact(value, ["requestId", "projectHash", "tx", "intent", "expiresAt"], INPUT);
    // A canonical v4 UUID only, as the SDK itself would generate one.
    mmUuid(i.requestId, INPUT);
    mmIso(i.expiresAt, INPUT);
    if (i.projectHash !== null)
        mmHash(i.projectHash, INPUT);
    if (typeof i.intent !== "string" || !INTENT.test(i.intent))
        mmFail(INPUT);
    const t = mmExact(i.tx, TX_KEYS, INPUT);
    mmCanonicalAddress(t.from, INPUT);
    mmCanonicalAddress(t.to, INPUT);
    mmHex(t.data, undefined, INPUT);
    if (!Number.isSafeInteger(t.chainId) || Number(t.chainId) < 1 || t.value !== "0x0" ||
        !Number.isSafeInteger(t.nonce) || Number(t.nonce) < 0 ||
        [t.gasLimit, t.maxFeePerGas, t.maxPriorityFeePerGas].some(item => typeof item !== "string" || !QUANTITY.test(item)))
        mmFail(INPUT);
    return i;
}
/**
 * The exact JSON the SDK's `EvmServerAdapter.submitTransaction` (fox-sdk 2.7.0, `RemoteSigningClient`) POSTs for this
 * request: `{ requestId, namespace: "evm", chainId, tx, txIntent }`, in that key order, with no `method`, `encoding`,
 * `bridgeQuoteId` or `signedTransaction`. The helper's network policy admits these bytes and no others.
 */
export function serverTransactionBody(input) {
    return JSON.stringify({ requestId: input.requestId, namespace: "evm", chainId: input.tx.chainId, tx: serverTransactionTx(input), txIntent: input.intent });
}
/** The tx the helper hands the SDK, in `preparedToRemoteTx`'s field order, whatever order the input named its fields in. */
export function serverTransactionTx(input) {
    const t = input.tx;
    return { from: t.from, to: t.to, chainId: t.chainId, data: t.data, value: t.value, nonce: t.nonce, gasLimit: t.gasLimit,
        maxFeePerGas: t.maxFeePerGas, maxPriorityFeePerGas: t.maxPriorityFeePerGas };
}
/**
 * The SDK's answer to the POST, checked as the gasless submit checks its own (client/service.ts): this request id, kind
 * transaction, a status token, `tx.from` the sender and `tx.chainId` its chain (a number), and a hash, when there is
 * one, of 32 lowercase bytes. An absent or null hash is no hash. Any other answer refuses with its check.
 */
export function serverTransactionAnswer(value, input, responseHash, sessionAuthMethod, seen) {
    const refuse = (check) => { seen.check = check; return mmFail(ANSWER); };
    if (!isPlainRecord(value) || responseHash === undefined)
        return refuse("response_body");
    if (value.requestId !== input.requestId)
        return refuse("response_request_id");
    if (value.kind !== "transaction")
        return refuse("response_kind");
    const status = submitToken(value.status);
    if (status === null) {
        seen.providerStatus = null;
        return refuse("response_status");
    }
    if (!isPlainRecord(value.tx) || String(value.tx.from).toLowerCase() !== input.tx.from || value.tx.chainId !== input.tx.chainId) {
        seen.tx = jobTx(value.tx, { binding: { address: input.tx.from }, request: { chainId: input.tx.chainId } });
        seen.providerStatus = status;
        return refuse("response_tx");
    }
    if (value.txHash !== undefined && value.txHash !== null)
        seen.check = "response_hash";
    const txHash = value.txHash === undefined || value.txHash === null ? null : mmHex(value.txHash, 32, ANSWER);
    seen.check = undefined;
    return { requestId: input.requestId, status, txHash, mfa: approvalWindow(status, value.approval, sessionAuthMethod), responseHash };
}
/**
 * The helper's answer as the parent accepts it, for the very request it was sent: exactly these fields, this request id
 * (another names another request: identity conflict), and an MFA window only for AWAITING_MFA.
 */
export function serverTransactionResult(value, input) {
    const r = mmExact(value, ["requestId", "status", "txHash", "mfa", "responseHash"], ANSWER);
    mmHash(r.responseHash, ANSWER);
    if (r.requestId !== input.requestId)
        mmFail(ANSWER);
    const status = submitToken(r.status);
    if (status === null || (r.txHash !== null && mmHex(r.txHash, 32, ANSWER) !== r.txHash))
        mmFail(ANSWER);
    assertApprovalWindow(r.mfa, status, ANSWER);
    return r;
}
/**
 * For `AWAITING_MFA` only: the job's `approval.expiresAt` (as `mm` reads it from the job status it polls) in its exact
 * ISO form, and the signed-in session's `authMethod` (as `mm` reads `session.load()?.authMethod`); a value in any other
 * form is null, never guessed (metaMaskMfaNotice's rule). No other approval field leaves the helper.
 */
export function approvalWindow(status, approval, sessionAuthMethod) {
    if (status !== "AWAITING_MFA")
        return null;
    return { expiresAt: exactInstant(isPlainRecord(approval) ? approval.expiresAt : undefined), authMethod: authMethodToken(sessionAuthMethod) };
}
/** The parent's check of a window the helper returned: present exactly for AWAITING_MFA, each field exact or null. */
export function assertApprovalWindow(value, status, reason) {
    if (status !== "AWAITING_MFA" ? value !== null : !isPlainRecord(value))
        mmFail(reason);
    if (value === null)
        return;
    const m = mmExact(value, ["expiresAt", "authMethod"], reason);
    if (m.expiresAt !== exactInstant(m.expiresAt) || m.authMethod !== authMethodToken(m.authMethod))
        mmFail(reason);
}
function exactInstant(value) {
    return typeof value === "string" && Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value ? value : null;
}
function authMethodToken(value) {
    return typeof value === "string" && /^[a-z][a-z0-9_-]{0,31}$/u.test(value) ? value : null;
}
//# sourceMappingURL=server-transaction.js.map