import { metaMaskGuardPolicyAdmits } from "./metamask-native-policy.js";
import { performance } from "node:perf_hooks";
import { getAddress } from "viem";
import { nativeDeadlineRemaining, validateMetaMaskNativeDiagnostic } from "./metamask-native-diagnostic.js";
import { isPlainRecord, sha256 } from "./canonical.js";
import { ApnError } from "./errors.js";
import { NodeMetaMaskProcessRunner, takeMetaMaskNativeProcessFailureDiagnostic } from "./metamask-process-runner.js";
import { metaMaskCommand } from "./metamask-command.js";
import { parseMetaMaskProcessOutput, classifyMetaMaskPendingNotices, metaMaskMfaNotice, metaMaskWatchMissReason } from "./metamask-process-output.js";
import { readMetaMaskNativeServerRequest } from "./metamask-native-request-server-read.js";
import { metaMaskServerTransaction, sendMetaMaskServerTransaction } from "./metamask-server-transaction.js";
import { metaMaskNativeSdkSubmission } from "./metamask-native-sdk-submission.js";
import { isMetaMaskEvmNamespace } from "./metamask-namespace.js";
import { METAMASK_NATIVE_CHAINS, metaMaskNativeQuoteTransfer, validateMetaMaskNativeFeeQuote } from "./metamask-native-fee-evidence.js";
import { claimMetaMaskNativeOwnedScope, assertMetaMaskNativeOwnedScope, assertMetaMaskNativeOwnedContextCurrent, metaMaskNativeOwnedRequestId } from "./metamask-native-transfer-owner.js";
// Read at call time: this module sits in an import cycle with the owner, so no imported value is used at load.
const nativeChain = (value) => METAMASK_NATIVE_CHAINS.includes(value);
const EFFECT_STATES = new Set(["EVALUATING", "AWAITING_MFA", "SIGNING", "BROADCASTING"]);
const REFUSALS = {
    metamask_native_chain_unsupported: { message: "MetaMask native transfers do not support this chain.", nextActions: () => [] },
    metamask_vendor_read_failed: { message: "The MetaMask Agent Wallet did not answer a read of its session, Guard mode or policy.",
        nextActions: ({ read }) => [`mm ${READ_ARGS[read ?? "auth status"].join(" ")}`] },
    metamask_session_required: { message: "The MetaMask Agent Wallet has no signed-in session; sign in again.",
        nextActions: ({ profile }) => profile === undefined ? [] : [`apn wallet connect --profile ${profile} --provider metamask-agent-wallet --auth-method browser`] },
    metamask_session_project_changed: { message: "The MetaMask Agent Wallet is signed in to another project than this transfer was quoted in.", nextActions: () => [] },
    // The vendor reports a failed mode read as null too, so "unreported" names both: read it, then set Guard mode.
    metamask_guard_mode_required: { message: "The MetaMask server wallet did not report Guard mode (it is unset, another mode, or unreadable); " +
            "set Guard mode, approve the MetaMask email, then rerun.", nextActions: () => ["mm wallet trading-mode get --json", "mm wallet trading-mode set guard"] },
    metamask_wallet_mismatch: { message: "The MetaMask Agent Wallet has another wallet selected than the paying profile; select the paying wallet.",
        nextActions: ({ payer }) => payer === undefined ? [] : [`mm wallet select ${payer}`] },
    // The vendor reports no policy and a failed policy read alike, as an empty policy.
    metamask_guard_policy_missing: { message: "The MetaMask Agent Wallet reported no Guard policy for the paying wallet (none is set, or its read failed); " +
            "set one with `mm wallet policy set --policy <yaml>` (the template shows the form), then rerun.",
        nextActions: () => ["mm wallet policy get --json", "mm wallet policy template"] },
};
const MODES = new Set(["guard", "beast"]);
class NativeReadRefusal extends ApnError {
    nativeDiagnostic;
    constructor(nativeDiagnostic, code, message, details) {
        super(code, message, details);
        this.nativeDiagnostic = nativeDiagnostic;
    }
}
function refuse(reason, facts = {}, who = {}, diagnostic) {
    const details = { ...facts, reason, nextActions: REFUSALS[reason].nextActions(who) };
    if (diagnostic !== undefined)
        throw new NativeReadRefusal(diagnostic, "APN_OPERATION_BLOCKED", REFUSALS[reason].message, details);
    throw new ApnError("APN_OPERATION_BLOCKED", REFUSALS[reason].message, details);
}
/**
 * The refusal with each `mm …` step written as the pinned client run by APN's own Node: Homebrew links only `apn`, so a
 * bare `mm` is not on the owner's PATH (the policy refusals of metamask-native-policy.ts included).
 */
async function runnable(error) {
    const actions = error instanceof ApnError ? error.details?.nextActions : undefined;
    if (!(error instanceof ApnError) || !Array.isArray(actions) || !actions.some(action => action.startsWith("mm ")))
        return error;
    let prefix;
    try {
        prefix = `${await metaMaskCommand()} `;
    }
    catch {
        return error;
    }
    const details = { ...error.details, nextActions: actions.map(action => action.startsWith("mm ") ? prefix + action.slice(3) : action) };
    return error instanceof NativeReadRefusal ? new NativeReadRefusal(error.nativeDiagnostic, error.code, error.message, details)
        : new ApnError(error.code, error.message, details);
}
function chain(value) {
    if (!nativeChain(value))
        refuse("metamask_native_chain_unsupported");
}
function success(result, read, who = {}) {
    const parsed = parseMetaMaskProcessOutput(result.stdout), envelope = parsed?.envelope;
    if (result.exitCode !== 0 || parsed === null || parsed.notices.length !== 0 || envelope?.ok !== true || !isPlainRecord(envelope.data))
        refuse("metamask_vendor_read_failed", { failedRead: read }, { ...who, read }, result.nativeDiagnostic === undefined ? undefined : validateMetaMaskNativeDiagnostic({ ...result.nativeDiagnostic, code: result.exitCode === 0 ? "protocol" : result.nativeDiagnostic.code }));
    return envelope.data;
}
function remaining(deadline) {
    if (deadline === undefined)
        return undefined;
    return nativeDeadlineRemaining(deadline);
}
const READ_ARGS = { "auth status": ["auth", "status", "--json"],
    "trading-mode get": ["wallet", "trading-mode", "get", "--json"], "policy get": ["wallet", "policy", "get", "--json"] };
/**
 * One vendor read. A read the runner itself failed (a timeout,
 * the deadline, a start or protocol failure) keeps its code, message and retry advice, and names the failed read and
 * the runner's own failure class. Only a read whose vendor process ran and failed other than by the deadline also
 * offers that read to run by hand; a client that did not resolve or a passed deadline keeps the error's own advice.
 */
async function vendorRead(runner, read, deadline) {
    const timeoutMs = remaining(deadline);
    try {
        return await runner.runJson(READ_ARGS[read], timeoutMs, deadline);
    }
    catch (error) {
        if (!(error instanceof ApnError))
            throw error;
        const diagnostic = takeMetaMaskNativeProcessFailureDiagnostic(error);
        const byHand = diagnostic?.stage === "sdk_read" && diagnostic.code !== "deadline";
        const details = { ...error.details, reason: "metamask_vendor_read_failed", failedRead: read, readFailure: diagnostic?.code ?? "unclassified",
            ...(byHand ? { nextActions: [`mm ${READ_ARGS[read].join(" ")}`] } : {}) };
        throw diagnostic === undefined ? new ApnError(error.code, error.message, details) : new NativeReadRefusal(diagnostic, error.code, error.message, details);
    }
}
async function project(runner, deadline, who = {}) {
    const result = await vendorRead(runner, "auth status", deadline);
    try {
        const data = success(result, "auth status", who);
        if (data.authenticated !== true || !isPlainRecord(data.summary) || data.summary.mode !== "session" ||
            typeof data.summary.projectId !== "string" || !/^[A-Za-z0-9._:-]{1,256}$/u.test(data.summary.projectId))
            refuse("metamask_session_required", {}, who);
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
async function readPolicy(runner, expected, deadline, profile) {
    const payer = expected.payer.toLowerCase(), who = { ...(profile === undefined ? {} : { profile }), payer: expected.payer };
    const vendorProjectHash = await project(runner, deadline, who);
    const selected = (address) => {
        if (typeof address !== "string" || address.toLowerCase() !== payer)
            refuse("metamask_wallet_mismatch", {}, who);
    };
    const mode = await vendorRead(runner, "trading-mode get", deadline);
    try {
        const data = success(mode, "trading-mode get", who);
        selected(data.address);
        // A new MetaMask project (a sign-in that created one) starts with no trading mode, which the vendor reports as null.
        if (data.mode !== "guard")
            refuse("metamask_guard_mode_required", { observedTradingMode: data.mode === null || data.mode === undefined ? "unreported" : typeof data.mode === "string" && MODES.has(data.mode) ? data.mode : "unrecognized" }, who);
    }
    finally {
        mode.stdout.fill(0);
    }
    const result = await vendorRead(runner, "policy get", deadline);
    let admitted;
    try {
        const data = success(result, "policy get", who);
        selected(data.address);
        if (typeof data.policy !== "string" || data.policy.trim() === "")
            refuse("metamask_guard_policy_missing", {}, who);
        // OD-4: the policy must name this wallet, allowlist this recipient on this chain and carry an outflow limit.
        admitted = { vendorPolicyHash: sha256(data.policy), ...metaMaskGuardPolicyAdmits(data.policy, expected) };
    }
    finally {
        result.stdout.fill(0);
    }
    return Object.freeze({ selectedAddress: getAddress(expected.payer), vendorProjectHash, ...admitted, tradingMode: "guard", observedAt: new Date().toISOString() });
}
/** Normal vendor CLI reads only; no policy mutation or remote rolling-usage prediction. */
export async function readMetaMaskNativeVendorPolicy(chainId, payer, recipient, deadline, profile) {
    chain(chainId);
    try {
        return await readPolicy(new NodeMetaMaskProcessRunner(), { payer: getAddress(payer), chainId, recipient: getAddress(recipient) }, deadline, profile);
    }
    catch (error) {
        throw await runnable(error);
    }
}
const quantity = (value) => `0x${BigInt(value).toString(16)}`;
/** A failure before the sandboxed helper was spawned: nothing was handed to MetaMask. */
export class MetaMaskNativeHandoffNotStarted extends Error {
    causeError;
    constructor(causeError) {
        super("MetaMask native handoff did not start.");
        this.causeError = causeError;
    }
}
/**
 * Owner alone seals the request id and persists the one-effect handoff marker naming its hash before this statically
 * bound call. The request goes out once, from mm's own signed-in session, through the sandboxed MetaMask helper the
 * gasless lane uses (metamask-server-transaction.ts): the very request `mm wallet send-transaction` sent for the same
 * payload and intent, with APN's own id in place of the one mm would have generated.
 */
export async function submitOwnedMetaMaskNative(scope, context) {
    let prepared;
    // Every check that can fail runs before the helper process is spawned (R3); its failure proves no handoff.
    try {
        prepared = await prepareNativeHandoff(scope, context);
    }
    catch (error) {
        throw new MetaMaskNativeHandoffNotStarted(error);
    }
    // The effect may happen from here: no guard runs after it. The pre-send guard required the quote nonce to be the
    // pending nonce, so re-running it after a broadcast (nonce + 1) turned every successful send into an unknown outcome.
    // The durable effect marker and the sealed request id are the guards from here on.
    const startedAt = performance.now();
    const outcome = await sendMetaMaskServerTransaction(prepared.transaction, prepared.timeoutMs);
    return metaMaskNativeSdkSubmission(outcome, startedAt, prepared.deadline);
}
/** Everything before the helper process: claim, the exact request with its sealed id, the last owner guard and the timeout. */
async function prepareNativeHandoff(scope, context) {
    claimMetaMaskNativeOwnedScope(scope, context);
    const deadline = assertMetaMaskNativeOwnedScope(scope, context);
    nativeDeadlineRemaining(deadline);
    const quote = validateMetaMaskNativeFeeQuote(context.quote);
    chain(quote.chainId);
    const t = quote.transaction, transfer = metaMaskNativeQuoteTransfer(quote);
    // The payload 0.5.107 handed `mm wallet send-transaction`; EIP-1559 fees force the ordinary type-2 request. The helper
    // lets the POST leave only before the consent deadline.
    const transaction = metaMaskServerTransaction({ requestId: metaMaskNativeOwnedRequestId(scope, context), projectHash: context.vendorProjectHash,
        from: quote.sender, chainId: quote.chainId, intent: `APN ${context.operationId}: ${transfer.amountAtomic} atomic USDC to ${transfer.recipient}`,
        expiresAt: deadline.utcExpiresAt,
        payload: { to: t.to, data: t.data, value: "0x0", gas: quantity(t.gasLimitAtomic), nonce: quantity(t.nonceAtomic),
            maxFeePerGas: quantity(t.maxFeePerGasAtomic), maxPriorityFeePerGas: quantity(t.maxPriorityFeePerGasAtomic) } });
    await assertMetaMaskNativeOwnedContextCurrent(scope, context);
    assertMetaMaskNativeOwnedScope(scope, context);
    // The helper is killed at the consent deadline, as the vendor child was.
    return { deadline, transaction, timeoutMs: nativeDeadlineRemaining(deadline) };
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
 * policy is read around it. When the watch answers that mm's own local request list no longer holds the request (a
 * new `mm login` starts that list empty) and the owner supplies the transfer's sender and chain, the request is read
 * once from MetaMask's server instead, inside the same project bracket; that read never sends, signs or approves.
 * This is the read of a request `mm wallet send-transaction` sent (a record 0.5.107 or earlier wrote).
 */
export async function readMetaMaskNativeRequest(requestId, vendorProjectHash, binding) {
    return await readRequest(requestId, vendorProjectHash, binding === undefined ? { source: "watch" } : { source: "watch", binding });
}
/**
 * The read of a request APN sent itself through the helper (0.5.108 and later): mm's local request list never holds it,
 * so no watch runs. The request is read once from MetaMask's server by its exact id, inside the same project bracket
 * (the session project before and after, two vendor processes), and classified as a watch answer would be.
 */
export async function readMetaMaskNativeSdkRequest(requestId, vendorProjectHash, binding) {
    return await readRequest(requestId, vendorProjectHash, { source: "server", binding });
}
async function readRequest(requestId, vendorProjectHash, read) {
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
            refuse("metamask_session_project_changed");
        observation.before_guard_verified = true;
        observation.guard_step = null;
        if (read.source === "server") {
            observation.stage = "server_read";
            hint = await serverRequestHint(requestId, vendorProjectHash, read.binding, observation, hint, true);
        }
        else {
            observation.stage = "watch";
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
            // The precise trigger only: mm itself said its local list does not hold this very request. No other answer is retried.
            if (read.binding !== undefined && hint.disposition === "unknown" && hint.reason === "metamask_request_not_in_local_state") {
                observation.stage = "server_read";
                hint = await serverRequestHint(requestId, vendorProjectHash, read.binding, observation, hint, false);
            }
        }
        observation.stage = "after_guard";
        observation.guard_step = "project_after";
        if (await project(runner) !== vendorProjectHash)
            refuse("metamask_session_project_changed");
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
    // Nothing on stdout because the watch answered REQUEST_NOT_FOUND on stderr: where mm missed it, never what it did.
    if (parsed === null)
        return unknown(metaMaskWatchMissReason(result) ?? "provider_response_malformed");
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
    return jobHint(data.request, data.status, result.exitCode === 0 && parsed.envelope?.ok === true, requestId, observation, mfa());
}
/**
 * The server's own record of the request, read when mm's local list does not hold it. A verified answer is classified
 * by `jobHint` exactly as a watch's `request` and `status` of this very request; a 404 stays unknown, and a refused read
 * keeps the reason it had before the read (the watch's own, or that no read answered). `withWindow`: the read of a
 * request APN sent itself also keeps the AWAITING_MFA approval window the answer names; the 0.5.107 fallback read of an
 * earlier request records it as it always did, with no window.
 */
async function serverRequestHint(requestId, projectHash, binding, observation, missed, withWindow) {
    const answer = await readMetaMaskNativeServerRequest(requestId, projectHash, binding);
    observation.server_read = Object.freeze({ outcome: answer.outcome, response_hash: answer.outcome === "verified" ? answer.responseHash : null,
        reason: answer.outcome === "refused" ? answer.reason : null, check: answer.outcome === "refused" ? answer.check : null });
    if (answer.outcome === "not_found")
        return { disposition: "unknown", reason: "metamask_request_not_found_on_server", requestId };
    if (answer.outcome === "refused")
        return missed;
    return jobHint({ pollingId: requestId, kind: "transaction", namespace: "evm", chainId: binding.chainId }, { status: answer.status, ...(answer.transactionHash === null ? {} : { txHash: answer.transactionHash }) }, true, requestId, observation, { expiresAt: withWindow ? answer.mfa?.expiresAt ?? null : null, authMethod: withWindow ? answer.mfa?.authMethod ?? null : null,
        evidenceHash: answer.responseHash });
}
/** One provider record of the request (a watch's `request` and `status`): its identity, chain, hash and status. */
function jobHint(request, status, settled, requestId, observation, mfa) {
    const unknown = (reason) => ({ disposition: "unknown", reason, requestId });
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
    if (!settled)
        return { disposition: "unknown", reason: "provider_request_outcome_unknown", requestId, ...chainHint,
            ...(transactionHash === undefined ? {} : { transactionHash }) };
    if (transactionHash !== undefined)
        return { disposition: "acknowledged", transactionHash, requestId, ...chainHint };
    if (typeof status.status === "string" && EFFECT_STATES.has(status.status))
        return { disposition: "pending", requestId, ...chainHint, ...(status.status === "AWAITING_MFA" ? { mfa } : {}) };
    return { disposition: "unknown", reason: "provider_request_outcome_unknown", requestId, ...chainHint };
}
//# sourceMappingURL=metamask-native-transfer-adapter.js.map