import { canonicalJson, domainHash, exactKeys, hashObject, isPlainRecord, sha256 } from "./canonical.js";
import { BASE_USDC, CHAIN_CAIP2 } from "./constants.js";
import { ApnError } from "./errors.js";
import type { ProviderX402Invocation, ProviderX402SellerResult } from "./provider-ports.js";
import type { ProfilePolicyRecord } from "./profile-policy.js";
import type { X402RpcBlock, X402RpcHead, X402RpcLog } from "./ports.js";
import { canonicalizeNormalizedProviderJson } from "./normalized-provider-json.js";
import { x402WaitProjectedStatus, type X402SettlementWaitProjection } from "./x402-state-integrity.js";
import {
  providerX402CompleteBindingHash,
  providerX402FrozenFingerprint,
  validateProviderX402Settlement,
} from "./provider-x402-validation.js";
import { providerX402SettledWithoutResultProof } from "./provider-x402-proof.js";
import {
  validateProviderX402TransactionRecoveryBinding,
  validateProviderX402TransactionRecoveryContinuity,
  type ProviderX402TransactionRecoveryBinding,
} from "./provider-x402-transaction-recovery-model.js";
export type { ProviderX402TransactionRecoveryBinding } from "./provider-x402-transaction-recovery-model.js";

export const PROVIDER_X402_STATE_VERSION = "apn.provider-x402.state.v1" as const;
export type ProviderX402State =
  | "preparing"
  | "awaiting_approval"
  | "started"
  | "settlement_pending"
  | "ambiguous_effect"
  | "completed"
  | "failed_before_effect"
  | "failed_settled_without_result";

export interface ProviderX402Transition {
  readonly sequence: string;
  readonly at: string;
  readonly state: ProviderX402State;
  readonly reason: string;
  readonly proofClass: string;
  readonly previousHash: string;
  readonly hash: string;
}

export interface ProviderX402PolicyBinding {
  readonly schemaVersion: ProfilePolicyRecord["schemaVersion"];
  readonly integrityHash: string;
  readonly updatedAt: string;
  readonly walletBindingHash: string;
  readonly maxBalanceUsdcAtomic: string;
  readonly maxX402AmountAtomic: string;
  readonly callerCapAtomic?: string;
  readonly effectiveCapAtomic: string;
  readonly verdict: "authorized_by_existing_profile_policy";
}

export interface ProviderX402RangeSettlementEvidence {
  readonly schemaVersion: "apn.provider-x402.settlement.v1";
  readonly lowerBlock: X402RpcHead;
  readonly upperBlock: X402RpcBlock;
  readonly transactionHash: `0x${string}`;
  readonly receiptStatus: "success";
  readonly transfer: X402RpcLog;
  readonly chainId: "8453";
  readonly network: typeof CHAIN_CAIP2;
  readonly token: `0x${string}`;
  readonly payer: `0x${string}`;
  readonly payee: `0x${string}`;
  readonly amountAtomic: string;
  readonly rpcOriginHash: string;
  readonly evidenceHash: string;
}

export interface ProviderX402TransactionSettlementEvidence {
  readonly schemaVersion: "apn.provider-x402.transaction-settlement.v1";
  readonly chainId: "8453";
  readonly network: typeof CHAIN_CAIP2;
  readonly token: `0x${string}`;
  readonly transactionHash: `0x${string}`;
  readonly receiptStatus: "success";
  readonly receiptBlock: X402RpcBlock;
  readonly safeHead: X402RpcHead;
  readonly payer: `0x${string}`;
  readonly payee: `0x${string}`;
  readonly amountAtomic: string;
  readonly transfer: {
    readonly logIndex: string;
    readonly blockNumber: string;
    readonly blockHash: `0x${string}`;
    readonly transactionHash: `0x${string}`;
  };
  readonly qualifyingTransferCount: "1";
  readonly rpcOriginHash: string;
  readonly observedAt: string;
  readonly evidenceHash: string;
}

export type ProviderX402SettlementEvidence =
  | ProviderX402RangeSettlementEvidence
  | ProviderX402TransactionSettlementEvidence;

export interface ProviderX402OperationRecord {
  readonly schemaVersion: typeof PROVIDER_X402_STATE_VERSION;
  readonly kind: "x402_fetch";
  readonly executionMode: "provider_atomic_paid_fetch";
  readonly operationId: string;
  readonly idempotencyHash: string;
  readonly profile: string;
  readonly profileHash: string;
  readonly requestHash: string;
  readonly fingerprint: string;
  readonly provider: {
    readonly providerId: string;
    readonly profileRevision: number;
    readonly capabilityHash: string;
    readonly accountBindingHash: string;
    readonly payer: `0x${string}`;
    readonly executionOwner: "provider";
    readonly retryOwner: "apn_outer_no_replay_journal";
  };
  readonly request: {
    readonly canonicalUrl: string;
    readonly origin: string;
    readonly path: string;
    readonly urlHash: string;
    readonly method: "GET";
    readonly bodyState: "absent";
    readonly bodyDigest: string;
    readonly metadataDigest: string;
    readonly requestDigest: string;
  };
  readonly requirement: {
    readonly x402Version: "2";
    readonly scheme: "exact";
    readonly network: typeof CHAIN_CAIP2;
    readonly token: `0x${string}`;
    readonly decimals: 6;
    readonly payee: `0x${string}`;
    readonly amountAtomic: string;
    readonly declaredCanonicalJson: string;
    readonly digest: string;
  };
  readonly policy: ProviderX402PolicyBinding;
  readonly preparedBalance?: {
    readonly amountAtomic: string;
    readonly observedAt: string;
    readonly accountBindingHash: string;
  };
  readonly rpcBindingHash: string;
  readonly rpcOriginHash: string;
  readonly finalPreflight?: { readonly requirementDigest: string; readonly observedAt: string };
  readonly evidenceLowerBlock?: X402RpcHead;
  readonly evidenceDeadlineAt?: string;
  readonly immutableUpperBlock?: X402RpcBlock;
  readonly invocation?: ProviderX402Invocation;
  readonly sellerResult?: ProviderX402SellerResult;
  readonly transactionRecovery?: ProviderX402TransactionRecoveryBinding;
  readonly settlementEvidence?: ProviderX402SettlementEvidence;
  readonly state: ProviderX402State;
  readonly finalityClass: "pre_effect" | "unknown_finality" | "terminal";
  readonly terminal: boolean;
  readonly reason: string;
  readonly proofClass: string;
  readonly nextActions: readonly string[];
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly transitions: readonly ProviderX402Transition[];
  readonly integrityHash: string;
}

export interface ProviderX402ReceiptRecord {
  readonly schemaVersion: "apn.provider-x402.receipt.v1";
  readonly kind: "x402_fetch";
  readonly operationId: string;
  readonly terminalState: "completed" | "failed_before_effect" | "failed_settled_without_result";
  readonly reason: string;
  readonly proofClass: string;
  readonly fingerprint: string;
  readonly requestDigest: string;
  readonly requirementDigest: string;
  readonly payer: `0x${string}`;
  readonly payee: `0x${string}`;
  readonly amountAtomic: string;
  readonly network: typeof CHAIN_CAIP2;
  readonly token: `0x${string}`;
  readonly result?: {
    readonly classification: "normalized_provider_json";
    readonly sha256: string;
    readonly byteLength: string;
  };
  readonly settlement?: ProviderX402SettlementEvidence;
  readonly operationBindingHash: string;
  readonly createdAt: string;
  readonly integrityHash: string;
}

export function providerX402RequestHash(input: {
  readonly profile: string;
  readonly canonicalUrl: string;
  readonly rpcUrl: string;
  readonly callerCapAtomic?: string;
}): string {
  return hashObject({
    method: "x402.fetch.prepare",
    profile: input.profile,
    canonicalUrl: input.canonicalUrl,
    rpcUrl: input.rpcUrl,
    methodShape: "GET_absent_body",
    callerCapAtomic: input.callerCapAtomic ?? null,
  });
}

export function providerX402BindingHash(operation: ProviderX402OperationRecord): string {
  return providerX402CompleteBindingHash(operation);
}

export function providerX402InvocationIntentHash(input: {
  readonly correlationId: string;
  readonly canonicalUrl: string;
  readonly amountAtomic: string;
  readonly requestDigest: string;
}): string {
  return domainHash("apn.provider-x402.invocation-intent.v1", canonicalJson(input));
}

export function appendProviderX402Transition(
  transitions: readonly ProviderX402Transition[],
  input: Omit<ProviderX402Transition, "sequence" | "previousHash" | "hash">,
): readonly ProviderX402Transition[] {
  const previousHash = transitions.at(-1)?.hash ?? "0".repeat(64);
  const base = { sequence: (transitions.length + 1).toString(), ...input, previousHash };
  return [...transitions, { ...base, hash: domainHash("apn.provider-x402.transition.v1", canonicalJson(base)) }];
}

export function sealProviderX402Operation(
  value: Omit<ProviderX402OperationRecord, "integrityHash">,
): ProviderX402OperationRecord {
  return { ...value, integrityHash: hashObject(value) };
}

export function sealProviderX402Receipt(
  value: Omit<ProviderX402ReceiptRecord, "integrityHash">,
): ProviderX402ReceiptRecord {
  return { ...value, integrityHash: hashObject(value) };
}

export function validateProviderX402Operation(value: unknown): ProviderX402OperationRecord {
  if (!isPlainRecord(value)) corrupt();
  const operation = value as unknown as ProviderX402OperationRecord;
  const without = { ...operation, integrityHash: undefined } as Record<string, unknown>;
  delete without.integrityHash;
  if (
    operation.schemaVersion !== PROVIDER_X402_STATE_VERSION || operation.kind !== "x402_fetch" ||
    operation.executionMode !== "provider_atomic_paid_fetch" || !hash(operation.operationId) ||
    !hash(operation.idempotencyHash) || !hash(operation.profileHash) || !hash(operation.requestHash) ||
    !hash(operation.fingerprint) || operation.fingerprint !== providerX402FrozenFingerprint(operation) ||
    operation.integrityHash !== hashObject(without) ||
    operation.provider?.executionOwner !== "provider" ||
    operation.provider.retryOwner !== "apn_outer_no_replay_journal" || operation.request?.method !== "GET" ||
    operation.request.bodyState !== "absent" || operation.requirement?.x402Version !== "2" ||
    operation.requirement.scheme !== "exact" || operation.requirement.network !== CHAIN_CAIP2 ||
    operation.requirement.token !== BASE_USDC.toLowerCase() || operation.requirement.decimals !== 6 ||
    !positive(operation.requirement.amountAtomic) || operation.policy?.verdict !== "authorized_by_existing_profile_policy" ||
    BigInt(operation.requirement.amountAtomic) > BigInt(operation.policy.effectiveCapAtomic) ||
    (operation.preparedBalance !== undefined && operation.preparedBalance.accountBindingHash !== operation.provider.accountBindingHash) ||
    !Array.isArray(operation.transitions) || operation.transitions.length === 0 ||
    operation.transitions.at(-1)?.state !== operation.state || operation.transitions.at(-1)?.reason !== operation.reason ||
    operation.transitions.at(-1)?.proofClass !== operation.proofClass ||
    operation.terminal !== ["completed", "failed_before_effect", "failed_settled_without_result"].includes(operation.state)
  ) corrupt();
  validateTransitions(operation.transitions);
  if (operation.invocation !== undefined) validateInvocation(operation.invocation, operation);
  if (operation.sellerResult !== undefined) validateSellerResult(operation.sellerResult, operation.requirement.amountAtomic);
  if (operation.transactionRecovery !== undefined) {
    validateProviderX402TransactionRecoveryBinding(operation.transactionRecovery, operation.operationId);
  }
  if (operation.settlementEvidence !== undefined) validateProviderX402Settlement(operation.settlementEvidence, operation);
  if (operation.settlementEvidence?.schemaVersion === "apn.provider-x402.transaction-settlement.v1" && (
    operation.transactionRecovery?.stage !== "evidence_validated" ||
    operation.transactionRecovery.evidenceDigest !== operation.settlementEvidence.evidenceHash ||
    operation.transactionRecovery.transactionHash !== operation.settlementEvidence.transactionHash
  )) corrupt();
  if (operation.sellerResult !== undefined && operation.invocation === undefined) corrupt();
  if (!["preparing", "failed_before_effect"].includes(operation.state) && operation.preparedBalance === undefined) corrupt();
  if (!["preparing", "awaiting_approval", "failed_before_effect"].includes(operation.state) && (
    operation.finalPreflight?.requirementDigest !== operation.requirement.digest ||
    operation.evidenceLowerBlock === undefined || operation.evidenceDeadlineAt === undefined
  )) corrupt();
  if (operation.state === "completed" && (operation.sellerResult === undefined || operation.settlementEvidence === undefined)) corrupt();
  if (operation.state === "failed_settled_without_result" && (
    operation.reason !== "seller_result_missing" ||
    operation.proofClass !== providerX402SettledWithoutResultProof(operation.settlementEvidence) ||
    operation.sellerResult !== undefined || operation.settlementEvidence === undefined
  )) corrupt();
  return operation;
}

export function validateProviderX402Receipt(value: unknown): ProviderX402ReceiptRecord {
  if (!isPlainRecord(value)) corrupt();
  const receipt = value as unknown as ProviderX402ReceiptRecord;
  if (!exactKeys(value, [
    "schemaVersion", "kind", "operationId", "terminalState", "reason", "proofClass", "fingerprint",
    "requestDigest", "requirementDigest", "payer", "payee", "amountAtomic", "network", "token",
    ...(receipt.result === undefined ? [] : ["result"]),
    ...(receipt.settlement === undefined ? [] : ["settlement"]),
    "operationBindingHash", "createdAt", "integrityHash",
  ])) corrupt();
  const without = { ...receipt, integrityHash: undefined } as Record<string, unknown>;
  delete without.integrityHash;
  if (
    receipt.schemaVersion !== "apn.provider-x402.receipt.v1" || receipt.kind !== "x402_fetch" ||
    !hash(receipt.operationId) || !hash(receipt.fingerprint) || !hash(receipt.requestDigest) ||
    !hash(receipt.requirementDigest) || receipt.integrityHash !== hashObject(without) ||
    !["completed", "failed_before_effect", "failed_settled_without_result"].includes(receipt.terminalState) ||
    receipt.network !== CHAIN_CAIP2 || receipt.token !== BASE_USDC.toLowerCase()
  ) corrupt();
  if (receipt.result !== undefined && (
    receipt.result.classification !== "normalized_provider_json" || !hash(receipt.result.sha256) ||
    !/^(?:0|[1-9][0-9]*)$/u.test(receipt.result.byteLength)
  )) corrupt();
  if (receipt.terminalState === "completed" && (receipt.result === undefined || receipt.settlement === undefined)) corrupt();
  if (receipt.terminalState === "failed_before_effect" && (receipt.result !== undefined || receipt.settlement !== undefined)) corrupt();
  if (receipt.terminalState === "failed_settled_without_result" && (
    receipt.reason !== "seller_result_missing" ||
    receipt.proofClass !== providerX402SettledWithoutResultProof(receipt.settlement) ||
    receipt.result !== undefined || receipt.settlement === undefined
  )) corrupt();
  return receipt;
}

export function validateProviderX402Continuity(
  previous: ProviderX402OperationRecord,
  next: ProviderX402OperationRecord,
): void {
  for (const key of [
    "schemaVersion", "kind", "executionMode", "operationId", "idempotencyHash", "profile", "profileHash",
    "requestHash", "fingerprint", "provider", "request", "requirement", "policy",
    "rpcBindingHash", "rpcOriginHash", "createdAt",
  ] as const) if (canonicalJson(previous[key]) !== canonicalJson(next[key])) corrupt();
  for (const key of [
    "preparedBalance", "finalPreflight", "evidenceLowerBlock", "evidenceDeadlineAt", "immutableUpperBlock",
    "invocation", "sellerResult", "settlementEvidence",
  ] as const) {
    if (previous[key] !== undefined && canonicalJson(previous[key]) !== canonicalJson(next[key])) corrupt();
  }
  validateProviderX402TransactionRecoveryContinuity(previous.transactionRecovery, next.transactionRecovery);
  if (next.transitions.length !== previous.transitions.length + 1) corrupt();
  for (let index = 0; index < previous.transitions.length; index += 1) {
    if (canonicalJson(previous.transitions[index]) !== canonicalJson(next.transitions[index])) corrupt();
  }
  if (previous.terminal) corrupt();
  const allowed: Readonly<Record<ProviderX402State, readonly ProviderX402State[]>> = {
    preparing: ["preparing", "awaiting_approval", "failed_before_effect"],
    awaiting_approval: ["started", "failed_before_effect"],
    started: ["settlement_pending", "ambiguous_effect", "failed_before_effect"],
    settlement_pending: ["settlement_pending", "ambiguous_effect", "completed", "failed_settled_without_result"],
    ambiguous_effect: ["ambiguous_effect", "settlement_pending", "failed_settled_without_result"],
    completed: [],
    failed_before_effect: [],
    failed_settled_without_result: [],
  };
  if (!allowed[previous.state].includes(next.state)) corrupt();
  if (previous.state === "ambiguous_effect" && next.state === "settlement_pending" && (
    !["provider_evidence_capability_gap", "settlement_receipt_missing"].includes(previous.reason) ||
    next.reason !== "x402_settlement_verified" || next.proofClass !== "x402_settlement_verified_result_pending" ||
    next.sellerResult === undefined || next.settlementEvidence === undefined
  )) corrupt();
}

export function publicProviderX402Operation(
  operation: ProviderX402OperationRecord,
  settlementWait?: X402SettlementWaitProjection,
): unknown {
  const waitStatus = x402WaitProjectedStatus(operation, settlementWait);
  const value = {
    schemaVersion: "apn.x402.public-operation.v1",
    kind: operation.kind,
    operationId: operation.operationId,
    state: operation.state,
    finalityClass: operation.finalityClass,
    terminal: operation.terminal,
    reason: waitStatus.reason,
    proofClass: waitStatus.proofClass,
    nextActions: operation.nextActions,
    createdAt: operation.createdAt,
    updatedAt: operation.updatedAt,
    resource: { origin: operation.request.origin, path: operation.request.path, urlHash: operation.request.urlHash },
    payer: operation.provider.payer,
    payee: operation.requirement.payee,
    amountAtomic: operation.requirement.amountAtomic,
    network: operation.requirement.network,
    token: operation.requirement.token,
    ...(operation.sellerResult === undefined ? {} : {
      result: {
        classification: operation.sellerResult.classification,
        resultHash: operation.sellerResult.sha256,
        byteLength: operation.sellerResult.byte_length,
      },
    }),
    ...(operation.settlementEvidence === undefined ? {} : {
      transactionHash: operation.settlementEvidence.transactionHash,
      blockNumber: settlementBlock(operation.settlementEvidence).number,
      blockHash: settlementBlock(operation.settlementEvidence).hash,
    }),
    ...(settlementWait === undefined ? {} : { settlementWait }),
  };
  return { ...value, integrityHash: domainHash("apn.x402.public-operation.v1", canonicalJson(value)) };
}

function settlementBlock(evidence: ProviderX402SettlementEvidence): { readonly number: string; readonly hash: `0x${string}` } {
  return evidence.schemaVersion === "apn.provider-x402.transaction-settlement.v1"
    ? evidence.receiptBlock
    : { number: evidence.transfer.blockNumber, hash: evidence.transfer.blockHash };
}

function validateTransitions(transitions: readonly ProviderX402Transition[]): void {
  let previous = "0".repeat(64);
  transitions.forEach((transition, index) => {
    const { hash: actual, ...base } = transition;
    if (transition.sequence !== String(index + 1) || transition.previousHash !== previous ||
        actual !== domainHash("apn.provider-x402.transition.v1", canonicalJson(base))) corrupt();
    previous = actual;
  });
}

function validateSellerResult(result: ProviderX402SellerResult, amount: string): void {
  if (
    result.classification !== "normalized_provider_json" || result.payment_made !== true ||
    result.amount_paid_atomic !== amount || !/^(?:2[0-9]{2})$/u.test(result.http_status) ||
    result.byte_length !== Buffer.byteLength(result.canonical_json, "utf8").toString() ||
    result.sha256 !== sha256(result.canonical_json)
  ) corrupt();
  try {
    const parsed = JSON.parse(result.canonical_json) as unknown;
    if (canonicalizeNormalizedProviderJson(parsed) !== result.canonical_json) corrupt();
  }
  catch { corrupt(); }
}

function validateInvocation(invocation: ProviderX402Invocation, operation: ProviderX402OperationRecord): void {
  if (
    !isPlainRecord(invocation) || !exactKeys(invocation, [
      "correlation_id", "request_digest", "intent_binding_hash", "child_identity_hash",
      "output_sha256", "output_byte_length",
    ]) || invocation.correlation_id !== operation.operationId || invocation.request_digest !== operation.request.requestDigest ||
    invocation.intent_binding_hash !== providerX402InvocationIntentHash({
      correlationId: operation.operationId,
      canonicalUrl: operation.request.canonicalUrl,
      amountAtomic: operation.requirement.amountAtomic,
      requestDigest: operation.request.requestDigest,
    }) ||
    !hash(invocation.child_identity_hash) || !hash(invocation.output_sha256) ||
    !/^(?:0|[1-9][0-9]*)$/u.test(invocation.output_byte_length) || BigInt(invocation.output_byte_length) > 262_144n
  ) corrupt();
}

function hash(value: unknown): value is string { return typeof value === "string" && /^[a-f0-9]{64}$/u.test(value); }
function positive(value: unknown): value is string { return typeof value === "string" && /^[1-9][0-9]*$/u.test(value); }
function corrupt(): never { throw new ApnError("APN_STATE_CORRUPT", "Provider x402 protected state validation failed."); }
