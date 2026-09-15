import { keccak256 } from "viem";
import { hashObject } from "../../canonical.js";
import type {
  MetaMaskGaslessApproval,
  MetaMaskGaslessBlock,
  MetaMaskGaslessChainState,
  MetaMaskGaslessCursor,
  MetaMaskGaslessIntent,
  MetaMaskGaslessMutable,
  MetaMaskGaslessObservation,
  MetaMaskGaslessProviderObservation,
  MetaMaskGaslessSettlement,
  MetaMaskGaslessState,
} from "../model.js";
import { MM_MIN_REMAINING_MS, MM_TTL_MS, MM_ZERO_ADDRESS } from "../model.js";
import { mmAssertIntentEconomics } from "../economics.js";
import { mmBinding, mmPrivateHash } from "../identity.js";
import { mmRegistry } from "../registry.js";
import { MM_REASON_CODES, mmFail, type MetaMaskGaslessFailureReason } from "../reasons.js";
import { mmValidateUnsigned } from "../unsigned.js";
import { mmCanonicalAddress, mmExact, mmHash, mmHex, mmIso, mmRequest, mmSame, mmUint, mmUuid } from "../validation.js";

const PROFILE = /^[a-z0-9][a-z0-9._-]{0,63}$/u;
const EMPTY_CODE_HASH = "0xc5d2460186f7233c927e7db2dcc703c0e500b653ca82273b7bfad8045d85a470";
const STATES: readonly MetaMaskGaslessState[] = ["awaiting_approval", "execution_pending", "dispatch_pending",
  "submitted_pending", "unknown_finality", "failed_effects_pending", "completed", "failed_before_effect", "abandoned_unknown"];
const MUTABLE_KEYS = ["state", "approval", "submissionAttempts", "dispatchStartedAt", "providerObservation",
  "cursor", "observation", "settlement", "failure"] as const;

function corrupt(): never { return mmFail("mm_gasless_state_corrupt"); }
function time(value: string): number { return Date.parse(mmIso(value)); }
function recordMutable(value: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(MUTABLE_KEYS.map(key => [key, value[key]]));
}
function origin(value: unknown): string {
  if (typeof value !== "string" || value.length > 256) return corrupt();
  try {
    const parsed = new URL(value);
    if (parsed.protocol !== "https:" || parsed.origin !== value || parsed.username || parsed.password) corrupt();
  } catch { corrupt(); }
  return value;
}
function block(value: unknown): MetaMaskGaslessBlock {
  const b = mmExact(value, ["numberAtomic", "hash", "timestampAtomic"]);
  mmUint(b.numberAtomic); mmHex(b.hash, 32); mmUint(b.timestampAtomic);
  return b as unknown as MetaMaskGaslessBlock;
}
function blockOrder(first: MetaMaskGaslessBlock, second: MetaMaskGaslessBlock): void {
  if (BigInt(second.numberAtomic) < BigInt(first.numberAtomic) ||
    (second.numberAtomic === first.numberAtomic && !mmSame(first, second))) corrupt();
}
function chainState(value: unknown, chainId: MetaMaskGaslessIntent["request"]["chainId"]): MetaMaskGaslessChainState {
  const s = mmExact(value, ["protocolCodeHashes", "tokenProxyCodeHash", "tokenImplementationAddress",
    "tokenImplementationCodeHash", "tokenDecimals", "ownerCodeHash", "designation", "usdcBalanceAtomic", "counterAtomic"]);
  const codes = mmExact(s.protocolCodeHashes, ["manager", "delegate", "limitedCalls", "exactBatch"]);
  const row = mmRegistry(chainId).row;
  for (const name of ["manager", "delegate", "limitedCalls", "exactBatch"] as const) {
    if (mmHex(codes[name], 32) !== row.protocol[name].codeHash) corrupt();
  }
  if (mmHex(s.tokenProxyCodeHash, 32) !== row.tokenProxyCodeHash ||
    mmCanonicalAddress(s.tokenImplementationAddress) !== row.tokenImplementationAddress ||
    mmHex(s.tokenImplementationCodeHash, 32) !== row.tokenImplementationCodeHash || s.tokenDecimals !== 6 ||
    !["empty", "pinned"].includes(s.designation as string) || mmUint(s.counterAtomic).toString() !== "0") corrupt();
  const ownerCodeHash = mmHex(s.ownerCodeHash, 32);
  const pinnedOwnerCodeHash = keccak256(`0xef0100${row.protocol.delegate.address.slice(2)}`);
  if (ownerCodeHash !== (s.designation === "pinned" ? pinnedOwnerCodeHash : EMPTY_CODE_HASH)) corrupt();
  mmUint(s.usdcBalanceAtomic);
  return s as unknown as MetaMaskGaslessChainState;
}
function snapshot(value: unknown, chainId: MetaMaskGaslessIntent["request"]["chainId"]): MetaMaskGaslessIntent["initialSnapshot"] {
  const s = mmExact(value, ["chainId", "endpointHash", "endpointOrigin", "observedAt", "safeBlock", "headBlock",
    "safeState", "headState"]);
  if (s.chainId !== chainId) corrupt();
  mmHash(s.endpointHash); origin(s.endpointOrigin); mmIso(s.observedAt);
  const safeBlock = block(s.safeBlock), headBlock = block(s.headBlock); blockOrder(safeBlock, headBlock);
  chainState(s.safeState, chainId); chainState(s.headState, chainId);
  return s as unknown as MetaMaskGaslessIntent["initialSnapshot"];
}

export function mmJournalIntent(value: unknown, profileHash: string): MetaMaskGaslessIntent {
  const i = mmExact(value, ["profile", "request", "binding", "token", "decimals", "deploymentEvidenceHash",
    "initialSnapshot", "quote", "requestId", "unsignedDelegation", "delegationHash", "signingDigest", "relayTo",
    "mode", "preparedAt", "expiresAt", "policyHash"]);
  if (typeof i.profile !== "string" || !PROFILE.test(i.profile)) corrupt();
  const request = mmRequest(i.request, "mm_gasless_state_corrupt"), binding = mmBinding(i.binding, "mm_gasless_state_corrupt");
  mmCanonicalAddress(i.token); mmHash(i.deploymentEvidenceHash); mmUuid(i.requestId);
  const initial = snapshot(i.initialSnapshot, request.chainId);
  const preparedAt = mmIso(i.preparedAt), expiresAt = mmIso(i.expiresAt);
  if (time(expiresAt) - time(preparedAt) !== MM_TTL_MS || time(initial.observedAt) > time(preparedAt)) corrupt();
  const gross = mmUint(request.grossAtomic, true, "mm_gasless_state_corrupt");
  if (mmUint(initial.safeState.usdcBalanceAtomic, false, "mm_gasless_state_corrupt") < gross ||
    mmUint(initial.headState.usdcBalanceAtomic, false, "mm_gasless_state_corrupt") < gross) corrupt();
  mmHash(i.policyHash); mmHex(i.delegationHash, 32); mmHex(i.signingDigest, 32);
  mmCanonicalAddress(i.relayTo); mmHex(i.mode, 32);
  const intent = i as unknown as MetaMaskGaslessIntent;
  mmAssertIntentEconomics(intent, profileHash);
  mmValidateUnsigned({ unsignedDelegation: intent.unsignedDelegation, delegationHash: intent.delegationHash,
    signingDigest: intent.signingDigest, relayTo: intent.relayTo, mode: intent.mode },
  { owner: binding.address, chainId: request.chainId, executions: intent.quote.executions }, "mm_gasless_state_corrupt");
  return intent;
}

function approval(value: unknown, fingerprint: string, expiresAt: string, at: string): MetaMaskGaslessApproval | null {
  if (value === null) return null;
  const a = mmExact(value, ["fingerprint", "approvedAt", "expiresAt"]);
  if (mmHash(a.fingerprint) !== fingerprint || mmIso(a.expiresAt) !== expiresAt ||
    time(mmIso(a.approvedAt)) > time(at) || time(a.approvedAt as string) >= time(expiresAt)) corrupt();
  return a as unknown as MetaMaskGaslessApproval;
}
function providerObservation(value: unknown, intent: MetaMaskGaslessIntent, at: string): MetaMaskGaslessProviderObservation | null {
  if (value === null) return null;
  const p = mmExact(value, ["observedAt", "requestIdHash", "status", "txHash"]);
  if (time(mmIso(p.observedAt)) > time(at) || p.requestIdHash !== mmPrivateHash("request-id", intent.requestId) ||
    !["awaiting_approval", "pending", "broadcasted", "confirmed", "failed", "unavailable"].includes(p.status as string)) corrupt();
  if (p.txHash !== null) mmHex(p.txHash, 32);
  return p as unknown as MetaMaskGaslessProviderObservation;
}
function cursor(value: unknown, intent: MetaMaskGaslessIntent): MetaMaskGaslessCursor {
  const c = mmExact(value, ["startBlock", "nextBlockAtomic", "previousEndBlock"]);
  const startBlock = block(c.startBlock);
  if (!mmSame(startBlock, intent.initialSnapshot.safeBlock)) corrupt();
  const next = mmUint(c.nextBlockAtomic);
  if (next < BigInt(startBlock.numberAtomic)) corrupt();
  if (c.previousEndBlock !== null) {
    const previous = block(c.previousEndBlock);
    if (BigInt(previous.numberAtomic) < BigInt(startBlock.numberAtomic) || BigInt(previous.numberAtomic) + 1n !== next) corrupt();
  } else if (next !== BigInt(startBlock.numberAtomic)) corrupt();
  return c as unknown as MetaMaskGaslessCursor;
}
function observation(value: unknown, at: string): MetaMaskGaslessObservation | null {
  if (value === null) return null;
  const sourced = typeof value === "object" && value !== null && Object.hasOwn(value, "source");
  const o = mmExact(value, ["observedAt", "phase", "reason", "candidateTxHash", "transactionBlock", "finalityBlock", "evidenceHash",
    ...(sourced ? ["source"] : [])]);
  if (sourced) observationSource(o.source);
  if (time(mmIso(o.observedAt)) > time(at) || !["pending", "unavailable", "invalid", "reorg", "reverted", "success"].includes(o.phase as string) ||
    typeof o.reason !== "string" || !Object.hasOwn(MM_REASON_CODES, o.reason)) corrupt();
  const exactReason: Readonly<Record<string, string>> = { pending: "mm_gasless_pending", unavailable: "mm_gasless_rpc_unavailable",
    reorg: "mm_gasless_scan_reorg", reverted: "mm_gasless_transaction_reverted", success: "mm_gasless_success" };
  if (o.phase !== "invalid" && o.reason !== exactReason[o.phase as string]) corrupt();
  if (o.phase === "invalid" && !["mm_gasless_evidence_invalid", "mm_gasless_rpc_binding"].includes(o.reason as string)) corrupt();
  if (o.candidateTxHash !== null) mmHex(o.candidateTxHash, 32);
  const transaction = o.transactionBlock === null ? null : block(o.transactionBlock);
  const finality = o.finalityBlock === null ? null : block(o.finalityBlock);
  if (transaction !== null && finality !== null) blockOrder(transaction, finality);
  if (o.evidenceHash !== null) mmHash(o.evidenceHash);
  if (["success", "reverted"].includes(o.phase as string) &&
    (o.candidateTxHash === null || transaction === null || finality === null || o.evidenceHash === null)) corrupt();
  return o as unknown as MetaMaskGaslessObservation;
}
function observationSource(value: unknown): void {
  const s = mmExact(value, ["environmentName", "endpointOrigin", "endpointHash"]);
  if (typeof s.environmentName !== "string" || s.environmentName.length > 128 || !/^APN_[A-Z0-9_]+_RPC_URL$/u.test(s.environmentName)) corrupt();
  origin(s.endpointOrigin); mmHash(s.endpointHash);
}
function settlement(value: unknown, intent: MetaMaskGaslessIntent, at: string): MetaMaskGaslessSettlement | null {
  if (value === null) return null;
  const s = mmExact(value, ["observedAt", "txHash", "transactionBlock", "finalityBlock", "outerSender", "transactionProofHash",
    "receiptHash", "protocolHash", "tokenImplementationHash", "deliveredAtomic", "feeAtomic", "debitAtomic", "refundAtomic",
    "unusedGrossAtomic", "designation", "permission", "receiptCounterAtomic", "finalityCounterAtomic"]);
  if (time(mmIso(s.observedAt)) > time(at)) corrupt();
  mmHex(s.txHash, 32); const transaction = block(s.transactionBlock), finality = block(s.finalityBlock); blockOrder(transaction, finality);
  if (BigInt(transaction.numberAtomic) < BigInt(intent.initialSnapshot.safeBlock.numberAtomic)) corrupt();
  const outer = mmCanonicalAddress(s.outerSender);
  if (outer === MM_ZERO_ADDRESS || outer === intent.binding.address) corrupt();
  mmHash(s.transactionProofHash); mmHash(s.receiptHash); mmHash(s.protocolHash); mmHash(s.tokenImplementationHash);
  const deployment = mmRegistry(intent.request.chainId), row = deployment.row;
  const protocolHash = hashObject({ deploymentEvidenceHash: deployment.deploymentEvidenceHash,
    receipt: { block: transaction, code: Object.fromEntries(Object.entries(row.protocol).map(([name, pin]) =>
      [name, pin.codeHash])) },
    finality: { block: finality, code: Object.fromEntries(Object.entries(row.protocol).map(([name, pin]) =>
      [name, pin.codeHash])) } });
  const tokenState = { address: row.tokenImplementationAddress, codeHash: row.tokenImplementationCodeHash,
    proxyCodeHash: row.tokenProxyCodeHash };
  const tokenImplementationHash = hashObject({ token: row.token,
    receipt: { block: transaction, ...tokenState }, finality: { block: finality, ...tokenState } });
  if (s.protocolHash !== protocolHash || s.tokenImplementationHash !== tokenImplementationHash ||
    s.deliveredAtomic !== intent.quote.netAtomic || s.feeAtomic !== intent.quote.feeAtomic ||
    s.debitAtomic !== intent.request.grossAtomic || s.refundAtomic !== "0" || s.unusedGrossAtomic !== "0" ||
    s.designation !== "pinned" || s.permission !== "consumed" || s.receiptCounterAtomic !== "1" || s.finalityCounterAtomic !== "1") corrupt();
  return s as unknown as MetaMaskGaslessSettlement;
}
function failure(value: unknown): MetaMaskGaslessMutable["failure"] {
  if (value === null) return null;
  const f = mmExact(value, ["code", "reason"]);
  if (typeof f.reason !== "string" || f.reason === "mm_gasless_success" || !Object.hasOwn(MM_REASON_CODES, f.reason) ||
    f.code !== MM_REASON_CODES[f.reason as MetaMaskGaslessFailureReason]) corrupt();
  return f as unknown as MetaMaskGaslessMutable["failure"];
}

export function mmJournalMutable(value: Record<string, unknown>, intent: MetaMaskGaslessIntent,
  fingerprint: string, atInput: unknown): MetaMaskGaslessMutable {
  const at = mmIso(atInput), m = mmExact(recordMutable(value), MUTABLE_KEYS);
  if (!STATES.includes(m.state as MetaMaskGaslessState) || (m.submissionAttempts !== 0 && m.submissionAttempts !== 1)) corrupt();
  const a = approval(m.approval, fingerprint, intent.expiresAt, at);
  const dispatch = m.dispatchStartedAt === null ? null : mmIso(m.dispatchStartedAt);
  if ((m.submissionAttempts === 0) !== (dispatch === null) ||
    (dispatch !== null && (a === null || time(dispatch) > time(at) || time(dispatch) < time(a.approvedAt) ||
      time(dispatch) + MM_MIN_REMAINING_MS > time(intent.expiresAt)))) corrupt();
  const provider = providerObservation(m.providerObservation, intent, at), c = cursor(m.cursor, intent), o = observation(m.observation, at);
  const settled = settlement(m.settlement, intent, at), failed = failure(m.failure);
  const state = m.state as MetaMaskGaslessState, before = m.submissionAttempts === 0;
  const initialCursor = { startBlock: intent.initialSnapshot.safeBlock,
    nextBlockAtomic: intent.initialSnapshot.safeBlock.numberAtomic, previousEndBlock: null };
  if ((before || state === "dispatch_pending") && !mmSame(c, initialCursor)) corrupt();
  if (["awaiting_approval", "execution_pending"].includes(state) && (!before || provider !== null || o !== null || settled !== null || failed !== null)) corrupt();
  if (state === "awaiting_approval" && a !== null) corrupt();
  if (state === "execution_pending" && a === null) corrupt();
  if (state === "dispatch_pending" && (before || a === null || provider !== null || o !== null || settled !== null || failed !== null)) corrupt();
  if (state === "failed_before_effect" && (!before || provider !== null || o !== null || settled !== null || failed === null)) corrupt();
  if (state === "abandoned_unknown" && (before || a === null || settled !== null || failed?.reason !== "mm_gasless_owner_abandoned")) corrupt();
  if (state === "submitted_pending" && (before || a === null || settled !== null || failed?.reason !== "mm_gasless_pending" ||
    provider === null || !["broadcasted", "confirmed"].includes(provider.status) ||
    provider.txHash === null || o === null || o.phase !== "pending" || o.candidateTxHash !== provider.txHash)) corrupt();
  if (state === "unknown_finality" && (before || a === null || settled !== null || failed === null || o?.phase === "reverted" || o?.phase === "success")) corrupt();
  if (state === "failed_effects_pending" && (before || a === null || settled !== null ||
    failed?.reason !== "mm_gasless_transaction_reverted" || o === null || o.phase === "success")) corrupt();
  if (state === "completed" && (before || a === null || failed !== null || settled === null || o?.phase !== "success" ||
    o.candidateTxHash !== settled.txHash || !mmSame(o.transactionBlock, settled.transactionBlock) ||
    !mmSame(o.finalityBlock, settled.finalityBlock) || o.observedAt !== settled.observedAt)) corrupt();
  return { state, approval: a, submissionAttempts: m.submissionAttempts as 0 | 1, dispatchStartedAt: dispatch,
    providerObservation: provider, cursor: c, observation: o, settlement: settled, failure: failed };
}
