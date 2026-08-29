import { canonicalJson, domainHash } from "./canonical.js";
import { BASE_USDC, CHAIN_CAIP2 } from "./constants.js";
import { validateSettlementEvidence, validateUnusedExpiryEvidence } from "./x402-evidence-validation.js";
import { validateStateTuple } from "./x402-operation-validation.js";
import type { X402ReceiptRecord, X402ResultRecord } from "./x402-state-model.js";
import {
  address,
  allowedRecord,
  exactRecord,
  hasUnpairedSurrogate,
  hash,
  mediaType,
  positive,
  stateCorrupt,
  timestamp,
  uint,
} from "./x402-state-validation-primitives.js";

export function validateX402ResultUnsafe(value: unknown): X402ResultRecord {
  const result = exactRecord(value, ["schemaVersion", "operationId", "mediaType", "bodyEncoding", "bodyText", "resultHash", "byteLength", "responseStatus", "createdAt", "integrityHash"]);
  if (result.schemaVersion !== "apn.x402.result.v1" || result.bodyEncoding !== "utf8" || result.responseStatus !== "200") stateCorrupt("x402 result discriminant is invalid.");
  hash(result.operationId); mediaType(result.mediaType);
  if (
    typeof result.bodyText !== "string" || hasUnpairedSurrogate(result.bodyText) ||
    Buffer.byteLength(result.bodyText, "utf8") > 256 * 1024
  ) stateCorrupt("x402 result body is invalid.");
  hash(result.resultHash); uint(result.byteLength); timestamp(result.createdAt); hash(result.integrityHash);
  if (result.byteLength !== Buffer.byteLength(result.bodyText as string, "utf8").toString() || result.resultHash !== domainHash("apn.x402.result-body.v1", result.bodyText as string)) stateCorrupt("x402 result body binding is invalid.");
  if (result.mediaType === "application/json") {
    try { JSON.parse(result.bodyText as string) as unknown; } catch { stateCorrupt("x402 JSON result body is invalid."); }
  }
  const { integrityHash: _hash, ...body } = result;
  if (result.integrityHash !== domainHash("apn.x402.result.v1", canonicalJson(body))) stateCorrupt("x402 result integrity hash is invalid.");
  return result as unknown as X402ResultRecord;
}

export function validateX402ReceiptUnsafe(value: unknown): X402ReceiptRecord {
  const receipt = allowedRecord(value, [
    "schemaVersion", "kind", "operationId", "terminalState", "reason", "proofClass", "resource", "fingerprint", "offerHash",
    "payer", "payee", "amountAtomic", "network", "token", "operationBindingHash", "previousLinkHash", "createdAt", "integrityHash",
  ], ["paymentIdentifier", "settlementResponseHash", "settlementEvidence", "unusedExpiryEvidence", "result"]);
  if (receipt.schemaVersion !== "apn.x402.receipt.v1" || receipt.kind !== "x402_fetch" || receipt.network !== CHAIN_CAIP2 || receipt.token !== BASE_USDC.toLowerCase()) stateCorrupt("x402 receipt discriminant is invalid.");
  hash(receipt.operationId);
  const terminalState = validateStateTuple(receipt.terminalState, true, receipt.reason, receipt.proofClass);
  if (!["completed", "failed_before_effect", "failed_expired_unused", "failed_settled_without_result"].includes(terminalState)) stateCorrupt("x402 receipt terminal state is invalid.");
  const resource = exactRecord(receipt.resource, ["origin", "path", "urlHash"]);
  if (typeof resource.origin !== "string" || new URL(resource.origin).origin !== resource.origin || !resource.origin.startsWith("https://") || typeof resource.path !== "string" || !resource.path.startsWith("/")) stateCorrupt("x402 receipt resource is invalid.");
  hash(resource.urlHash); hash(receipt.fingerprint); hash(receipt.offerHash); address(receipt.payer); address(receipt.payee); positive(receipt.amountAtomic);
  if (receipt.paymentIdentifier !== undefined && (typeof receipt.paymentIdentifier !== "string" || !/^apn_[a-f0-9]{64}$/u.test(receipt.paymentIdentifier))) stateCorrupt("x402 receipt payment identifier is invalid.");
  if (receipt.settlementResponseHash !== undefined) hash(receipt.settlementResponseHash);
  const settlementEvidence = receipt.settlementEvidence === undefined ? undefined : validateSettlementEvidence(receipt.settlementEvidence);
  const unusedExpiryEvidence = receipt.unusedExpiryEvidence === undefined ? undefined : validateUnusedExpiryEvidence(receipt.unusedExpiryEvidence);
  if (receipt.result !== undefined) {
    const result = exactRecord(receipt.result, ["resultHash", "mediaType", "byteLength", "resultIntegrityHash"]);
    hash(result.resultHash); mediaType(result.mediaType); uint(result.byteLength); hash(result.resultIntegrityHash);
  }
  if (terminalState === "completed" && (receipt.settlementResponseHash === undefined || settlementEvidence === undefined || receipt.result === undefined || unusedExpiryEvidence !== undefined)) stateCorrupt("x402 completed receipt is incomplete.");
  if (terminalState === "failed_settled_without_result" && (settlementEvidence === undefined || receipt.result !== undefined || unusedExpiryEvidence !== undefined)) stateCorrupt("x402 spent-without-result receipt is invalid.");
  if (terminalState === "failed_expired_unused" && (unusedExpiryEvidence === undefined || receipt.settlementResponseHash !== undefined || settlementEvidence !== undefined || receipt.result !== undefined)) stateCorrupt("x402 expired-unused receipt is invalid.");
  if (terminalState === "failed_before_effect" && (receipt.settlementResponseHash !== undefined || settlementEvidence !== undefined || unusedExpiryEvidence !== undefined || receipt.result !== undefined)) stateCorrupt("x402 failed-before-effect receipt is invalid.");
  hash(receipt.operationBindingHash); hash(receipt.previousLinkHash); timestamp(receipt.createdAt); hash(receipt.integrityHash);
  const { integrityHash: _hash, ...body } = receipt;
  if (receipt.integrityHash !== domainHash("apn.x402.receipt.v1", canonicalJson(body))) stateCorrupt("x402 receipt integrity hash is invalid.");
  return receipt as unknown as X402ReceiptRecord;
}

