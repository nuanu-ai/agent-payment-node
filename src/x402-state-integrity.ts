import { canonicalJson, domainHash, sha256 } from "./canonical.js";
import { ApnError } from "./errors.js";
import { validateX402ResultUnsafe, validateX402ReceiptUnsafe } from "./x402-artifact-validation.js";
import { validateX402OperationUnsafe } from "./x402-operation-validation.js";
import type { X402OperationRecord, X402ReceiptRecord, X402ResultRecord } from "./x402-state-model.js";
import { stateCorrupt } from "./x402-state-validation-primitives.js";

export * from "./x402-state-model.js";

export function validateX402Operation(value: unknown): X402OperationRecord {
  try {
    return validateX402OperationUnsafe(value);
  } catch (error) {
    if (error instanceof ApnError && error.code === "APN_STATE_CORRUPT") throw error;
    stateCorrupt("x402 operation protected state validation failed.");
  }
}

export interface X402SettlementWaitProjection {
  /** `not_exposed`: the payment was never sent, so nothing settles; the operation's own state and actions say what follows. */
  readonly outcome: "completed" | "timeout" | "interrupted" | "not_exposed";
  readonly requestedSeconds: string;
  readonly observationCount: string;
}

export function x402WaitProjectedStatus(
  status: { readonly reason: string; readonly proofClass: string; readonly terminal: boolean },
  settlementWait?: X402SettlementWaitProjection,
): { readonly reason: string; readonly proofClass: string } {
  return settlementWait?.outcome === "timeout" && !status.terminal
    ? { reason: "x402_settlement_wait_timeout", proofClass: "x402_unknown_finality" }
    : { reason: status.reason, proofClass: status.proofClass };
}

export function publicX402Operation(
  operation: X402OperationRecord,
  result?: X402ResultRecord,
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
    resource: {
      origin: operation.resource.origin,
      path: operation.resource.path,
      urlHash: operation.resource.urlHash,
    },
    payer: operation.wallet,
    paymentMethod: operation.selectedOffer.resolved.assetTransferMethod,
    ...(operation.providerSigner === undefined ? {} : {
      signer: {
        provider: operation.providerSigner.providerId,
        mode: operation.providerSigner.executionMode,
      },
    }),
    ...(operation.delegatedMaterial === undefined ? {} : {
      signer: {
        provider: operation.delegatedMaterial.providerId,
        mode: "delegated_erc7710_apn_paid_retry" as const,
      },
    }),
    payee: operation.payee,
    amountAtomic: operation.amountAtomic,
    network: operation.network,
    token: operation.token,
    ...(operation.paymentIdentifier === undefined ? {} : { paymentIdentifier: operation.paymentIdentifier.value }),
    ...(operation.transactionHint === undefined ? {} : { transactionHash: operation.transactionHint.transactionHash }),
    ...publicSettlement(operation.settlementEvidence),
    ...(result === undefined ? {} : {
      result: { resultHash: result.resultHash, mediaType: result.mediaType, byteLength: result.byteLength },
    }),
    ...(settlementWait === undefined ? {} : { settlementWait }),
  };
  return { ...value, integrityHash: domainHash("apn.x402.public-operation.v1", canonicalJson(value)) };
}

function publicSettlement(evidence: X402OperationRecord["settlementEvidence"]): Readonly<Record<string, unknown>> {
  if (evidence === undefined) return {};
  const block = evidence.transactionBlock === undefined ? {} : { blockNumber: evidence.transactionBlock.number, blockHash: evidence.transactionBlock.hash };
  if (evidence.schemaVersion === "apn.x402.erc7710-settlement-evidence.v1") return { ...block, settlementMethod: "erc7710" as const };
  return { ...block, authorizationState: {
    value: true as const, blockNumber: evidence.authorizationState.blockNumber, blockHash: evidence.authorizationState.blockHash,
  } };
}

/** The stored `resultHash` is domain separated; the public result names it as such beside the plain body SHA-256. */
export const X402_RESULT_HASH_RULE = "sha256(utf8(\"apn.x402.result-body.v1\") || 0x00 || body_bytes)";

export function publicX402ResultData(result: X402ResultRecord): unknown {
  const bytes = Buffer.from(result.bodyText, result.bodyEncoding === "base64" ? "base64" : "utf8");
  return {
    kind: "x402_result",
    media_type: result.mediaType,
    ...(result.bodyEncoding === "base64" ? { body_encoding: "base64" } : {}),
    body: result.bodyEncoding === "base64" ? result.bodyText : result.mediaType === "application/json"
      ? JSON.parse(result.bodyText) as unknown
      : result.bodyText,
    sha256: sha256(bytes),
    byte_length: result.byteLength,
    result_hash: result.resultHash,
    result_hash_rule: X402_RESULT_HASH_RULE,
  };
}

export function sealX402Result(value: Omit<X402ResultRecord, "integrityHash">): X402ResultRecord {
  return { ...value, integrityHash: domainHash(value.schemaVersion, canonicalJson(value)) };
}

export function sealX402Receipt(value: Omit<X402ReceiptRecord, "integrityHash">): X402ReceiptRecord {
  return { ...value, integrityHash: domainHash("apn.x402.receipt.v1", canonicalJson(value)) };
}

export function validateX402Result(value: unknown): X402ResultRecord {
  try { return validateX402ResultUnsafe(value); }
  catch (error) {
    if (error instanceof ApnError && error.code === "APN_STATE_CORRUPT") throw error;
    stateCorrupt("x402 result protected state validation failed.");
  }
}

export function validateX402Receipt(value: unknown): X402ReceiptRecord {
  try { return validateX402ReceiptUnsafe(value); }
  catch (error) {
    if (error instanceof ApnError && error.code === "APN_STATE_CORRUPT") throw error;
    stateCorrupt("x402 receipt protected state validation failed.");
  }
}
