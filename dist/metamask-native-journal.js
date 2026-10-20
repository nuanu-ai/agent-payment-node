import { getAddress } from "viem";
import { canonicalJson, exactKeys, hashObject, isPlainRecord, sha256 } from "./canonical.js";
import { ApnError } from "./errors.js";
import { SecureStateStore } from "./secure-state-store.js";
import { StateStore } from "./state.js";
import { AllowlistPolicyStore } from "./allowlist-policy-store.js";
import { activeAssetPolicyFromState } from "./allowlist-active-policy.js";
import { evaluateAssetPolicy } from "./asset-policy-registry.js";
import { assertRecipientAdmitted } from "./allowlist-recipient-pins.js";
import { validateAssetUsageReservation, assetUsageReservationId } from "./asset-usage-ledger.js";
import { accountBindingHash as nativeAccountBindingHash, validateProviderProfile } from "./provider-profile.js";
import { canonicalProfile } from "./wallet-policy.js";
import { canonicalOperationId } from "./transfer-policy.js";
import { formatAtomic } from "./money.js";
import { pastUnstartedDeadline } from "./unstarted-deadline.js";
import { validateMetaMaskNativeDiagnostic } from "./metamask-native-diagnostic.js";
import { METAMASK_NATIVE_FEE_QUOTE_SCHEMA, METAMASK_NATIVE_FEE_QUOTE_SCHEMA_V2, metaMaskNativeQuoteTransfer, validateMetaMaskNativeFeeQuote, validateMetaMaskNativeFeeReceipt } from "./metamask-native-fee-evidence.js";
const V1 = "apn.metamask-native-operation.v1", V2 = "apn.metamask-native-operation.v2";
const DIRECTORY = "metamask-native-operations";
/** Outcomes after which a native transfer can no longer sign, hand off or land. */
export const METAMASK_NATIVE_RESOLVED_STATES = ["confirmed", "failed_before_effect", "abandoned_unknown"];
const RESOLVED = METAMASK_NATIVE_RESOLVED_STATES;
/** Every state a native transfer journal may hold. */
export const METAMASK_NATIVE_STATES = ["prepared", "failed_before_effect", "effect_started", "acknowledged", "unknown", "confirmed", "abandoned_unknown"];
const STATES = METAMASK_NATIVE_STATES;
const CONTEXT_KEYS = ["profile", "profileHash", "accountBindingHash", "capabilityHash", "profileRevision", "policyDigest", "policyRevision",
    "activationDigest", "vendorPolicyHash", "vendorProjectHash", "quote", "operationId", "consentExpiresAt", "issuedDay"];
export const METAMASK_NATIVE_OPERATION_SCHEMA = V2;
export function metaMaskNativeMfaTask(requestId, evidence, source, now = new Date()) {
    return { requestId, expiresAt: evidence.expiresAt, authMethod: evidence.authMethod, observedAt: now.toISOString(), source, evidenceHash: evidence.evidenceHash };
}
function validateMfaTask(o) {
    const t = o.mfaTask;
    if (t === undefined)
        return;
    if (!isPlainRecord(t) || !exactKeys(t, ["requestId", "expiresAt", "authMethod", "observedAt", "source", "evidenceHash"]) || t.requestId !== o.providerRequestId ||
        o.transactionHash !== null || o.effectAttempts !== 1 || !["unknown", "abandoned_unknown"].includes(o.state) || !(t.expiresAt === null || instant(t.expiresAt)) ||
        !(t.authMethod === null || typeof t.authMethod === "string" && /^[a-z][a-z0-9_-]{0,31}$/u.test(t.authMethod)) || !instant(t.observedAt) ||
        t.observedAt < o.createdAt || !["send", "watch"].includes(t.source) || !digest(t.evidenceHash))
        corrupt("Native transfer MFA task is invalid.");
}
function blocked(message) { throw new ApnError("APN_OPERATION_BLOCKED", message); }
function corrupt(message) { throw new ApnError("APN_STATE_CORRUPT", message); }
const digest = (value) => typeof value === "string" && /^[a-f0-9]{64}$/u.test(value);
const instant = (value) => typeof value === "string" && Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value;
/** Checked against the record's own seal and fields only (R2): a changed constant or a moved APN home never voids it. */
function validateOperation(value) {
    if (!isPlainRecord(value) || !exactKeys(value, ["schemaVersion", "operationId", "requestHash", "context", "reservations", "state", "effectAttempts", "transactionHash", "providerRequestId", "receiptEvidence", "createdAt", "updatedAt", "recordHash", ...(value.diagnostic === undefined ? [] : ["diagnostic"]), ...(value.mfaTask === undefined ? [] : ["mfaTask"])]))
        corrupt("Native transfer journal schema is invalid.");
    const o = value, { recordHash, ...body } = o, v2 = o.schemaVersion === V2, c = o.context;
    if ((o.schemaVersion !== V1 && !v2) || recordHash !== hashObject(body))
        corrupt("Native transfer journal schema is invalid.");
    if (o.diagnostic !== undefined)
        validateMetaMaskNativeDiagnostic(o.diagnostic);
    if (!isPlainRecord(c) || !exactKeys(c, v2 ? CONTEXT_KEYS : ["stateRoot", ...CONTEXT_KEYS]) ||
        (!v2 && (typeof c.stateRoot !== "string" || !c.stateRoot.startsWith("/"))) || !isPlainRecord(c.quote) ||
        c.quote.schemaVersion !== (v2 ? METAMASK_NATIVE_FEE_QUOTE_SCHEMA_V2 : METAMASK_NATIVE_FEE_QUOTE_SCHEMA))
        corrupt("Native transfer immutable owner context is invalid.");
    if (!/^[a-f0-9]{64}$/u.test(o.operationId) || c.operationId !== o.operationId || canonicalProfile(c.profile) !== c.profile ||
        c.profileHash !== sha256(`profile\0${c.profile}`) || typeof c.quote.sender !== "string" ||
        c.accountBindingHash !== nativeAccountBindingHash("metamask-agent-wallet", getAddress(c.quote.sender)) || !STATES.includes(o.state) ||
        // failed_before_effect after the marker is the proven no-spawn outcome (the vendor child never started).
        (o.state === "failed_before_effect" ? o.effectAttempts !== 0 && o.effectAttempts !== 1 : o.effectAttempts !== (o.state === "prepared" ? 0 : 1)) ||
        !Array.isArray(o.reservations) || o.reservations.length > 2 || o.effectAttempts === 1 && o.reservations.length !== 2)
        corrupt("Native transfer journal binding is invalid.");
    if (![o.requestHash, c.profileHash, c.accountBindingHash, c.capabilityHash, c.policyDigest, c.activationDigest, c.vendorPolicyHash, c.vendorProjectHash].every(digest) ||
        !Number.isSafeInteger(c.profileRevision) || c.profileRevision < 1 || !Number.isSafeInteger(c.policyRevision) || c.policyRevision < 1 ||
        !instant(o.createdAt) || !instant(o.updatedAt) || o.updatedAt < o.createdAt || c.issuedDay !== o.createdAt.slice(0, 10) ||
        Date.parse(c.consentExpiresAt) - Date.parse(o.createdAt) > 60000 || Date.parse(c.consentExpiresAt) <= Date.parse(o.createdAt) ||
        !(o.providerRequestId === null || typeof o.providerRequestId === "string" && o.providerRequestId.length > 0 && o.providerRequestId.length <= 1024))
        corrupt("Native transfer immutable owner context is invalid.");
    // Stored quote is authenticated independent of its old consent deadline. Receipt verifier performs complete quote validation.
    const quote = validateMetaMaskNativeFeeQuote(c.quote, new Date(o.createdAt)), transfer = metaMaskNativeQuoteTransfer(quote);
    for (let i = 0; i < o.reservations.length; i++) {
        const r = validateAssetUsageReservation(o.reservations[i]), kind = i === 0 ? "native" : "token";
        if (r.account.toLowerCase() !== quote.sender.toLowerCase() || r.chain !== `eip155:${quote.chainId}` || r.asset.kind !== kind || r.asset.identifier !== (kind === "native" ? null : quote.token) || r.policyDigest !== c.policyDigest ||
            r.amountAtomic !== (kind === "native" ? quote.feeQuote.totalQuoteWei : transfer.amountAtomic) || r.reservationId !== assetUsageReservationId(r, `apn.metamask-native:${o.operationId}:${kind}`) ||
            r.metamaskNativeReservation?.operationId !== o.operationId || r.metamaskNativeReservation?.quoteHash !== quote.quoteHash)
            corrupt("Native transfer journal prior usage hold is invalid.");
    }
    if (o.receiptEvidence !== null) {
        const r = validateMetaMaskNativeFeeReceipt(o.receiptEvidence, quote);
        if (o.state !== "confirmed" || r.transactionHash !== o.transactionHash)
            corrupt("Native transfer journal receipt changed.");
    }
    else if (o.state === "confirmed")
        corrupt("Native transfer confirmed journal has no receipt.");
    if (o.transactionHash !== null && !/^0x[0-9a-f]{64}$/u.test(o.transactionHash))
        corrupt("Native transfer transaction hash is invalid.");
    validateMfaTask(o);
    return o;
}
/**
 * A transfer whose foreground command ended before its effect marker (still `prepared`: nothing was handed off or signed)
 * and whose consent deadline has passed (plus the unstarted margin) can never start: the hand-off needs that consent.
 */
export function metaMaskNativeExpiredBeforeEffect(op, now = Date.now()) {
    return op.state === "prepared" && op.effectAttempts === 0 && pastUnstartedDeadline(op.context.consentExpiresAt, now);
}
/** The family's own terminal rule: a resolved outcome, or a transfer that can never start (closed at its next read). */
export function metaMaskNativeResolved(op, now = Date.now()) {
    return RESOLVED.includes(op.state) || metaMaskNativeExpiredBeforeEffect(op, now);
}
export class MetaMaskNativeJournal extends SecureStateStore {
    async read(id) {
        canonicalOperationId(id);
        const value = await this.readJson(`${DIRECTORY}/${id}.json`);
        if (value === null)
            return null;
        const op = validateOperation(value);
        if (op.operationId !== id)
            corrupt("Native transfer journal name differs from its operation.");
        return op;
    }
    async all() {
        const out = [];
        for (const item of await this.readDirectory(DIRECTORY)) {
            if (!item.isFile() || item.isSymbolicLink() || !/^[a-f0-9]{64}\.json$/u.test(item.name))
                corrupt("Native transfer journal directory is invalid.");
            const op = await this.read(item.name.slice(0, -5));
            if (op === null)
                corrupt("Native transfer journal disappeared.");
            out.push(op);
        }
        return out;
    }
    /** Any other unresolved native transfer of this account and chain, signed or not, holds a new one back. */
    async assertAccountAvailable(chainId, account, exceptId) {
        for (const op of await this.forAccount(chainId, account)) {
            if (op.operationId !== exceptId && !metaMaskNativeResolved(op))
                blocked("Another native transfer for this account and chain is unresolved.");
        }
    }
    /** Every native transfer of this account and chain. */
    async forAccount(chainId, account) {
        return (await this.all()).filter(op => op.context.quote.chainId === chainId && op.context.quote.sender.toLowerCase() === account.toLowerCase());
    }
    async matchingHold(reservation) {
        for (const op of await this.all()) {
            const q = op.context.quote;
            for (const asset of [{ kind: "native", identifier: null }, { kind: "token", identifier: q.token }]) {
                const identity = { account: q.sender, chain: `eip155:${q.chainId}`, asset };
                if (assetUsageReservationId(identity, `apn.metamask-native:${op.operationId}:${asset.kind}`) === reservation.reservationId)
                    return op;
            }
        }
        return null;
    }
    async persist(body) {
        const next = validateOperation({ ...body, recordHash: hashObject(body) }), old = await this.read(next.operationId);
        if (old !== null && (old.schemaVersion !== next.schemaVersion || old.requestHash !== next.requestHash || canonicalJson(old.context) !== canonicalJson(next.context) ||
            old.diagnostic !== undefined && canonicalJson(old.diagnostic) !== canonicalJson(next.diagnostic) || old.createdAt !== next.createdAt || old.effectAttempts > next.effectAttempts || old.transactionHash !== null && old.transactionHash !== next.transactionHash ||
            RESOLVED.includes(old.state)))
            blocked("Native transfer journal cannot replace an existing outcome.");
        await this.ensureDirectory(DIRECTORY);
        await this.writeJson(`${DIRECTORY}/${next.operationId}.json`, next, old === null);
        return next;
    }
}
/** The idempotency fingerprint of a request. Version 1 requests named no recipient or amount; their quote fixes both. */
export function metaMaskNativeRequestHash(request) {
    return hashObject({ chainId: request.chainId, key: request.key, profile: request.profile, recipient: request.recipient, amountAtomic: request.amountAtomic });
}
export function metaMaskNativeRequestMatches(op, request) {
    if (op.schemaVersion === V2)
        return op.requestHash === metaMaskNativeRequestHash(request);
    const transfer = metaMaskNativeQuoteTransfer(op.context.quote);
    return op.requestHash === hashObject({ chainId: request.chainId, key: request.key, profile: request.profile }) &&
        transfer.recipient === request.recipient && transfer.amountAtomic === request.amountAtomic;
}
/** A field given as undefined (the MFA task once the request is past it) leaves the record. */
export function patchMetaMaskNativeOperation(op, fields) {
    const { recordHash: _, ...body } = op, next = { ...body, ...fields, updatedAt: new Date().toISOString() };
    for (const [key, value] of Object.entries(next))
        if (value === undefined)
            delete next[key];
    return next;
}
/** The family's own no-send observer: it reads the stored request or transaction and never signs or sends again. */
export const metaMaskNativeObserveCommand = (id) => `apn wallet metamask native-transfer-observe --operation ${id}`;
const OWNER_CONFIRMS = { social: "from the email registered to your MetaMask dashboard",
    qr: "in MetaMask Mobile" };
/**
 * The owner's open MetaMask approval, beside (never instead of) the financial state: shown while the transfer is unresolved
 * and has no transaction hash. `expired` once its own `expiresAt` has passed; the outcome then comes from observing.
 */
function publicMfaTask(o, now) {
    const t = o.mfaTask;
    if (t === undefined || RESOLVED.includes(o.state) || o.transactionHash !== null)
        return {};
    const expired = t.expiresAt !== null && now.getTime() >= Date.parse(t.expiresAt), observe = metaMaskNativeObserveCommand(o.operationId);
    const how = OWNER_CONFIRMS[t.authMethod ?? ""] ?? "from your paired device or the email registered to your MetaMask dashboard";
    return { mfa_task: { status: expired ? "expired" : "awaiting_owner", provider: "metamask-agent-wallet", provider_state: "AWAITING_MFA",
            request_id: t.requestId, auth_method: t.authMethod, expires_at: t.expiresAt, observed_at: t.observedAt, source: t.source, evidence_hash: t.evidenceHash,
            owner_action: expired
                ? `The MetaMask approval window for request ${t.requestId} closed at ${t.expiresAt}. Observe to read what the provider did; the transfer stays UNKNOWN until the chain proves it, and APN never sends it again.`
                : `Approve MetaMask request ${t.requestId} ${how}${t.expiresAt === null ? "" : ` before ${t.expiresAt}`}. APN never approves it for you and never sends again; then observe.`,
            observe_command: observe } };
}
export function publicMetaMaskNativeOperation(o, now = new Date()) {
    const receipt = o.receiptEvidence === null ? null : validateMetaMaskNativeFeeReceipt(o.receiptEvidence, o.context.quote), transfer = metaMaskNativeQuoteTransfer(o.context.quote);
    // Only an outcome that a no-send observation can still move (a stored request or transaction) names the observer.
    const observable = ["acknowledged", "unknown"].includes(o.state) && (o.transactionHash !== null || o.providerRequestId !== null);
    return { operation_id: o.operationId, state: o.state === "confirmed" && receipt?.transferAccepted === false ? "confirmed_reverted" : o.state, chain_id: o.context.quote.chainId, profile: o.context.profile,
        sender: o.context.quote.sender, recipient: transfer.recipient, token: o.context.quote.token, usdc_atomic: transfer.amountAtomic, usdc: formatAtomic(transfer.amountAtomic, 6),
        maximum_native_fee_atomic: o.context.quote.feeQuote.totalQuoteWei, transaction_hash: o.transactionHash,
        effect_attempts: o.effectAttempts, proof_class: o.state === "confirmed" ? receipt?.transferAccepted ? "canonical_native_fee_transfer" : "canonical_reverted_native_fee" : "durable_public_state",
        ...(o.diagnostic === undefined ? {} : { diagnostic: o.diagnostic }),
        ...(receipt === null ? {} : { receipt }), ...publicMfaTask(o, now),
        next_actions: observable ? [metaMaskNativeObserveCommand(o.operationId)] : [] };
}
export async function metaMaskNativeOperationExists(stateRoot, id) {
    return await new MetaMaskNativeJournal(stateRoot).read(canonicalOperationId(id)) !== null;
}
/** Durable, read-only proof extraction for the common ledger; accepts no DTO as permission. */
export async function readMetaMaskNativeSettlement(stateRoot, id) {
    const op = await new MetaMaskNativeJournal(stateRoot).read(id);
    if (op === null || op.state !== "confirmed" || op.effectAttempts !== 1 || op.receiptEvidence === null || op.transactionHash === null)
        blocked("Native transfer authentic canonical settlement is absent.");
    const receipt = validateMetaMaskNativeFeeReceipt(op.receiptEvidence, op.context.quote);
    if (receipt.transactionHash !== op.transactionHash)
        blocked("Native transfer settlement hash changed.");
    return { operationId: op.operationId, policyDigest: op.context.policyDigest, reservations: op.reservations, receipt,
        tokenAmountAtomic: metaMaskNativeQuoteTransfer(op.context.quote).amountAtomic,
        proof: { kind: "metamask_native_actual_fee", operationId: op.operationId, quoteHash: op.context.quote.quoteHash, receiptHash: hashObject(op.receiptEvidence),
            actualFee: receipt.nativeFeeAtomic, reservedFee: op.context.quote.feeQuote.totalQuoteWei } };
}
export async function assertMetaMaskNativeFailedBeforeEffect(stateRoot, id) {
    const op = await new MetaMaskNativeJournal(stateRoot).read(id);
    if (op === null || op.state !== "failed_before_effect")
        blocked("MetaMask capacity release requires durable no-private-effect outcome.");
}
/** Existing-only durable guard also protects a hold whose public marker was removed. */
export async function assertMetaMaskNativeGenericCapacityRelease(stateRoot, value) {
    const reservation = validateAssetUsageReservation(value), op = await new MetaMaskNativeJournal(stateRoot).matchingHold(reservation);
    if (op === null) {
        if (reservation.metamaskNativeReservation !== undefined)
            blocked("MetaMask hold has no authentic normal owner journal.");
        return;
    }
    if (op.state !== "failed_before_effect")
        blocked("MetaMask native hold requires canonical normal-owner settlement.");
}
/** The profile's bound MetaMask provider custody and its active owner policy, whose EVM account must be that custody. */
export async function loadMetaMaskNativeOwner(state, profileName) {
    const name = canonicalProfile(profileName), value = await state.loadProviderProfile(state.profileHash(name));
    if (value === null)
        blocked("MetaMask provider profile is absent.");
    const profile = validateProviderProfile(value), policy = activeAssetPolicyFromState(await new AllowlistPolicyStore(state.root).readUnderProfileLock(name), new Date());
    if (profile.profile !== name || profile.profile_hash !== state.profileHash(name) ||
        profile.provider_id !== "metamask-agent-wallet" || profile.drift.state !== "bound" || profile.drift.reason !== "none" ||
        policy === null || policy.accounts.evm?.toLowerCase() !== profile.public_address.toLowerCase())
        blocked("MetaMask custody or owner policy is unavailable.");
    return { profile, policy };
}
/** Existing normal journal only; no caller quote, policy or approval is admitted. The reservation re-checks the recipient pin. */
export async function readMetaMaskNativeReservation(stateRoot, id) {
    const op = await new MetaMaskNativeJournal(stateRoot).read(id);
    if (op === null || op.effectAttempts !== 0 || op.state !== "prepared")
        blocked("MetaMask native reservation requires untouched normal journal.");
    const current = await loadMetaMaskNativeOwner(new StateStore(stateRoot), op.context.profile);
    if (current.policy.activationDigest !== op.context.activationDigest || current.profile.revision !== op.context.profileRevision || current.profile.account_binding_hash !== op.context.accountBindingHash)
        blocked("MetaMask reserve current owner changed.");
    const quote = validateMetaMaskNativeFeeQuote(op.context.quote, new Date()), transfer = metaMaskNativeQuoteTransfer(quote), at = new Date().toISOString();
    assertRecipientAdmitted({ admission: evaluateAssetPolicy(current.policy.registry, { chain: `eip155:${quote.chainId}`, asset: { kind: "token", identifier: quote.token }, rail: "direct",
            amountAtomic: transfer.amountAtomic, dailyUsageAtomic: "0", asOfDate: at.slice(0, 10), asOf: at }), recipient: transfer.recipient });
    return { operationId: id, quote, registry: current.policy.registry, tokenAmountAtomic: transfer.amountAtomic };
}
//# sourceMappingURL=metamask-native-journal.js.map