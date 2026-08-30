import { canonicalJson, domainHash, exactKeys, isPlainRecord, sha256 } from "./canonical.js";
import { BASE_USDC, CHAIN_CAIP2 } from "./constants.js";
import { isSafeNormalizedProviderJson } from "./normalized-provider-json.js";
import type { ProviderX402SellerResult } from "./provider-ports.js";
import type { ProviderX402OperationRecord, ProviderX402ReceiptRecord } from "./provider-x402-model.js";
import type { X402RpcBlock, X402RpcHead } from "./ports.js";
import {
  publicX402ResultData,
  validateX402Receipt,
  type X402ReceiptRecord,
  type X402ResultRecord,
} from "./x402-state-integrity.js";

interface NormalizedProviderReceipt {
  readonly schemaVersion: "apn.x402.public-receipt.v1";
  readonly variant: "normalized_provider_json";
  readonly kind: "x402_fetch";
  readonly operationId: string;
  readonly terminalState: "completed" | "failed_before_effect" | "failed_settled_without_result";
  readonly reason: string;
  readonly proofClass: string;
  readonly resource: { readonly origin: string; readonly path: string; readonly urlHash: string };
  readonly fingerprint: string;
  readonly requestDigest: string;
  readonly requirementDigest: string;
  readonly payer: `0x${string}`;
  readonly payee: `0x${string}`;
  readonly amountAtomic: string;
  readonly network: "eip155:8453";
  readonly token: `0x${string}`;
  readonly result?: { readonly classification: "normalized_provider_json"; readonly sha256: string; readonly byteLength: string };
  readonly settlement?: NormalizedProviderSettlement;
  readonly operationBindingHash: string;
  readonly createdAt: string;
  readonly integrityHash: string;
}

interface NormalizedProviderSettlement {
  readonly network: typeof CHAIN_CAIP2;
  readonly chainId: "8453";
  readonly token: `0x${string}`;
  readonly transactionHash: `0x${string}`;
  readonly receiptStatus: "success";
  readonly lowerBlock: PublicBlock;
  readonly upperBlock: PublicBlock;
  readonly transfer: {
    readonly logIndex: string;
    readonly from: `0x${string}`;
    readonly to: `0x${string}`;
    readonly value: string;
    readonly blockNumber: string;
    readonly blockHash: `0x${string}`;
    readonly transactionHash: `0x${string}`;
  };
  readonly rpcOriginHash: string;
  readonly evidenceHash: string;
}

interface PublicBlock {
  readonly number: string;
  readonly hash: `0x${string}`;
  readonly timestamp: string;
  readonly observedAt: string;
}

interface LocalPublicResult {
  readonly kind: "x402_result";
  readonly media_type: string;
  readonly body: unknown;
  readonly sha256: string;
  readonly byte_length: string;
}

interface NormalizedProviderResult {
  readonly kind: "x402_result";
  readonly variant: "normalized_provider_json";
  readonly classification: "normalized_provider_json";
  readonly body: unknown;
  readonly sha256: string;
  readonly byte_length: string;
}

export type PublicX402Receipt = X402ReceiptRecord | NormalizedProviderReceipt;
export type PublicX402Result = LocalPublicResult | NormalizedProviderResult;

export function projectPublicX402Result(input:
  | { readonly variant: "local"; readonly result: X402ResultRecord }
  | { readonly variant: "normalized_provider_json"; readonly result: ProviderX402SellerResult }
): PublicX402Result {
  if (input.variant === "local") return validatePublicX402Result(publicX402ResultData(input.result));
  const value = {
    kind: "x402_result",
    variant: "normalized_provider_json",
    classification: input.result.classification,
    body: JSON.parse(input.result.canonical_json) as unknown,
    sha256: input.result.sha256,
    byte_length: input.result.byte_length,
  };
  return validatePublicX402Result(value);
}

export function projectPublicX402Receipt(input:
  | { readonly variant: "local"; readonly receipt: X402ReceiptRecord }
  | {
    readonly variant: "normalized_provider_json";
    readonly operation: ProviderX402OperationRecord;
    readonly receipt: ProviderX402ReceiptRecord;
  }
): PublicX402Receipt {
  if (input.variant === "local") return validateX402Receipt(input.receipt);
  const { operation, receipt } = input;
  const value = {
    schemaVersion: "apn.x402.public-receipt.v1" as const,
    variant: "normalized_provider_json" as const,
    kind: receipt.kind,
    operationId: receipt.operationId,
    terminalState: receipt.terminalState,
    reason: receipt.reason,
    proofClass: receipt.proofClass,
    resource: { origin: operation.request.origin, path: operation.request.path, urlHash: operation.request.urlHash },
    fingerprint: receipt.fingerprint,
    requestDigest: receipt.requestDigest,
    requirementDigest: receipt.requirementDigest,
    payer: receipt.payer,
    payee: receipt.payee,
    amountAtomic: receipt.amountAtomic,
    network: receipt.network,
    token: receipt.token,
    ...(receipt.result === undefined ? {} : { result: receipt.result }),
    ...(receipt.settlement === undefined ? {} : { settlement: publicSettlement(receipt.settlement) }),
    operationBindingHash: receipt.operationBindingHash,
    createdAt: receipt.createdAt,
  };
  return validatePublicX402Receipt({
    ...value,
    integrityHash: domainHash("apn.x402.public-receipt.v1", canonicalJson(value)),
  });
}

export function validatePublicX402Receipt(value: unknown): PublicX402Receipt {
  if (isPlainRecord(value) && value.schemaVersion === "apn.x402.receipt.v1") return validateX402Receipt(value);
  if (!isPlainRecord(value)) throw new TypeError("Invalid public x402 receipt.");
  const receipt = value as unknown as NormalizedProviderReceipt;
  const { integrityHash: _integrityHash, ...base } = receipt;
  const expectedKeys = [
    "schemaVersion", "variant", "kind", "operationId", "terminalState", "reason", "proofClass", "resource",
    "fingerprint", "requestDigest", "requirementDigest", "payer", "payee", "amountAtomic", "network", "token",
    ...(receipt.result === undefined ? [] : ["result"]), ...(receipt.settlement === undefined ? [] : ["settlement"]),
    "operationBindingHash", "createdAt", "integrityHash",
  ];
  if (
    !exactKeys(value, expectedKeys) ||
    receipt.schemaVersion !== "apn.x402.public-receipt.v1" || receipt.variant !== "normalized_provider_json" ||
    receipt.kind !== "x402_fetch" || !hash(receipt.operationId) || !safeLabel(receipt.reason) || !safeLabel(receipt.proofClass) ||
    receipt.integrityHash !== domainHash("apn.x402.public-receipt.v1", canonicalJson(base)) ||
    !["completed", "failed_before_effect", "failed_settled_without_result"].includes(receipt.terminalState) ||
    receipt.network !== CHAIN_CAIP2 || receipt.token !== BASE_USDC.toLowerCase() || !address(receipt.payer) ||
    !address(receipt.payee) || !positive(receipt.amountAtomic) || !hash(receipt.fingerprint) ||
    !hash(receipt.requestDigest) || !hash(receipt.requirementDigest) || !hash(receipt.operationBindingHash) ||
    !validResource(receipt.resource) || !canonicalUtc(receipt.createdAt) ||
    (receipt.result !== undefined && !validReceiptResult(receipt.result)) ||
    (receipt.settlement !== undefined && !validSettlement(receipt.settlement, receipt)) ||
    (receipt.terminalState === "completed") !== (receipt.result !== undefined && receipt.settlement !== undefined) ||
    (receipt.terminalState === "failed_settled_without_result") !== (
      receipt.result === undefined && receipt.settlement !== undefined
    ) ||
    (receipt.terminalState === "failed_before_effect" && (
      receipt.result !== undefined || receipt.settlement !== undefined
    ))
  ) throw new TypeError("Invalid public x402 receipt.");
  return receipt;
}

export function validatePublicX402Result(value: unknown): PublicX402Result {
  if (!isPlainRecord(value) || value.kind !== "x402_result" || !hash(value.sha256) || !decimal(value.byte_length)) {
    throw new TypeError("Invalid public x402 result.");
  }
  if (value.variant === "normalized_provider_json") {
    if (
      !exactKeys(value, ["kind", "variant", "classification", "body", "sha256", "byte_length"]) ||
      value.classification !== "normalized_provider_json" || !isSafeNormalizedProviderJson(value.body)
    ) throw new TypeError("Invalid public x402 result.");
    const normalized = canonicalJson(value.body);
    if (value.sha256 !== sha256(normalized) || value.byte_length !== Buffer.byteLength(normalized).toString()) {
      throw new TypeError("Invalid public x402 result.");
    }
    return value as unknown as NormalizedProviderResult;
  }
  if (
    !exactKeys(value, ["kind", "media_type", "body", "sha256", "byte_length"]) ||
    typeof value.media_type !== "string" || value.media_type.length < 1 || value.media_type.length > 128
  ) throw new TypeError("Invalid public x402 result.");
  return value as unknown as LocalPublicResult;
}

function publicSettlement(settlement: NonNullable<ProviderX402ReceiptRecord["settlement"]>): NormalizedProviderSettlement {
  const block = (value: X402RpcHead | X402RpcBlock): PublicBlock => ({
    number: value.number, hash: value.hash, timestamp: value.timestamp, observedAt: value.observedAt,
  });
  return {
    network: settlement.network,
    chainId: settlement.chainId,
    token: settlement.token,
    transactionHash: settlement.transactionHash,
    receiptStatus: settlement.receiptStatus,
    lowerBlock: block(settlement.lowerBlock),
    upperBlock: block(settlement.upperBlock),
    transfer: {
      logIndex: settlement.transfer.logIndex,
      from: settlement.payer,
      to: settlement.payee,
      value: settlement.amountAtomic,
      blockNumber: settlement.transfer.blockNumber,
      blockHash: settlement.transfer.blockHash,
      transactionHash: settlement.transfer.transactionHash,
    },
    rpcOriginHash: settlement.rpcOriginHash,
    evidenceHash: settlement.evidenceHash,
  };
}

function validResource(value: unknown): boolean {
  if (!isPlainRecord(value) || !exactKeys(value, ["origin", "path", "urlHash"]) ||
      typeof value.origin !== "string" || typeof value.path !== "string" || !hash(value.urlHash)) return false;
  try {
    const origin = new URL(value.origin);
    return origin.protocol === "https:" && origin.origin === value.origin && value.path.startsWith("/") &&
      value.path.length <= 4096 && !value.path.includes("?") && !value.path.includes("#");
  } catch { return false; }
}

function validReceiptResult(value: unknown): boolean {
  return isPlainRecord(value) && exactKeys(value, ["classification", "sha256", "byteLength"]) &&
    value.classification === "normalized_provider_json" && hash(value.sha256) && decimal(value.byteLength);
}

function validSettlement(value: unknown, receipt: NormalizedProviderReceipt): boolean {
  if (!isPlainRecord(value) || !exactKeys(value, [
    "network", "chainId", "token", "transactionHash", "receiptStatus", "lowerBlock", "upperBlock", "transfer",
    "rpcOriginHash", "evidenceHash",
  ])) return false;
  const settlement = value as unknown as NormalizedProviderSettlement;
  if (
    settlement.network !== CHAIN_CAIP2 || settlement.chainId !== "8453" || settlement.token !== receipt.token ||
    settlement.receiptStatus !== "success" || !hashHex(settlement.transactionHash) || !hash(settlement.rpcOriginHash) ||
    !hash(settlement.evidenceHash) || !validBlock(settlement.lowerBlock) || !validBlock(settlement.upperBlock) ||
    !isPlainRecord(settlement.transfer) || !exactKeys(settlement.transfer, [
      "logIndex", "from", "to", "value", "blockNumber", "blockHash", "transactionHash",
    ]) || !decimal(settlement.transfer.logIndex) || settlement.transfer.from !== receipt.payer ||
    settlement.transfer.to !== receipt.payee || settlement.transfer.value !== receipt.amountAtomic ||
    !decimal(settlement.transfer.blockNumber) || !hashHex(settlement.transfer.blockHash) ||
    settlement.transfer.transactionHash !== settlement.transactionHash
  ) return false;
  const blockNumber = BigInt(settlement.transfer.blockNumber);
  return BigInt(settlement.lowerBlock.number) < BigInt(settlement.upperBlock.number) &&
    blockNumber >= BigInt(settlement.lowerBlock.number) && blockNumber <= BigInt(settlement.upperBlock.number);
}

function validBlock(value: unknown): value is PublicBlock {
  if (!isPlainRecord(value) || !exactKeys(value, ["number", "hash", "timestamp", "observedAt"]) ||
      !decimal(value.number) || !hashHex(value.hash) || !decimal(value.timestamp) || !canonicalUtc(value.observedAt)) return false;
  return BigInt(value.timestamp) <= BigInt(Math.floor(Date.parse(value.observedAt) / 1_000));
}

function safeLabel(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= 128 && /^[a-z0-9_]+$/u.test(value);
}
function address(value: unknown): value is `0x${string}` { return typeof value === "string" && /^0x[0-9a-f]{40}$/u.test(value); }
function hashHex(value: unknown): value is `0x${string}` { return typeof value === "string" && /^0x[0-9a-f]{64}$/u.test(value) && !/^0x0{64}$/u.test(value); }
function hash(value: unknown): value is string { return typeof value === "string" && /^[a-f0-9]{64}$/u.test(value); }
function positive(value: unknown): value is string { return typeof value === "string" && /^[1-9][0-9]*$/u.test(value); }
function decimal(value: unknown): value is string { return typeof value === "string" && /^(?:0|[1-9][0-9]*)$/u.test(value); }
function canonicalUtc(value: unknown): value is string {
  return typeof value === "string" && Number.isFinite(Date.parse(value)) && new Date(Date.parse(value)).toISOString() === value;
}
