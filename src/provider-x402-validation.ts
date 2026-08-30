import { canonicalJson, hashObject } from "./canonical.js";
import { BASE_USDC, CHAIN_CAIP2, TRANSFER_TOPIC } from "./constants.js";
import { ApnError } from "./errors.js";
import type { ProviderX402OperationRecord, ProviderX402ReceiptRecord, ProviderX402SettlementEvidence } from "./provider-x402-model.js";
import type { X402RpcBlock, X402RpcHead, X402RpcLog } from "./ports.js";

export function providerX402FrozenFingerprint(operation: ProviderX402OperationRecord): string {
  return hashObject({
    operationId: operation.operationId,
    idempotencyHash: operation.idempotencyHash,
    profile: operation.profile,
    profileHash: operation.profileHash,
    provider: operation.provider,
    request: {
      canonicalUrl: operation.request.canonicalUrl,
      method: operation.request.method,
      bodyState: operation.request.bodyState,
      bodyDigest: operation.request.bodyDigest,
      requestDigest: operation.request.requestDigest,
    },
    requirement: operation.requirement,
    policy: operation.policy,
    rpcBindingHash: operation.rpcBindingHash,
    rpcOriginHash: operation.rpcOriginHash,
  });
}

export function validateProviderX402Settlement(
  evidence: ProviderX402SettlementEvidence,
  operation: ProviderX402OperationRecord,
): void {
  const { evidenceHash: _evidenceHash, ...base } = evidence;
  const lower = operation.evidenceLowerBlock;
  const upper = operation.immutableUpperBlock;
  const transfer = evidence.transfer;
  if (
    evidence.schemaVersion !== "apn.provider-x402.settlement.v1" || evidence.evidenceHash !== hashObject(base) ||
    evidence.chainId !== "8453" || evidence.network !== CHAIN_CAIP2 || evidence.token !== BASE_USDC.toLowerCase() ||
    evidence.payer !== operation.provider.payer || evidence.payee !== operation.requirement.payee ||
    evidence.amountAtomic !== operation.requirement.amountAtomic || evidence.receiptStatus !== "success" ||
    evidence.rpcOriginHash !== operation.rpcOriginHash || lower === undefined || upper === undefined ||
    canonicalJson(evidence.lowerBlock) !== canonicalJson(lower) || canonicalJson(evidence.upperBlock) !== canonicalJson(upper) ||
    evidence.transactionHash !== transfer.transactionHash || !validBlock(lower, "safe") || !validBlock(upper, "number") ||
    !validTransfer(transfer, operation) || BigInt(transfer.blockNumber) < BigInt(lower.number) ||
    BigInt(transfer.blockNumber) > BigInt(upper.number) || BigInt(lower.number) >= BigInt(upper.number) ||
    Date.parse(operation.evidenceDeadlineAt ?? "") !== Date.parse(operation.transitions.find((item) => item.state === "started")?.at ?? "") + 240_000 ||
    BigInt(lower.timestamp) >= BigInt(Math.ceil(Date.parse(operation.evidenceDeadlineAt ?? "") / 1_000)) ||
    BigInt(upper.timestamp) < BigInt(Math.ceil(Date.parse(operation.evidenceDeadlineAt ?? "") / 1_000))
  ) corrupt();
}

export function assertProviderX402ReceiptAuthority(
  operation: ProviderX402OperationRecord,
  receipt: ProviderX402ReceiptRecord,
): void {
  const completed = receipt.terminalState === "completed";
  const settledWithoutResult = receipt.terminalState === "failed_settled_without_result";
  const receiptTime = Date.parse(receipt.createdAt);
  const operationTime = Date.parse(operation.updatedAt);
  if (
    receipt.operationId !== operation.operationId || receipt.fingerprint !== operation.fingerprint ||
    receipt.requestDigest !== operation.request.requestDigest || receipt.requirementDigest !== operation.requirement.digest ||
    receipt.payer !== operation.provider.payer || receipt.payee !== operation.requirement.payee ||
    receipt.amountAtomic !== operation.requirement.amountAtomic || receipt.network !== operation.requirement.network ||
    receipt.token !== operation.requirement.token || receipt.operationBindingHash !== providerBinding(operation) ||
    !canonicalUtc(receipt.createdAt) || receiptTime < Date.parse(operation.createdAt) ||
    (operation.terminal ? receiptTime > operationTime : receiptTime < operationTime) ||
    (operation.terminal && (
      receipt.terminalState !== operation.state || receipt.reason !== operation.reason || receipt.proofClass !== operation.proofClass
    )) ||
    (completed && (receipt.reason !== "x402_completed" || receipt.proofClass !== "x402_safe_settlement")) ||
    (settledWithoutResult && (
      receipt.reason !== "seller_result_missing" || receipt.proofClass !== "confirmed_settlement_without_seller_result"
    )) ||
    (!completed && !settledWithoutResult && receipt.proofClass !== "x402_proven_no_effect") ||
    (completed !== (operation.sellerResult !== undefined && operation.settlementEvidence !== undefined)) ||
    (settledWithoutResult !== (operation.sellerResult === undefined && operation.settlementEvidence !== undefined)) ||
    canonicalJson(receipt.settlement ?? null) !== canonicalJson(operation.settlementEvidence ?? null) ||
    canonicalJson(receipt.result ?? null) !== canonicalJson(operation.sellerResult === undefined ? null : {
      classification: operation.sellerResult.classification,
      sha256: operation.sellerResult.sha256,
      byteLength: operation.sellerResult.byte_length,
    })
  ) corrupt();
}

function providerBinding(operation: ProviderX402OperationRecord): string {
  const { integrityHash: _integrityHash, state: _state, finalityClass: _finalityClass, terminal: _terminal,
    reason: _reason, proofClass: _proofClass, nextActions: _nextActions, updatedAt: _updatedAt,
    transitions: _transitions, ...stable } = operation;
  return hashObject({ domain: "apn.provider-x402.binding.v2", stable });
}

export function providerX402CompleteBindingHash(operation: ProviderX402OperationRecord): string {
  return providerBinding(operation);
}

function validTransfer(log: X402RpcLog, operation: ProviderX402OperationRecord): boolean {
  return log.address === BASE_USDC.toLowerCase() && log.topics.length === 3 && log.topics[0] === TRANSFER_TOPIC &&
    log.topics[1] === addressTopic(operation.provider.payer) && log.topics[2] === addressTopic(operation.requirement.payee) &&
    /^0x[0-9a-f]{64}$/u.test(log.transactionHash) && !/^0x0{64}$/u.test(log.transactionHash) &&
    /^0x[0-9a-f]{64}$/u.test(log.blockHash) && !/^0x0{64}$/u.test(log.blockHash) &&
    /^(?:0|[1-9][0-9]*)$/u.test(log.blockNumber) && /^(?:0|[1-9][0-9]*)$/u.test(log.logIndex) &&
    /^0x[0-9a-f]{64}$/u.test(log.data) && BigInt(log.data) === BigInt(operation.requirement.amountAtomic);
}

function validBlock(block: X402RpcHead | X402RpcBlock, tag: "safe" | "number"): boolean {
  return block.queriedTag === tag && /^(?:0|[1-9][0-9]*)$/u.test(block.number) &&
    /^0x[0-9a-f]{64}$/u.test(block.hash) && !/^0x0{64}$/u.test(block.hash) &&
    /^(?:0|[1-9][0-9]*)$/u.test(block.timestamp) && canonicalUtc(block.observedAt) &&
    BigInt(block.timestamp) <= BigInt(Math.floor(Date.parse(block.observedAt) / 1_000));
}

function addressTopic(address: string): string {
  return `0x${address.slice(2).toLowerCase().padStart(64, "0")}`;
}

function canonicalUtc(value: string): boolean {
  return Number.isFinite(Date.parse(value)) && new Date(Date.parse(value)).toISOString() === value;
}

function corrupt(): never {
  throw new ApnError("APN_STATE_CORRUPT", "Provider x402 evidence or receipt authority is invalid.");
}
