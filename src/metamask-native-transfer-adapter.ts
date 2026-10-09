import { isPlainRecord, sha256 } from "./canonical.js";
import { ApnError } from "./errors.js";
import type { Hex } from "./model.js";
import { NodeMetaMaskProcessRunner, takeMetaMaskNativeProcessFailureIdentifiers, type MetaMaskProcessResult } from "./metamask-process-runner.js";
import { resolveMetaMaskBin } from "./metamask-package.js";
import { parseMetaMaskProcessOutput, classifyMetaMaskPendingNotices } from "./metamask-process-output.js";
import { isMetaMaskEvmNamespace } from "./metamask-namespace.js";
import { validateMetaMaskNativeFeeQuote, type MetaMaskNativeFeeChainId } from "./metamask-native-fee-evidence.js";
import { claimMetaMaskNativeOwnedScope, assertMetaMaskNativeOwnedScope, assertMetaMaskNativeOwnedContextCurrent,
  type MetaMaskNativeOwnedScope, type MetaMaskNativeOwnedContext } from "./metamask-native-transfer-owner.js";

const PAYER = "0xf41170df51aab52aaa04fbc3ff325cf051644aca";
const POLICY_HASH = "e3e44343da17c1912c2da0ce5b58f9c804b53d3715b8a2756c0b035fd50d288a";
const PROFILE = "metamask-live-v042";
const CHAINS = new Set([1, 10, 143, 59144, 1329]);
const EFFECT_STATES = new Set(["EVALUATING", "AWAITING_MFA", "SIGNING", "BROADCASTING"]);

export interface FixedMetaMaskNativePolicy {
  readonly selectedAddress: typeof PAYER;
  readonly vendorPolicyHash: typeof POLICY_HASH;
  readonly vendorProjectHash: string;
  readonly policyBytes: 866;
  readonly tradingMode: "guard";
  readonly observedAt: string;
}
export type MetaMaskNativeSubmission =
  | { readonly disposition: "acknowledged"; readonly transactionHash: Hex; readonly requestId?: never }
  | { readonly disposition: "pending"; readonly requestId: string; readonly transactionHash?: never }
  | { readonly disposition: "unknown"; readonly reason: string; readonly transactionHash?: Hex; readonly requestId?: string };

function refuse(): never {throw new ApnError("APN_OPERATION_BLOCKED", "The fixed MetaMask native transfer is unavailable.");}
function chain(value: MetaMaskNativeFeeChainId): void {
  if (!CHAINS.has(value) || value === 10) refuse(); // The exact approved snapshot has no OP Seller row.
}
function success(result: MetaMaskProcessResult): Record<string, unknown> {
  const parsed = parseMetaMaskProcessOutput(result.stdout), envelope = parsed?.envelope;
  if (result.exitCode !== 0 || parsed === null || parsed.notices.length !== 0 || envelope?.ok !== true || !isPlainRecord(envelope.data)) refuse();
  return envelope.data;
}
async function address(runner: NodeMetaMaskProcessRunner, maximumMs?: number): Promise<void> {
  const result = await runner.runJson(["wallet", "address", "--chain-namespace", "evm", "--json"], maximumMs);
  try {
    const data = success(result);
    if (data.mode !== "server" || !isMetaMaskEvmNamespace(data.chainNamespace) ||
        typeof data.address !== "string" || data.address.toLowerCase() !== PAYER) refuse();
  } finally {result.stdout.fill(0);}
}
function remaining(deadline?: string): number | undefined {
  if (deadline === undefined) return undefined;
  const value = Date.parse(deadline) - Date.now();
  if (!Number.isFinite(value) || value < 1) refuse();
  return Math.min(60_000, value);
}
async function project(runner: NodeMetaMaskProcessRunner, deadline?: string): Promise<string> {
  const result = await runner.runJson(["auth", "status", "--json"], remaining(deadline));
  try {
    const data = success(result);
    if (data.authenticated !== true || !isPlainRecord(data.summary) || data.summary.mode !== "session" ||
        typeof data.summary.projectId !== "string" || !/^[A-Za-z0-9._:-]{1,256}$/u.test(data.summary.projectId)) refuse();
    return sha256(data.summary.projectId);
  } finally {result.stdout.fill(0);}
}
async function readPolicy(runner: NodeMetaMaskProcessRunner, deadline?: string): Promise<FixedMetaMaskNativePolicy> {
  const vendorProjectHash = await project(runner, deadline);
  await address(runner, remaining(deadline));
  const mode = await runner.runJson(["wallet", "trading-mode", "get", "--json"], remaining(deadline));
  try {
    const data = success(mode);
    if (data.mode !== "guard" || typeof data.address !== "string" || data.address.toLowerCase() !== PAYER) refuse();
  } finally {mode.stdout.fill(0);}
  const result = await runner.runJson(["wallet", "policy", "get", "--json"], remaining(deadline));
  try {
    const data = success(result);
    if (typeof data.address !== "string" || data.address.toLowerCase() !== PAYER || typeof data.policy !== "string" ||
        Buffer.byteLength(data.policy, "utf8") !== 866 || sha256(data.policy) !== POLICY_HASH) refuse();
  } finally {result.stdout.fill(0);}
  await address(runner, remaining(deadline));
  if (await project(runner, deadline) !== vendorProjectHash) refuse();
  return Object.freeze({selectedAddress: PAYER, vendorPolicyHash: POLICY_HASH, vendorProjectHash, policyBytes: 866, tradingMode: "guard", observedAt: new Date().toISOString()});
}

/** Normal pinned CLI GETs only. No YAML decoder, policy mutation or remote rolling-usage prediction. */
export async function readFixedMetaMaskNativePolicy(chainId: MetaMaskNativeFeeChainId): Promise<FixedMetaMaskNativePolicy> {
  chain(chainId);
  return await readPolicy(new NodeMetaMaskProcessRunner());
}

const quantity = (value: string): string => `0x${BigInt(value).toString(16)}`;

/** Owner alone persists the one-effect handoff marker before this statically bound call. */
export async function submitOwnedMetaMaskNative(scope: MetaMaskNativeOwnedScope,
  context: MetaMaskNativeOwnedContext): Promise<MetaMaskNativeSubmission> {
  claimMetaMaskNativeOwnedScope(scope, context);
  await assertMetaMaskNativeOwnedContextCurrent(scope, context);
  const quote = validateMetaMaskNativeFeeQuote(context.quote);
  chain(quote.chainId);
  if (context.profile !== PROFILE || quote.sender.toLowerCase() !== PAYER || context.vendorPolicyHash !== POLICY_HASH) refuse();
  const runner = new NodeMetaMaskProcessRunner();
  const policy = await readPolicy(runner, context.consentExpiresAt);
  if (policy.vendorPolicyHash !== context.vendorPolicyHash || policy.vendorProjectHash !== context.vendorProjectHash) refuse();
  // Finish package validation before the last owner/deadline check, so a slow resolver cannot move the private handoff past it.
  const executable = await resolveMetaMaskBin();
  const handoffRunner = new NodeMetaMaskProcessRunner(async () => executable);
  await assertMetaMaskNativeOwnedContextCurrent(scope, context);
  assertMetaMaskNativeOwnedScope(scope, context);
  const t = quote.transaction;
  const payload = JSON.stringify({to: t.to, data: t.data, value: "0x0", gas: quantity(t.gasLimitAtomic),
    nonce: quantity(t.nonceAtomic), maxFeePerGas: quantity(t.maxFeePerGasAtomic),
    maxPriorityFeePerGas: quantity(t.maxPriorityFeePerGasAtomic)});
  // EIP-1559 fees force the ordinary type2 path; the normal parser accepts no authorization list.
  let result: MetaMaskProcessResult;
  try {
    result = await handoffRunner.runJson(["wallet", "send-transaction", "--chain-id", String(quote.chainId), "--payload", payload,
      "--intent", `APN ${context.operationId}: native-paid fixed 1000 atomic USDC to Seller`, "--json"], remaining(context.consentExpiresAt));
  } catch (error) {
    const observed = takeMetaMaskNativeProcessFailureIdentifiers(error);
    const bound = observed !== undefined && (observed.sender === undefined || observed.sender === PAYER) &&
      (observed.chainId === undefined || observed.chainId === quote.chainId) &&
      (observed.vendorProjectHash === undefined || observed.vendorProjectHash === context.vendorProjectHash);
    // Rejection remains UNKNOWN even when the real failed child emitted a recoverable identifier.
    try {
      if ((await readPolicy(runner, context.consentExpiresAt)).vendorProjectHash !== context.vendorProjectHash) refuse();
      await assertMetaMaskNativeOwnedContextCurrent(scope, context); assertMetaMaskNativeOwnedScope(scope, context);
    } catch { /* The source deadline is never extended to recover a rejected invocation. */ }
    return {disposition: "unknown", reason: "provider_private_handoff_outcome_unknown",
      ...(bound && observed.transactionHash !== undefined ? {transactionHash: observed.transactionHash} : {}),
      ...(bound && observed.requestId !== undefined ? {requestId: observed.requestId} : {})};
  }
  let hint: MetaMaskNativeSubmission;
  try { hint = submissionHint(result); } finally {result.stdout.fill(0);}
  try {
    if ((await readPolicy(runner, context.consentExpiresAt)).vendorProjectHash !== context.vendorProjectHash) refuse();
    await assertMetaMaskNativeOwnedContextCurrent(scope, context); assertMetaMaskNativeOwnedScope(scope, context);
  }
  catch {return {disposition: "unknown", reason: "provider_handoff_guard_expired_or_changed",
    ...("transactionHash" in hint ? {transactionHash: hint.transactionHash} : {}),
    ...("requestId" in hint ? {requestId: hint.requestId} : {})};}
  return hint;
}

export type MetaMaskNativeRequestObservation =
  | {readonly disposition: "acknowledged"; readonly requestId: string; readonly transactionHash: Hex; readonly chainId?: MetaMaskNativeFeeChainId}
  | {readonly disposition: "pending"; readonly requestId: string; readonly chainId?: MetaMaskNativeFeeChainId; readonly transactionHash?: never}
  | {readonly disposition: "unknown"; readonly reason: string; readonly requestId?: string; readonly transactionHash?: Hex; readonly chainId?: MetaMaskNativeFeeChainId};

/** Normal status READ only. Owner supplies RID/project hash from its authentic journal; a service hint is not chain evidence. */
export async function readFixedMetaMaskNativeRequest(requestId: string, vendorProjectHash: string): Promise<MetaMaskNativeRequestObservation> {
  if (!/^[A-Za-z0-9._:-]{1,256}$/u.test(requestId) || !/^[a-f0-9]{64}$/u.test(vendorProjectHash))
    return {disposition: "unknown", reason: "provider_request_binding_invalid"};
  const runner = new NodeMetaMaskProcessRunner();
  let hint: MetaMaskNativeRequestObservation = {disposition: "unknown", reason: "provider_request_read_unavailable", requestId};
  try {
    if ((await readPolicy(runner)).vendorProjectHash !== vendorProjectHash) refuse();
    const result = await runner.runJson(["wallet", "requests", "watch", requestId, "--wallet-timeout", "1", "--json"], 6_000);
    try {hint = requestHint(result, requestId);} finally {result.stdout.fill(0);}
    if ((await readPolicy(runner)).vendorProjectHash !== vendorProjectHash) refuse();
    return hint;
  } catch {
    return {disposition: "unknown", reason: "provider_request_read_guard_changed_or_unavailable", requestId,
      ...("transactionHash" in hint && hint.transactionHash !== undefined ? {transactionHash: hint.transactionHash} : {}),
      ...(hint.chainId === undefined ? {} : {chainId: hint.chainId})};
  }
}

function requestHint(result: MetaMaskProcessResult, requestId: string): MetaMaskNativeRequestObservation {
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
  if (chainId !== undefined && (typeof chainId !== "number" || !CHAINS.has(chainId) || chainId === 10))
    return unknown("provider_request_chain_unsupported");
  const chainHint = chainId === undefined ? {} : {chainId: chainId as MetaMaskNativeFeeChainId};
  const hash = (value: unknown): Hex | undefined => typeof value === "string" && /^0x[a-fA-F0-9]{64}$/u.test(value) ? value.toLowerCase() as Hex : undefined;
  const requestHash = hash(request.txHash), statusHash = hash(status.txHash);
  if ((request.txHash !== undefined && request.txHash !== null && requestHash === undefined) ||
      (status.txHash !== undefined && status.txHash !== null && statusHash === undefined)) return unknown("provider_transaction_identity_invalid");
  if (requestHash !== undefined && statusHash !== undefined && requestHash !== statusHash) return unknown("provider_transaction_identity_conflict");
  const transactionHash = statusHash ?? requestHash;
  if (result.exitCode !== 0 || parsed.envelope?.ok !== true)
    return {disposition: "unknown", reason: "provider_request_outcome_unknown", requestId, ...chainHint,
      ...(transactionHash === undefined ? {} : {transactionHash})};
  if (transactionHash !== undefined) return {disposition: "acknowledged", transactionHash, requestId, ...chainHint};
  if (typeof status.status === "string" && EFFECT_STATES.has(status.status)) return {disposition: "pending", requestId, ...chainHint};
  return {disposition: "unknown", reason: "provider_request_outcome_unknown", requestId, ...chainHint};
}

function submissionHint(result: MetaMaskProcessResult): MetaMaskNativeSubmission {
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
    if (data.mode !== "server" || typeof data.address !== "string" || data.address.toLowerCase() !== PAYER)
      return unknown("provider_sender_mismatch");
    if (transactionHash !== undefined) return {disposition: "acknowledged", transactionHash};
    if (requestId !== undefined && typeof data.status === "string" && EFFECT_STATES.has(data.status))
      return {disposition: "pending", requestId};
  }
  if (notice.disposition === "pending" && parsed.envelope === null)
    return {disposition: "pending", requestId: notice.recoveryToken};
  return unknown("provider_private_handoff_outcome_unknown");
}
