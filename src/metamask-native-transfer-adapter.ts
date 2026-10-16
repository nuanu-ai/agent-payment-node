import { metaMaskGuardPolicyAdmits } from "./metamask-native-policy.js";
import { getAddress, type Address } from "viem";
import { nativeDeadlineRemaining, validateMetaMaskNativeDiagnostic, type MetaMaskNativeDeadlineInput, type MetaMaskNativeDiagnostic } from "./metamask-native-diagnostic.js";
import { isPlainRecord, sha256 } from "./canonical.js";
import { ApnError } from "./errors.js";
import type { Hex } from "./model.js";
import { NodeMetaMaskProcessRunner, takeMetaMaskNativeProcessFailureIdentifiers, takeMetaMaskNativeProcessFailureDiagnostic, type MetaMaskProcessResult } from "./metamask-process-runner.js";
import { resolveMetaMaskBin } from "./metamask-package.js";
import { parseMetaMaskProcessOutput, classifyMetaMaskPendingNotices } from "./metamask-process-output.js";
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
export type MetaMaskNativeSubmission = (
  | { readonly disposition: "acknowledged"; readonly transactionHash: Hex; readonly requestId?: never }
  | { readonly disposition: "pending"; readonly requestId: string; readonly transactionHash?: never }
  | { readonly disposition: "unknown"; readonly reason: string; readonly transactionHash?: Hex; readonly requestId?: string }) & {readonly diagnostic?: MetaMaskNativeDiagnostic};

class NativeReadRefusal extends ApnError {
  constructor(readonly nativeDiagnostic:MetaMaskNativeDiagnostic) {super("APN_OPERATION_BLOCKED","The MetaMask Agent Wallet did not confirm the paying wallet, Guard mode or policy.");}
}
function refuse(diagnostic?:MetaMaskNativeDiagnostic): never {
  if(diagnostic!==undefined)throw new NativeReadRefusal(diagnostic);
  throw new ApnError("APN_OPERATION_BLOCKED","The MetaMask Agent Wallet did not confirm the paying wallet, Guard mode or policy.");
}
function chain(value: MetaMaskNativeFeeChainId): void {
  if (!nativeChain(value)) refuse();
}
function success(result: MetaMaskProcessResult): Record<string, unknown> {
  const parsed = parseMetaMaskProcessOutput(result.stdout), envelope = parsed?.envelope;
  if (result.exitCode !== 0 || parsed === null || parsed.notices.length !== 0 || envelope?.ok !== true || !isPlainRecord(envelope.data)) refuse(result.nativeDiagnostic===undefined?undefined:validateMetaMaskNativeDiagnostic({...result.nativeDiagnostic,code:result.exitCode===0?"protocol":result.nativeDiagnostic.code}));
  return envelope.data;
}
function remaining(deadline?: MetaMaskNativeDeadlineInput): number | undefined {
  if (deadline === undefined) return undefined;
  return nativeDeadlineRemaining(deadline);
}
async function project(runner: NodeMetaMaskProcessRunner, deadline?: MetaMaskNativeDeadlineInput): Promise<string> {
  const result = await runner.runJson(["auth", "status", "--json"], remaining(deadline), deadline);
  try {
    const data = success(result);
    if (data.authenticated !== true || !isPlainRecord(data.summary) || data.summary.mode !== "session" ||
        typeof data.summary.projectId !== "string" || !/^[A-Za-z0-9._:-]{1,256}$/u.test(data.summary.projectId)) refuse();
    return sha256(data.summary.projectId);
  } finally {result.stdout.fill(0);}
}
/**
 * Three vendor reads (PROV-12): the session project, then Guard trading mode and the policy of the selected server
 * wallet. Both wallet reads report the selected address, so a separate address read before and after adds nothing.
 */
async function readPolicy(runner: NodeMetaMaskProcessRunner, expected: {readonly payer: Address; readonly chainId: MetaMaskNativeFeeChainId; readonly recipient: Address},
  deadline?: MetaMaskNativeDeadlineInput): Promise<MetaMaskNativeVendorPolicy> {
  const vendorProjectHash = await project(runner, deadline), payer = expected.payer.toLowerCase();
  const mode = await runner.runJson(["wallet", "trading-mode", "get", "--json"], remaining(deadline), deadline);
  try {
    const data = success(mode);
    if (data.mode !== "guard" || typeof data.address !== "string" || data.address.toLowerCase() !== payer) refuse();
  } finally {mode.stdout.fill(0);}
  const result = await runner.runJson(["wallet", "policy", "get", "--json"], remaining(deadline), deadline);
  let admitted: {readonly vendorPolicyHash: string; readonly outflowLimitsUsd: Readonly<Record<string, string>>};
  try {
    const data = success(result);
    if (typeof data.address !== "string" || data.address.toLowerCase() !== payer || typeof data.policy !== "string") refuse();
    // OD-4: the policy must name this wallet, allowlist this recipient on this chain and carry an outflow limit.
    admitted = {vendorPolicyHash: sha256(data.policy), ...metaMaskGuardPolicyAdmits(data.policy, expected)};
  } finally {result.stdout.fill(0);}
  return Object.freeze({selectedAddress: getAddress(expected.payer), vendorProjectHash, ...admitted, tradingMode: "guard", observedAt: new Date().toISOString()});
}

/** Normal vendor CLI reads only; no policy mutation or remote rolling-usage prediction. */
export async function readMetaMaskNativeVendorPolicy(chainId: MetaMaskNativeFeeChainId, payer: Address, recipient: Address,
  deadline?: MetaMaskNativeDeadlineInput): Promise<MetaMaskNativeVendorPolicy> {
  chain(chainId);
  return await readPolicy(new NodeMetaMaskProcessRunner(), {payer: getAddress(payer), chainId, recipient: getAddress(recipient)}, deadline);
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
      ...(bound && observed.requestId !== undefined ? {requestId: observed.requestId} : {})};
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
  | {readonly disposition: "pending"; readonly requestId: string; readonly chainId?: MetaMaskNativeFeeChainId; readonly transactionHash?: never}
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
    if (await project(runner) !== vendorProjectHash) refuse();
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
    if (await project(runner) !== vendorProjectHash) refuse();
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
  const data = parsed.envelope?.data;
  if (parsed.envelope === null) return unknown("provider_request_evidence_missing");
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
  if (typeof status.status === "string" && EFFECT_STATES.has(status.status)) return {disposition: "pending", requestId, ...chainHint};
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
  const unknown = (reason: string): MetaMaskNativeSubmission => ({disposition: "unknown", reason,
    ...(transactionHash === undefined ? {} : {transactionHash}), ...(requestId === undefined ? {} : {requestId})});
  if (notice.disposition === "invalid" || (notice.disposition === "pending" && requestId !== notice.recoveryToken))
    return unknown("provider_identity_conflict");
  if (result.exitCode !== 0) return unknown("provider_private_handoff_outcome_unknown");
  if (parsed.envelope?.ok === true && isPlainRecord(data)) {
    if (data.mode !== "server" || typeof data.address !== "string" || data.address.toLowerCase() !== expectedPayer.toLowerCase())
      return unknown("provider_sender_mismatch");
    if (transactionHash !== undefined) return {disposition: "acknowledged", transactionHash};
    if (requestId !== undefined && typeof data.status === "string" && EFFECT_STATES.has(data.status))
      return {disposition: "pending", requestId};
  }
  if (notice.disposition === "pending" && parsed.envelope === null)
    return {disposition: "pending", requestId: notice.recoveryToken};
  return unknown("provider_private_handoff_outcome_unknown");
}
