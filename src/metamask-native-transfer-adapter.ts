import { metaMaskGuardPolicyAdmits } from "./metamask-native-policy.js";
import { getAddress, type Address } from "viem";
import { nativeDeadlineRemaining, validateMetaMaskNativeDiagnostic, type MetaMaskNativeDeadlineInput, type MetaMaskNativeDiagnostic } from "./metamask-native-diagnostic.js";
import { isPlainRecord, sha256 } from "./canonical.js";
import { ApnError, type ErrorDetail } from "./errors.js";
import type { Hex } from "./model.js";
import { NodeMetaMaskProcessRunner, takeMetaMaskNativeProcessFailureIdentifiers, takeMetaMaskNativeProcessFailureDiagnostic, type MetaMaskProcessResult } from "./metamask-process-runner.js";
import { resolveMetaMaskBin } from "./metamask-package.js";
import { parseMetaMaskProcessOutput, classifyMetaMaskPendingNotices, metaMaskMfaNotice, type MetaMaskMfaNotice } from "./metamask-process-output.js";
import { isMetaMaskEvmNamespace } from "./metamask-namespace.js";
import { METAMASK_NATIVE_CHAINS, metaMaskNativeQuoteTransfer, validateMetaMaskNativeFeeQuote, type MetaMaskNativeFeeChainId } from "./metamask-native-fee-evidence.js";
import { claimMetaMaskNativeOwnedScope, assertMetaMaskNativeOwnedScope, assertMetaMaskNativeOwnedContextCurrent,
  type MetaMaskNativeOwnedScope, type MetaMaskNativeOwnedContext } from "./metamask-native-transfer-owner.js";

// Read at call time: this module sits in an import cycle with the owner, so no imported value is used at load.
const nativeChain = (value: number): boolean => (METAMASK_NATIVE_CHAINS as readonly number[]).includes(value);
const EFFECT_STATES = new Set(["EVALUATING", "AWAITING_MFA", "SIGNING", "BROADCASTING"]);

/** What the vendor CLI reported for the selected wallet; `vendorPolicyHash` pins the policy bytes between prepare and send. */
export interface MetaMaskNativeVendorPolicy {
  readonly selectedAddress: Address;
  readonly vendorProjectHash: string;
  readonly vendorPolicyHash: string;
  readonly tradingMode: "guard";
  readonly outflowLimitsUsd: Readonly<Record<string, string>>;
  readonly observedAt: string;
}
/** A verified AWAITING_MFA notice (or request status) for the very request stored, with the SHA-256 of the vendor output. */
export interface MetaMaskNativeMfaEvidence extends MetaMaskMfaNotice { readonly evidenceHash: string }
export type MetaMaskNativeSubmission = (
  | { readonly disposition: "acknowledged"; readonly transactionHash: Hex; readonly requestId?: never }
  | { readonly disposition: "pending"; readonly requestId: string; readonly transactionHash?: never; readonly mfa?: MetaMaskNativeMfaEvidence }
  | { readonly disposition: "unknown"; readonly reason: string; readonly transactionHash?: Hex; readonly requestId?: string; readonly mfa?: MetaMaskNativeMfaEvidence })
  & {readonly diagnostic?: MetaMaskNativeDiagnostic};

/**
 * Which vendor-read invariant a native transfer failed (QA 0.5.79 MM-NATIVE-PREFLIGHT-DIAGNOSTIC-079-001), with the
 * owner's next step. Every one still refuses before any operation exists; the step is advice, never run by APN. A step
 * written `mm …` is the pinned vendor client, which `runnable` turns into a command that runs as typed.
 */
export type MetaMaskNativeRefusal = "metamask_native_chain_unsupported" | "metamask_vendor_read_failed" | "metamask_session_required" |
  "metamask_session_project_changed" | "metamask_guard_mode_required" | "metamask_wallet_mismatch" | "metamask_guard_policy_missing";
interface Who { readonly profile?: string; readonly payer?: string }
const REFUSALS: Readonly<Record<MetaMaskNativeRefusal, { readonly message: string; readonly nextActions: (who: Who) => readonly string[] }>> = {
  metamask_native_chain_unsupported: { message: "MetaMask native transfers do not support this chain.", nextActions: () => [] },
  metamask_vendor_read_failed: { message: "The MetaMask Agent Wallet did not answer a read of its session, Guard mode or policy.",
    nextActions: () => ["mm auth status --json"] },
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
type VendorRead = "auth status" | "trading-mode get" | "policy get";
const MODES = new Set(["guard", "beast"]);
class NativeReadRefusal extends ApnError {
  constructor(readonly nativeDiagnostic:MetaMaskNativeDiagnostic, message:string, details:Readonly<Record<string, ErrorDetail>>) {
    super("APN_OPERATION_BLOCKED", message, details);
  }
}
function refuse(reason: MetaMaskNativeRefusal, facts: Readonly<Record<string, ErrorDetail>> = {}, who: Who = {}, diagnostic?: MetaMaskNativeDiagnostic): never {
  const details = { ...facts, reason, nextActions: REFUSALS[reason].nextActions(who) };
  if (diagnostic !== undefined) throw new NativeReadRefusal(diagnostic, REFUSALS[reason].message, details);
  throw new ApnError("APN_OPERATION_BLOCKED", REFUSALS[reason].message, details);
}
const quoted = (value: string) => /^[A-Za-z0-9_./@:+=-]+$/u.test(value) ? value : `'${value.replaceAll("'", "'\\''")}'`;
/**
 * The refusal with each `mm …` step written as the pinned client run by APN's own Node: Homebrew links only `apn`, so a
 * bare `mm` is not on the owner's PATH (the policy refusals of metamask-native-policy.ts included).
 */
async function runnable(error: unknown): Promise<unknown> {
  const actions = error instanceof ApnError ? error.details?.nextActions : undefined;
  if (!(error instanceof ApnError) || !Array.isArray(actions) || !actions.some(action => action.startsWith("mm "))) return error;
  let script: string;
  try { script = await resolveMetaMaskBin(); } catch { return error; }
  const prefix = `${quoted(process.execPath)} ${quoted(script)} `;
  const details = { ...error.details, nextActions: actions.map(action => action.startsWith("mm ") ? prefix + action.slice(3) : action) };
  return error instanceof NativeReadRefusal ? new NativeReadRefusal(error.nativeDiagnostic, error.message, details)
    : new ApnError(error.code, error.message, details);
}
function chain(value: MetaMaskNativeFeeChainId): void {
  if (!nativeChain(value)) refuse("metamask_native_chain_unsupported");
}
function success(result: MetaMaskProcessResult, read: VendorRead, who: Who = {}): Record<string, unknown> {
  const parsed = parseMetaMaskProcessOutput(result.stdout), envelope = parsed?.envelope;
  if (result.exitCode !== 0 || parsed === null || parsed.notices.length !== 0 || envelope?.ok !== true || !isPlainRecord(envelope.data)) refuse("metamask_vendor_read_failed", { failedRead: read }, who, result.nativeDiagnostic===undefined?undefined:validateMetaMaskNativeDiagnostic({...result.nativeDiagnostic,code:result.exitCode===0?"protocol":result.nativeDiagnostic.code}));
  return envelope.data;
}
function remaining(deadline?: MetaMaskNativeDeadlineInput): number | undefined {
  if (deadline === undefined) return undefined;
  return nativeDeadlineRemaining(deadline);
}
async function project(runner: NodeMetaMaskProcessRunner, deadline?: MetaMaskNativeDeadlineInput, who: Who = {}): Promise<string> {
  const result = await runner.runJson(["auth", "status", "--json"], remaining(deadline), deadline);
  try {
    const data = success(result, "auth status", who);
    if (data.authenticated !== true || !isPlainRecord(data.summary) || data.summary.mode !== "session" ||
        typeof data.summary.projectId !== "string" || !/^[A-Za-z0-9._:-]{1,256}$/u.test(data.summary.projectId)) refuse("metamask_session_required", {}, who);
    return sha256(data.summary.projectId);
  } finally {result.stdout.fill(0);}
}
/**
 * Three vendor reads (PROV-12): the session project, then Guard trading mode and the policy of the selected server
 * wallet. Both wallet reads report the selected address, so a separate address read before and after adds nothing.
 */
async function readPolicy(runner: NodeMetaMaskProcessRunner, expected: {readonly payer: Address; readonly chainId: MetaMaskNativeFeeChainId; readonly recipient: Address},
  deadline?: MetaMaskNativeDeadlineInput, profile?: string): Promise<MetaMaskNativeVendorPolicy> {
  const payer = expected.payer.toLowerCase(), who: Who = { ...(profile === undefined ? {} : { profile }), payer: expected.payer };
  const vendorProjectHash = await project(runner, deadline, who);
  const selected = (address: unknown) => {
    if (typeof address !== "string" || address.toLowerCase() !== payer) refuse("metamask_wallet_mismatch", {}, who);
  };
  const mode = await runner.runJson(["wallet", "trading-mode", "get", "--json"], remaining(deadline), deadline);
  try {
    const data = success(mode, "trading-mode get", who);
    selected(data.address);
    // A new MetaMask project (a sign-in that created one) starts with no trading mode, which the vendor reports as null.
    if (data.mode !== "guard") refuse("metamask_guard_mode_required",
      { observedTradingMode: data.mode === null || data.mode === undefined ? "unreported" : typeof data.mode === "string" && MODES.has(data.mode) ? data.mode : "unrecognized" }, who);
  } finally {mode.stdout.fill(0);}
  const result = await runner.runJson(["wallet", "policy", "get", "--json"], remaining(deadline), deadline);
  let admitted: {readonly vendorPolicyHash: string; readonly outflowLimitsUsd: Readonly<Record<string, string>>};
  try {
    const data = success(result, "policy get", who);
    selected(data.address);
    if (typeof data.policy !== "string" || data.policy.trim() === "") refuse("metamask_guard_policy_missing", {}, who);
    // OD-4: the policy must name this wallet, allowlist this recipient on this chain and carry an outflow limit.
    admitted = {vendorPolicyHash: sha256(data.policy), ...metaMaskGuardPolicyAdmits(data.policy, expected)};
  } finally {result.stdout.fill(0);}
  return Object.freeze({selectedAddress: getAddress(expected.payer), vendorProjectHash, ...admitted, tradingMode: "guard", observedAt: new Date().toISOString()});
}

/** Normal vendor CLI reads only; no policy mutation or remote rolling-usage prediction. */
export async function readMetaMaskNativeVendorPolicy(chainId: MetaMaskNativeFeeChainId, payer: Address, recipient: Address,
  deadline?: MetaMaskNativeDeadlineInput, profile?: string): Promise<MetaMaskNativeVendorPolicy> {
  chain(chainId);
  try { return await readPolicy(new NodeMetaMaskProcessRunner(), {payer: getAddress(payer), chainId, recipient: getAddress(recipient)}, deadline, profile); }
  catch (error) { throw await runnable(error); }
}

const quantity = (value: string): string => `0x${BigInt(value).toString(16)}`;

/** A failure before the vendor child process was spawned: nothing was handed to the vendor. */
export class MetaMaskNativeHandoffNotStarted extends Error {
  constructor(readonly causeError: unknown) { super("MetaMask native handoff did not start."); }
}

/** Owner alone persists the one-effect handoff marker before this statically bound call. */
export async function submitOwnedMetaMaskNative(scope: MetaMaskNativeOwnedScope,
  context: MetaMaskNativeOwnedContext): Promise<MetaMaskNativeSubmission> {
  let prepared: Awaited<ReturnType<typeof prepareNativeHandoff>>;
  // Every check that can fail runs before the child process is spawned (R3); its failure proves no handoff.
  try { prepared = await prepareNativeHandoff(scope, context); }
  catch (error) { throw new MetaMaskNativeHandoffNotStarted(error); }
  const { deadline, quote, handoffRunner, payload } = prepared;
  // EIP-1559 fees force the ordinary type2 path; the normal parser accepts no authorization list.
  let result: MetaMaskProcessResult;
  try {
    const transfer = metaMaskNativeQuoteTransfer(quote);
    result = await handoffRunner.runJson(["wallet", "send-transaction", "--chain-id", String(quote.chainId), "--payload", payload,
      "--intent", `APN ${context.operationId}: ${transfer.amountAtomic} atomic USDC to ${transfer.recipient}`, "--json"], nativeDeadlineRemaining(deadline), deadline);
  } catch (error) {
    const diagnostic = takeMetaMaskNativeProcessFailureDiagnostic(error);
    const observed = takeMetaMaskNativeProcessFailureIdentifiers(error);
    const bound = observed !== undefined && (observed.sender === undefined || observed.sender === quote.sender.toLowerCase()) &&
      (observed.chainId === undefined || observed.chainId === quote.chainId) &&
      (observed.vendorProjectHash === undefined || observed.vendorProjectHash === context.vendorProjectHash);
    // Rejection remains UNKNOWN even when the real failed child emitted a recoverable identifier.
    return {disposition: "unknown", reason: "provider_private_handoff_outcome_unknown", ...(diagnostic === undefined ? {} : {diagnostic}),
      ...(bound && observed.transactionHash !== undefined ? {transactionHash: observed.transactionHash} : {}),
      ...(bound && observed.requestId !== undefined ? {requestId: observed.requestId, ...(observed.mfa === undefined ? {} : {mfa: observed.mfa})} : {})};
  }
  // The effect has happened: no guard runs after it. The pre-send guard required the quote nonce to be the pending
  // nonce, so re-running it after a broadcast (nonce + 1) turned every successful send into an unknown outcome. The
  // durable effect marker and the stored hash or request id are the guards from here on.
  let hint: MetaMaskNativeSubmission;
  try { hint = submissionHint(result,quote.sender); } finally {result.stdout.fill(0);}
  return {...hint, ...(result.nativeDiagnostic === undefined ? {} : {diagnostic:result.nativeDiagnostic})};
}

/** Everything before the vendor child process: claim, policy, resolver, last owner guard and the exact payload. */
async function prepareNativeHandoff(scope: MetaMaskNativeOwnedScope, context: MetaMaskNativeOwnedContext) {
  claimMetaMaskNativeOwnedScope(scope, context);
  const deadline = assertMetaMaskNativeOwnedScope(scope,context);
  nativeDeadlineRemaining(deadline);
  const quote = validateMetaMaskNativeFeeQuote(context.quote);
  chain(quote.chainId);
  // Finish package validation before the last owner/deadline check, so a slow resolver cannot move the private handoff past it.
  nativeDeadlineRemaining(deadline);
  let resolverTimer:ReturnType<typeof setTimeout>|undefined;
  let executable:string;
  try {executable=await Promise.race([resolveMetaMaskBin(),new Promise<never>((_,reject)=>{
    resolverTimer=setTimeout(()=>reject(new ApnError("APN_OPERATION_BLOCKED","Native SDK resolver deadline reached.")),nativeDeadlineRemaining(deadline));
  })]);}finally{if(resolverTimer!==undefined)clearTimeout(resolverTimer);}
  assertMetaMaskNativeOwnedScope(scope, context);
  nativeDeadlineRemaining(deadline);
  const handoffRunner = new NodeMetaMaskProcessRunner(async () => executable);
  await assertMetaMaskNativeOwnedContextCurrent(scope, context);
  assertMetaMaskNativeOwnedScope(scope, context);
  const t = quote.transaction;
  const payload = JSON.stringify({to: t.to, data: t.data, value: "0x0", gas: quantity(t.gasLimitAtomic),
    nonce: quantity(t.nonceAtomic), maxFeePerGas: quantity(t.maxFeePerGasAtomic),
    maxPriorityFeePerGas: quantity(t.maxPriorityFeePerGasAtomic)});
  return { deadline, quote, handoffRunner, payload };
}

/** Transient read evidence only. No field grants financial authority or changes a held journal. */
export interface MetaMaskNativeReadObservation {
  readonly stage: "not_requested" | "input" | "before_guard" | "watch" | "after_guard" | "complete";
  /** Request reads bracket the watch with the session project only (`project_before`, `project_after`); other steps are kept for old outputs. */
  readonly guard_step: "project_before" | "address_before" | "trading_mode" | "vendor_policy" | "address_after" | "project_after" | null;
  readonly request_id: string | null;
  readonly watch_returned: boolean;
  readonly before_guard_verified: boolean;
  readonly after_guard_verified: boolean;
  readonly request_identity_verified: boolean;
  readonly provider_status: "EVALUATING" | "AWAITING_MFA" | "SIGNING" | "BROADCASTING" | "CONFIRMED" | "FAILED" | "EXPIRED" | "DENIED" | "APPROVED" | "SIGNED" | "CANCELLED" | "unrecognized" | null;
  readonly transaction_hash: Hex | null;
  readonly chain_id: MetaMaskNativeFeeChainId | null;
  readonly response_hash: string | null;
  readonly reason: string | null;
  readonly error_code: "APN_OPERATION_BLOCKED" | "APN_PROVIDER_PROTOCOL" | "APN_PROVIDER_UNAVAILABLE" | "APN_STATE_CORRUPT" | "unavailable" | null;
  readonly diagnostic: MetaMaskNativeDiagnostic | null;
}
function readDiagnostic(value: unknown): MetaMaskNativeDiagnostic | null {
  try {return validateMetaMaskNativeDiagnostic(value);} catch {return null;}
}
type MutableReadObservation = {-readonly [K in keyof MetaMaskNativeReadObservation]: MetaMaskNativeReadObservation[K]};
type RequestHint =
  | {readonly disposition: "acknowledged"; readonly requestId: string; readonly transactionHash: Hex; readonly chainId?: MetaMaskNativeFeeChainId}
  | {readonly disposition: "pending"; readonly requestId: string; readonly chainId?: MetaMaskNativeFeeChainId; readonly transactionHash?: never; readonly mfa?: MetaMaskNativeMfaEvidence}
  | {readonly disposition: "unknown"; readonly reason: string; readonly requestId?: string; readonly transactionHash?: Hex; readonly chainId?: MetaMaskNativeFeeChainId};
export type MetaMaskNativeRequestObservation = RequestHint & {readonly readObservation?: MetaMaskNativeReadObservation};

/**
 * Normal status READ only (three vendor processes): the session project before, the watch, the project after. The owner
 * supplies the request id and project hash from its authentic journal; a service hint is never chain evidence, so no
 * policy is read around it.
 */
export async function readMetaMaskNativeRequest(requestId: string, vendorProjectHash: string): Promise<MetaMaskNativeRequestObservation> {
  const observation: MutableReadObservation = {stage:"input",guard_step:null,request_id:null,watch_returned:false,
    before_guard_verified:false,after_guard_verified:false,request_identity_verified:false,provider_status:null,
    transaction_hash:null,chain_id:null,response_hash:null,reason:null,error_code:null,diagnostic:null};
  const observed = (hint: RequestHint): MetaMaskNativeRequestObservation => {
    observation.transaction_hash = "transactionHash" in hint ? hint.transactionHash ?? null : null;
    observation.chain_id = hint.chainId ?? null;
    observation.reason = hint.disposition === "unknown" ? hint.reason : null;
    return {...hint,readObservation:Object.freeze({...observation})};
  };
  if (!/^[A-Za-z0-9._:-]{1,256}$/u.test(requestId) || !/^[a-f0-9]{64}$/u.test(vendorProjectHash))
    return observed({disposition: "unknown", reason: "provider_request_binding_invalid"});
  observation.request_id = requestId;
  const runner = new NodeMetaMaskProcessRunner();
  let hint: RequestHint = {disposition: "unknown", reason: "provider_request_read_unavailable", requestId};
  try {
    observation.stage = "before_guard"; observation.guard_step = "project_before";
    if (await project(runner) !== vendorProjectHash) refuse("metamask_session_project_changed");
    observation.before_guard_verified = true;
    observation.stage = "watch"; observation.guard_step = null;
    const result = await runner.runJson(["wallet", "requests", "watch", requestId, "--wallet-timeout", "1", "--json"], 6_000);
    observation.watch_returned = true;
    try {
      observation.response_hash = sha256(result.stdout);
      observation.diagnostic = result.nativeDiagnostic === undefined ? null : readDiagnostic(result.nativeDiagnostic);
      hint = requestHint(result, requestId, observation);
    } finally {result.stdout.fill(0);}
    observation.stage = "after_guard"; observation.guard_step = "project_after";
    if (await project(runner) !== vendorProjectHash) refuse("metamask_session_project_changed");
    observation.after_guard_verified = true;
    observation.stage = "complete"; observation.guard_step = null;
    return observed(hint);
  } catch (error) {
    observation.error_code = error instanceof ApnError && ["APN_OPERATION_BLOCKED","APN_PROVIDER_PROTOCOL","APN_PROVIDER_UNAVAILABLE","APN_STATE_CORRUPT"].includes(error.code)
      ? error.code as Exclude<MetaMaskNativeReadObservation["error_code"], "unavailable" | null> : "unavailable";
    const diagnostic = error instanceof NativeReadRefusal ? error.nativeDiagnostic : takeMetaMaskNativeProcessFailureDiagnostic(error);
    observation.diagnostic = diagnostic === undefined ? observation.diagnostic : readDiagnostic(diagnostic);
    return observed({disposition: "unknown", reason: "provider_request_read_guard_changed_or_unavailable", requestId,
      ...("transactionHash" in hint && hint.transactionHash !== undefined ? {transactionHash: hint.transactionHash} : {}),
      ...(hint.chainId === undefined ? {} : {chainId: hint.chainId})});
  }
}

function requestHint(result: MetaMaskProcessResult, requestId: string, observation: MutableReadObservation): RequestHint {
  const parsed = parseMetaMaskProcessOutput(result.stdout);
  const unknown = (reason: string): MetaMaskNativeRequestObservation => ({disposition: "unknown", reason, requestId});
  if (parsed === null) return unknown("provider_response_malformed");
  const notice = classifyMetaMaskPendingNotices(parsed.notices, requestId);
  if (notice.disposition === "invalid") return unknown("provider_request_identity_conflict");
  const data = parsed.envelope?.data, mfa = (): MetaMaskNativeMfaEvidence => ({...(notice.disposition === "pending" ? metaMaskMfaNotice(parsed.notices)
    : {expiresAt: null, authMethod: null}), evidenceHash: observation.response_hash!});
  // Notice only: the watch ended (6.1.5 writes its `_error` to stderr) while the provider still waits for the owner's
  // approval of this very request (the notice names it). That is the whole answer: an MFA task, no outcome, no hash.
  if (parsed.envelope === null) {
    if (notice.disposition !== "pending") return unknown("provider_request_evidence_missing");
    observation.provider_status = "AWAITING_MFA";
    return {disposition: "pending", requestId, mfa: mfa()};
  }
  if (!isPlainRecord(data) || !isPlainRecord(data.request) || !isPlainRecord(data.status)) return unknown("provider_request_evidence_missing");
  const request = data.request, status = data.status;
  if (request.pollingId !== requestId || request.kind !== "transaction" || !isMetaMaskEvmNamespace(request.namespace))
    return unknown("provider_request_identity_conflict");
  const chainId = request.chainId;
  if (chainId !== undefined && (typeof chainId !== "number" || !nativeChain(chainId)))
    return unknown("provider_request_chain_unsupported");
  const chainHint = chainId === undefined ? {} : {chainId: chainId as MetaMaskNativeFeeChainId};
  const hash = (value: unknown): Hex | undefined => typeof value === "string" && /^0x[a-fA-F0-9]{64}$/u.test(value) ? value.toLowerCase() as Hex : undefined;
  const requestHash = hash(request.txHash), statusHash = hash(status.txHash);
  if ((request.txHash !== undefined && request.txHash !== null && requestHash === undefined) ||
      (status.txHash !== undefined && status.txHash !== null && statusHash === undefined)) return unknown("provider_transaction_identity_invalid");
  if (requestHash !== undefined && statusHash !== undefined && requestHash !== statusHash) return unknown("provider_transaction_identity_conflict");
  const transactionHash = statusHash ?? requestHash;
  observation.request_identity_verified = true;
  const states = ["EVALUATING","AWAITING_MFA","SIGNING","BROADCASTING","CONFIRMED","FAILED","EXPIRED","DENIED","APPROVED","SIGNED","CANCELLED"] as const;
  observation.provider_status = typeof status.status === "string" && (states as readonly string[]).includes(status.status)
    ? status.status as typeof states[number] : typeof status.status === "string" ? "unrecognized" : null;
  if (result.exitCode !== 0 || parsed.envelope?.ok !== true)
    return {disposition: "unknown", reason: "provider_request_outcome_unknown", requestId, ...chainHint,
      ...(transactionHash === undefined ? {} : {transactionHash})};
  if (transactionHash !== undefined) return {disposition: "acknowledged", transactionHash, requestId, ...chainHint};
  if (typeof status.status === "string" && EFFECT_STATES.has(status.status))
    return {disposition: "pending", requestId, ...chainHint, ...(status.status === "AWAITING_MFA" ? {mfa: mfa()} : {})};
  return {disposition: "unknown", reason: "provider_request_outcome_unknown", requestId, ...chainHint};
}

function submissionHint(result: MetaMaskProcessResult, expectedPayer: string): MetaMaskNativeSubmission {
  const parsed = parseMetaMaskProcessOutput(result.stdout);
  if (parsed === null) return {disposition: "unknown", reason: "provider_response_malformed"};
  const notice = classifyMetaMaskPendingNotices(parsed.notices);
  const data = parsed.envelope?.data;
  const transactionHash = isPlainRecord(data) && typeof data.hash === "string" && /^0x[a-fA-F0-9]{64}$/u.test(data.hash)
    ? data.hash.toLowerCase() as Hex : undefined;
  const requestId = isPlainRecord(data) && typeof data.pollingId === "string" && /^[A-Za-z0-9._:-]{1,256}$/u.test(data.pollingId)
    ? data.pollingId : notice.disposition === "pending" ? notice.recoveryToken : undefined;
  // The owner's approval the provider waits on, for this very request only: a notice naming it or its AWAITING_MFA status,
  // with no hash and no other sender. It is kept beside an UNKNOWN or pending outcome, never in place of one.
  const sender = !isPlainRecord(data) || data.mode === "server" && typeof data.address === "string" && data.address.toLowerCase() === expectedPayer.toLowerCase();
  const latest = isPlainRecord(data) && typeof data.status === "string" ? data.status : undefined;
  const awaiting = latest === undefined ? notice.disposition === "pending" && notice.recoveryToken === requestId : latest === "AWAITING_MFA";
  const task = requestId !== undefined && transactionHash === undefined && sender && awaiting ? {mfa: {...(notice.disposition === "pending"
    ? metaMaskMfaNotice(parsed.notices) : {expiresAt: null, authMethod: null}), evidenceHash: sha256(result.stdout)}} : {};
  const unknown = (reason: string, withTask = false): MetaMaskNativeSubmission => ({disposition: "unknown", reason,
    ...(transactionHash === undefined ? {} : {transactionHash}), ...(requestId === undefined ? {} : {requestId}), ...(withTask ? task : {})});
  if (notice.disposition === "invalid" || (notice.disposition === "pending" && requestId !== notice.recoveryToken))
    return unknown("provider_identity_conflict");
  if (result.exitCode !== 0) return unknown("provider_private_handoff_outcome_unknown", true);
  if (parsed.envelope?.ok === true && isPlainRecord(data)) {
    if (!sender) return unknown("provider_sender_mismatch");
    if (transactionHash !== undefined) return {disposition: "acknowledged", transactionHash};
    if (requestId !== undefined && typeof data.status === "string" && EFFECT_STATES.has(data.status))
      return {disposition: "pending", requestId, ...task};
  }
  if (notice.disposition === "pending" && parsed.envelope === null)
    return {disposition: "pending", requestId: notice.recoveryToken, ...task};
  return unknown("provider_private_handoff_outcome_unknown", true);
}
