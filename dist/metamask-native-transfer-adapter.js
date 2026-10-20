import { metaMaskGuardPolicyAdmits } from "./metamask-native-policy.js";
import { getAddress } from "viem";
import { nativeDeadlineRemaining, validateMetaMaskNativeDiagnostic } from "./metamask-native-diagnostic.js";
import { isPlainRecord, sha256 } from "./canonical.js";
import { ApnError } from "./errors.js";
import { NodeMetaMaskProcessRunner, takeMetaMaskNativeProcessFailureIdentifiers, takeMetaMaskNativeProcessFailureDiagnostic } from "./metamask-process-runner.js";
import { resolveMetaMaskBin } from "./metamask-package.js";
import { parseMetaMaskProcessOutput, classifyMetaMaskPendingNotices, metaMaskMfaNotice } from "./metamask-process-output.js";
import { isMetaMaskEvmNamespace } from "./metamask-namespace.js";
import { METAMASK_NATIVE_CHAINS, metaMaskNativeQuoteTransfer, validateMetaMaskNativeFeeQuote } from "./metamask-native-fee-evidence.js";
import { claimMetaMaskNativeOwnedScope, assertMetaMaskNativeOwnedScope, assertMetaMaskNativeOwnedContextCurrent } from "./metamask-native-transfer-owner.js";
// Read at call time: this module sits in an import cycle with the owner, so no imported value is used at load.
const nativeChain = (value) => METAMASK_NATIVE_CHAINS.includes(value);
const EFFECT_STATES = new Set(["EVALUATING", "AWAITING_MFA", "SIGNING", "BROADCASTING"]);
class NativeReadRefusal extends ApnError {
    nativeDiagnostic;
    constructor(nativeDiagnostic) {
        super("APN_OPERATION_BLOCKED", "The MetaMask Agent Wallet did not confirm the paying wallet, Guard mode or policy.");
        this.nativeDiagnostic = nativeDiagnostic;
    }
}
function refuse(diagnostic) {
    if (diagnostic !== undefined)
        throw new NativeReadRefusal(diagnostic);
    throw new ApnError("APN_OPERATION_BLOCKED", "The MetaMask Agent Wallet did not confirm the paying wallet, Guard mode or policy.");
}
function chain(value) {
    if (!nativeChain(value))
        refuse();
}
function success(result) {
    const parsed = parseMetaMaskProcessOutput(result.stdout), envelope = parsed?.envelope;
    if (result.exitCode !== 0 || parsed === null || parsed.notices.length !== 0 || envelope?.ok !== true || !isPlainRecord(envelope.data))
        refuse(result.nativeDiagnostic === undefined ? undefined : validateMetaMaskNativeDiagnostic({ ...result.nativeDiagnostic, code: result.exitCode === 0 ? "protocol" : result.nativeDiagnostic.code }));
    return envelope.data;
}
function remaining(deadline) {
    if (deadline === undefined)
        return undefined;
    return nativeDeadlineRemaining(deadline);
}
async function project(runner, deadline) {
    const result = await runner.runJson(["auth", "status", "--json"], remaining(deadline), deadline);
    try {
        const data = success(result);
        if (data.authenticated !== true || !isPlainRecord(data.summary) || data.summary.mode !== "session" ||
            typeof data.summary.projectId !== "string" || !/^[A-Za-z0-9._:-]{1,256}$/u.test(data.summary.projectId))
            refuse();
        return sha256(data.summary.projectId);
    }
    finally {
        result.stdout.fill(0);
    }
}
/**
 * Three vendor reads (PROV-12): the session project, then Guard trading mode and the policy of the selected server
 * wallet. Both wallet reads report the selected address, so a separate address read before and after adds nothing.
 */
async function readPolicy(runner, expected, deadline) {
    const vendorProjectHash = await project(runner, deadline), payer = expected.payer.toLowerCase();
    const mode = await runner.runJson(["wallet", "trading-mode", "get", "--json"], remaining(deadline), deadline);
    try {
        const data = success(mode);
        if (data.mode !== "guard" || typeof data.address !== "string" || data.address.toLowerCase() !== payer)
            refuse();
    }
    finally {
        mode.stdout.fill(0);
    }
    const result = await runner.runJson(["wallet", "policy", "get", "--json"], remaining(deadline), deadline);
    let admitted;
    try {
        const data = success(result);
        if (typeof data.address !== "string" || data.address.toLowerCase() !== payer || typeof data.policy !== "string")
            refuse();
        // OD-4: the policy must name this wallet, allowlist this recipient on this chain and carry an outflow limit.
        admitted = { vendorPolicyHash: sha256(data.policy), ...metaMaskGuardPolicyAdmits(data.policy, expected) };
    }
    finally {
        result.stdout.fill(0);
    }
    return Object.freeze({ selectedAddress: getAddress(expected.payer), vendorProjectHash, ...admitted, tradingMode: "guard", observedAt: new Date().toISOString() });
}
/** Normal vendor CLI reads only; no policy mutation or remote rolling-usage prediction. */
export async function readMetaMaskNativeVendorPolicy(chainId, payer, recipient, deadline) {
    chain(chainId);
    return await readPolicy(new NodeMetaMaskProcessRunner(), { payer: getAddress(payer), chainId, recipient: getAddress(recipient) }, deadline);
}
const quantity = (value) => `0x${BigInt(value).toString(16)}`;
/** A failure before the vendor child process was spawned: nothing was handed to the vendor. */
export class MetaMaskNativeHandoffNotStarted extends Error {
    causeError;
    constructor(causeError) {
        super("MetaMask native handoff did not start.");
        this.causeError = causeError;
    }
}
/** Owner alone persists the one-effect handoff marker before this statically bound call. */
export async function submitOwnedMetaMaskNative(scope, context) {
    let prepared;
    // Every check that can fail runs before the child process is spawned (R3); its failure proves no handoff.
    try {
        prepared = await prepareNativeHandoff(scope, context);
    }
    catch (error) {
        throw new MetaMaskNativeHandoffNotStarted(error);
    }
    const { deadline, quote, handoffRunner, payload } = prepared;
    // EIP-1559 fees force the ordinary type2 path; the normal parser accepts no authorization list.
    let result;
    try {
        const transfer = metaMaskNativeQuoteTransfer(quote);
        result = await handoffRunner.runJson(["wallet", "send-transaction", "--chain-id", String(quote.chainId), "--payload", payload,
            "--intent", `APN ${context.operationId}: ${transfer.amountAtomic} atomic USDC to ${transfer.recipient}`, "--json"], nativeDeadlineRemaining(deadline), deadline);
    }
    catch (error) {
        const diagnostic = takeMetaMaskNativeProcessFailureDiagnostic(error);
        const observed = takeMetaMaskNativeProcessFailureIdentifiers(error);
        const bound = observed !== undefined && (observed.sender === undefined || observed.sender === quote.sender.toLowerCase()) &&
            (observed.chainId === undefined || observed.chainId === quote.chainId) &&
            (observed.vendorProjectHash === undefined || observed.vendorProjectHash === context.vendorProjectHash);
        // Rejection remains UNKNOWN even when the real failed child emitted a recoverable identifier.
        return { disposition: "unknown", reason: "provider_private_handoff_outcome_unknown", ...(diagnostic === undefined ? {} : { diagnostic }),
            ...(bound && observed.transactionHash !== undefined ? { transactionHash: observed.transactionHash } : {}),
            ...(bound && observed.requestId !== undefined ? { requestId: observed.requestId, ...(observed.mfa === undefined ? {} : { mfa: observed.mfa }) } : {}) };
    }
    // The effect has happened: no guard runs after it. The pre-send guard required the quote nonce to be the pending
    // nonce, so re-running it after a broadcast (nonce + 1) turned every successful send into an unknown outcome. The
    // durable effect marker and the stored hash or request id are the guards from here on.
    let hint;
    try {
        hint = submissionHint(result, quote.sender);
    }
    finally {
        result.stdout.fill(0);
    }
    return { ...hint, ...(result.nativeDiagnostic === undefined ? {} : { diagnostic: result.nativeDiagnostic }) };
}
/** Everything before the vendor child process: claim, policy, resolver, last owner guard and the exact payload. */
async function prepareNativeHandoff(scope, context) {
    claimMetaMaskNativeOwnedScope(scope, context);
    const deadline = assertMetaMaskNativeOwnedScope(scope, context);
    nativeDeadlineRemaining(deadline);
    const quote = validateMetaMaskNativeFeeQuote(context.quote);
    chain(quote.chainId);
    // Finish package validation before the last owner/deadline check, so a slow resolver cannot move the private handoff past it.
    nativeDeadlineRemaining(deadline);
    let resolverTimer;
    let executable;
    try {
        executable = await Promise.race([resolveMetaMaskBin(), new Promise((_, reject) => {
                resolverTimer = setTimeout(() => reject(new ApnError("APN_OPERATION_BLOCKED", "Native SDK resolver deadline reached.")), nativeDeadlineRemaining(deadline));
            })]);
    }
    finally {
        if (resolverTimer !== undefined)
            clearTimeout(resolverTimer);
    }
    assertMetaMaskNativeOwnedScope(scope, context);
    nativeDeadlineRemaining(deadline);
    const handoffRunner = new NodeMetaMaskProcessRunner(async () => executable);
    await assertMetaMaskNativeOwnedContextCurrent(scope, context);
    assertMetaMaskNativeOwnedScope(scope, context);
    const t = quote.transaction;
    const payload = JSON.stringify({ to: t.to, data: t.data, value: "0x0", gas: quantity(t.gasLimitAtomic),
        nonce: quantity(t.nonceAtomic), maxFeePerGas: quantity(t.maxFeePerGasAtomic),
        maxPriorityFeePerGas: quantity(t.maxPriorityFeePerGasAtomic) });
    return { deadline, quote, handoffRunner, payload };
}
function readDiagnostic(value) {
    try {
        return validateMetaMaskNativeDiagnostic(value);
    }
    catch {
        return null;
    }
}
/**
 * Normal status READ only (three vendor processes): the session project before, the watch, the project after. The owner
 * supplies the request id and project hash from its authentic journal; a service hint is never chain evidence, so no
 * policy is read around it.
 */
export async function readMetaMaskNativeRequest(requestId, vendorProjectHash) {
    const observation = { stage: "input", guard_step: null, request_id: null, watch_returned: false,
        before_guard_verified: false, after_guard_verified: false, request_identity_verified: false, provider_status: null,
        transaction_hash: null, chain_id: null, response_hash: null, reason: null, error_code: null, diagnostic: null };
    const observed = (hint) => {
        observation.transaction_hash = "transactionHash" in hint ? hint.transactionHash ?? null : null;
        observation.chain_id = hint.chainId ?? null;
        observation.reason = hint.disposition === "unknown" ? hint.reason : null;
        return { ...hint, readObservation: Object.freeze({ ...observation }) };
    };
    if (!/^[A-Za-z0-9._:-]{1,256}$/u.test(requestId) || !/^[a-f0-9]{64}$/u.test(vendorProjectHash))
        return observed({ disposition: "unknown", reason: "provider_request_binding_invalid" });
    observation.request_id = requestId;
    const runner = new NodeMetaMaskProcessRunner();
    let hint = { disposition: "unknown", reason: "provider_request_read_unavailable", requestId };
    try {
        observation.stage = "before_guard";
        observation.guard_step = "project_before";
        if (await project(runner) !== vendorProjectHash)
            refuse();
        observation.before_guard_verified = true;
        observation.stage = "watch";
        observation.guard_step = null;
        const result = await runner.runJson(["wallet", "requests", "watch", requestId, "--wallet-timeout", "1", "--json"], 6_000);
        observation.watch_returned = true;
        try {
            observation.response_hash = sha256(result.stdout);
            observation.diagnostic = result.nativeDiagnostic === undefined ? null : readDiagnostic(result.nativeDiagnostic);
            hint = requestHint(result, requestId, observation);
        }
        finally {
            result.stdout.fill(0);
        }
        observation.stage = "after_guard";
        observation.guard_step = "project_after";
        if (await project(runner) !== vendorProjectHash)
            refuse();
        observation.after_guard_verified = true;
        observation.stage = "complete";
        observation.guard_step = null;
        return observed(hint);
    }
    catch (error) {
        observation.error_code = error instanceof ApnError && ["APN_OPERATION_BLOCKED", "APN_PROVIDER_PROTOCOL", "APN_PROVIDER_UNAVAILABLE", "APN_STATE_CORRUPT"].includes(error.code)
            ? error.code : "unavailable";
        const diagnostic = error instanceof NativeReadRefusal ? error.nativeDiagnostic : takeMetaMaskNativeProcessFailureDiagnostic(error);
        observation.diagnostic = diagnostic === undefined ? observation.diagnostic : readDiagnostic(diagnostic);
        return observed({ disposition: "unknown", reason: "provider_request_read_guard_changed_or_unavailable", requestId,
            ...("transactionHash" in hint && hint.transactionHash !== undefined ? { transactionHash: hint.transactionHash } : {}),
            ...(hint.chainId === undefined ? {} : { chainId: hint.chainId }) });
    }
}
function requestHint(result, requestId, observation) {
    const parsed = parseMetaMaskProcessOutput(result.stdout);
    const unknown = (reason) => ({ disposition: "unknown", reason, requestId });
    if (parsed === null)
        return unknown("provider_response_malformed");
    const notice = classifyMetaMaskPendingNotices(parsed.notices, requestId);
    if (notice.disposition === "invalid")
        return unknown("provider_request_identity_conflict");
    const data = parsed.envelope?.data, mfa = () => ({ ...(notice.disposition === "pending" ? metaMaskMfaNotice(parsed.notices)
            : { expiresAt: null, authMethod: null }), evidenceHash: observation.response_hash });
    // Notice only: the watch ended (6.1.5 writes its `_error` to stderr) while the provider still waits for the owner's
    // approval of this very request (the notice names it). That is the whole answer: an MFA task, no outcome, no hash.
    if (parsed.envelope === null) {
        if (notice.disposition !== "pending")
            return unknown("provider_request_evidence_missing");
        observation.provider_status = "AWAITING_MFA";
        return { disposition: "pending", requestId, mfa: mfa() };
    }
    if (!isPlainRecord(data) || !isPlainRecord(data.request) || !isPlainRecord(data.status))
        return unknown("provider_request_evidence_missing");
    const request = data.request, status = data.status;
    if (request.pollingId !== requestId || request.kind !== "transaction" || !isMetaMaskEvmNamespace(request.namespace))
        return unknown("provider_request_identity_conflict");
    const chainId = request.chainId;
    if (chainId !== undefined && (typeof chainId !== "number" || !nativeChain(chainId)))
        return unknown("provider_request_chain_unsupported");
    const chainHint = chainId === undefined ? {} : { chainId: chainId };
    const hash = (value) => typeof value === "string" && /^0x[a-fA-F0-9]{64}$/u.test(value) ? value.toLowerCase() : undefined;
    const requestHash = hash(request.txHash), statusHash = hash(status.txHash);
    if ((request.txHash !== undefined && request.txHash !== null && requestHash === undefined) ||
        (status.txHash !== undefined && status.txHash !== null && statusHash === undefined))
        return unknown("provider_transaction_identity_invalid");
    if (requestHash !== undefined && statusHash !== undefined && requestHash !== statusHash)
        return unknown("provider_transaction_identity_conflict");
    const transactionHash = statusHash ?? requestHash;
    observation.request_identity_verified = true;
    const states = ["EVALUATING", "AWAITING_MFA", "SIGNING", "BROADCASTING", "CONFIRMED", "FAILED", "EXPIRED", "DENIED", "APPROVED", "SIGNED", "CANCELLED"];
    observation.provider_status = typeof status.status === "string" && states.includes(status.status)
        ? status.status : typeof status.status === "string" ? "unrecognized" : null;
    if (result.exitCode !== 0 || parsed.envelope?.ok !== true)
        return { disposition: "unknown", reason: "provider_request_outcome_unknown", requestId, ...chainHint,
            ...(transactionHash === undefined ? {} : { transactionHash }) };
    if (transactionHash !== undefined)
        return { disposition: "acknowledged", transactionHash, requestId, ...chainHint };
    if (typeof status.status === "string" && EFFECT_STATES.has(status.status))
        return { disposition: "pending", requestId, ...chainHint, ...(status.status === "AWAITING_MFA" ? { mfa: mfa() } : {}) };
    return { disposition: "unknown", reason: "provider_request_outcome_unknown", requestId, ...chainHint };
}
function submissionHint(result, expectedPayer) {
    const parsed = parseMetaMaskProcessOutput(result.stdout);
    if (parsed === null)
        return { disposition: "unknown", reason: "provider_response_malformed" };
    const notice = classifyMetaMaskPendingNotices(parsed.notices);
    const data = parsed.envelope?.data;
    const transactionHash = isPlainRecord(data) && typeof data.hash === "string" && /^0x[a-fA-F0-9]{64}$/u.test(data.hash)
        ? data.hash.toLowerCase() : undefined;
    const requestId = isPlainRecord(data) && typeof data.pollingId === "string" && /^[A-Za-z0-9._:-]{1,256}$/u.test(data.pollingId)
        ? data.pollingId : notice.disposition === "pending" ? notice.recoveryToken : undefined;
    // The owner's approval the provider waits on, for this very request only: a notice naming it or its AWAITING_MFA status,
    // with no hash and no other sender. It is kept beside an UNKNOWN or pending outcome, never in place of one.
    const sender = !isPlainRecord(data) || data.mode === "server" && typeof data.address === "string" && data.address.toLowerCase() === expectedPayer.toLowerCase();
    const latest = isPlainRecord(data) && typeof data.status === "string" ? data.status : undefined;
    const awaiting = latest === undefined ? notice.disposition === "pending" && notice.recoveryToken === requestId : latest === "AWAITING_MFA";
    const task = requestId !== undefined && transactionHash === undefined && sender && awaiting ? { mfa: { ...(notice.disposition === "pending"
                ? metaMaskMfaNotice(parsed.notices) : { expiresAt: null, authMethod: null }), evidenceHash: sha256(result.stdout) } } : {};
    const unknown = (reason, withTask = false) => ({ disposition: "unknown", reason,
        ...(transactionHash === undefined ? {} : { transactionHash }), ...(requestId === undefined ? {} : { requestId }), ...(withTask ? task : {}) });
    if (notice.disposition === "invalid" || (notice.disposition === "pending" && requestId !== notice.recoveryToken))
        return unknown("provider_identity_conflict");
    if (result.exitCode !== 0)
        return unknown("provider_private_handoff_outcome_unknown", true);
    if (parsed.envelope?.ok === true && isPlainRecord(data)) {
        if (!sender)
            return unknown("provider_sender_mismatch");
        if (transactionHash !== undefined)
            return { disposition: "acknowledged", transactionHash };
        if (requestId !== undefined && typeof data.status === "string" && EFFECT_STATES.has(data.status))
            return { disposition: "pending", requestId, ...task };
    }
    if (notice.disposition === "pending" && parsed.envelope === null)
        return { disposition: "pending", requestId: notice.recoveryToken, ...task };
    return unknown("provider_private_handoff_outcome_unknown", true);
}
//# sourceMappingURL=metamask-native-transfer-adapter.js.map