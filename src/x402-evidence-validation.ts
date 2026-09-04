import { canonicalJson, domainHash, isPlainRecord } from "./canonical.js";
import { BASE_USDC, CHAIN_CAIP2 } from "./constants.js";
import type {
  AuthorizationUsedScan,
  Erc7710SettlementEvidence,
  SettlementEvidence,
  SettlementResponseObservation,
  TransactionHint,
  UnusedExpiryEvidence,
  X402Attempt,
  X402HttpObservation,
} from "./x402-state-model.js";
import { x402OperationBindingHash } from "./x402-state-model.js";
import {
  address,
  allowedRecord,
  bytes32,
  canonicalText,
  exactRecord,
  hash,
  mediaType,
  positive,
  record,
  stateCorrupt,
  timestamp,
  transactionHash,
  uint,
} from "./x402-state-validation-primitives.js";

export function validateAttempts(value: unknown, operation: Record<string, unknown>): readonly X402Attempt[] {
  if (!Array.isArray(value) || value.length > 64) stateCorrupt("x402 attempts are invalid.");
  let recoveryCount = 0;
  let previousPersistedAt = -Infinity;
  return value.map((item, index) => {
    const attempt = allowedRecord(item, ["attemptNumber", "purpose", "phase", "requestHeaderHash", "persistedAt"], ["observation"]);
    uint(attempt.attemptNumber);
    if (attempt.attemptNumber !== String(index + 1)) stateCorrupt("x402 attempt numbers are discontinuous.");
    if (attempt.purpose !== "payment" && attempt.purpose !== "result_recovery") stateCorrupt("x402 attempt purpose is invalid.");
    if (attempt.phase !== "pending" && attempt.phase !== "observed" && attempt.phase !== "ambiguous") stateCorrupt("x402 attempt phase is invalid.");
    hash(attempt.requestHeaderHash); timestamp(attempt.persistedAt);
    const persistedAt = Date.parse(attempt.persistedAt as string);
    if (persistedAt < previousPersistedAt) stateCorrupt("x402 attempt persistence timestamps are not chronological.");
    previousPersistedAt = persistedAt;
    if (attempt.requestHeaderHash !== operation.paymentHeaderHash) stateCorrupt("x402 attempt request header is not the frozen payment header.");
    if (attempt.purpose === "result_recovery") {
      recoveryCount += 1;
      if (operation.paymentIdentifier === undefined || recoveryCount > 1) stateCorrupt("x402 result recovery attempt is not supported by the frozen operation.");
    }
    if (attempt.phase === "pending" && attempt.observation !== undefined) stateCorrupt("x402 pending attempt contains an observation.");
    if (attempt.phase === "observed" && attempt.observation === undefined) stateCorrupt("x402 observed attempt lacks an observation.");
    const observation = attempt.observation === undefined ? undefined : validateHttpObservation(
      attempt.observation,
      attempt.attemptNumber as string,
      attempt.purpose,
      operation,
    );
    if (observation !== undefined && persistedAt > Date.parse(observation.startedAt)) {
      stateCorrupt("x402 attempt was persisted after its HTTP observation started.");
    }
    return { ...attempt, ...(observation === undefined ? {} : { observation }) } as unknown as X402Attempt;
  });
}

export function validateHttpObservation(value: unknown, attemptNumber: string, purpose: unknown, operation: Record<string, unknown>): X402HttpObservation {
  const observation = allowedRecord(value, [
    "attemptNumber", "purpose", "targetHash", "status", "rawHeadersHash", "bodyHash", "bodyByteLength",
    "finalUrlHash", "origin", "selectedIpFamily", "startedAt", "observedAt",
  ], ["paymentRequiredHeaderHash", "paymentResponseHeaderHash", "mediaType"]);
  if (observation.attemptNumber !== attemptNumber || observation.purpose !== purpose) stateCorrupt("x402 HTTP observation attempt binding is invalid.");
  uint(observation.attemptNumber); uint(observation.status); uint(observation.bodyByteLength);
  for (const key of ["targetHash", "rawHeadersHash", "bodyHash", "finalUrlHash", "paymentRequiredHeaderHash", "paymentResponseHeaderHash"] as const) {
    if (observation[key] !== undefined) hash(observation[key]);
  }
  if (observation.mediaType !== undefined) mediaType(observation.mediaType);
  if (typeof observation.origin !== "string" || new URL(observation.origin).origin !== observation.origin || !observation.origin.startsWith("https://")) stateCorrupt("x402 HTTP observation origin is invalid.");
  const resource = record(operation.resource);
  if (
    observation.targetHash !== resource.urlHash || observation.finalUrlHash !== resource.urlHash ||
    observation.origin !== resource.origin
  ) stateCorrupt("x402 HTTP observation does not bind the frozen resource.");
  if (observation.selectedIpFamily !== "ipv4" && observation.selectedIpFamily !== "ipv6") stateCorrupt("x402 HTTP IP family is invalid.");
  timestamp(observation.startedAt); timestamp(observation.observedAt);
  if (Date.parse(observation.startedAt as string) > Date.parse(observation.observedAt as string)) stateCorrupt("x402 HTTP observation time is invalid.");
  return observation as unknown as X402HttpObservation;
}

export function validateSettlementResponseObservation(
  value: unknown,
  operation: Record<string, unknown>,
  attempts: readonly X402Attempt[],
): SettlementResponseObservation {
  const observation = exactRecord(value, ["schemaVersion", "classification", "normalizedCanonicalJson", "paymentResponseHeaderHash", "settlementResponseHash", "httpAttemptNumber", "observedAt"]);
  if (observation.schemaVersion !== "apn.x402.settlement-response.v1") stateCorrupt("x402 settlement response version is invalid.");
  if (!["success", "settlement_pending", "failure_with_transaction"].includes(observation.classification as string)) stateCorrupt("x402 settlement response classification is invalid.");
  const normalized = canonicalText(observation.normalizedCanonicalJson, 48 * 1024);
  validateNormalizedSettlement(normalized, observation.classification as SettlementResponseObservation["classification"], operation);
  hash(observation.paymentResponseHeaderHash); hash(observation.settlementResponseHash); uint(observation.httpAttemptNumber); timestamp(observation.observedAt);
  const attemptNumber = BigInt(observation.httpAttemptNumber as string);
  const attempt = attemptNumber > 0n && attemptNumber <= BigInt(Number.MAX_SAFE_INTEGER)
    ? attempts[Number(attemptNumber) - 1]
    : undefined;
  if (
    (attempt?.purpose !== "payment" && attempt?.purpose !== "result_recovery") || attempt.phase !== "observed" ||
    attempt.observation?.paymentResponseHeaderHash !== observation.paymentResponseHeaderHash
  ) stateCorrupt("x402 settlement response does not bind an observed paid HTTP attempt.");
  if (observation.settlementResponseHash !== domainHash("apn.x402.settlement.v1", observation.normalizedCanonicalJson as string)) stateCorrupt("x402 settlement response hash is invalid.");
  return observation as unknown as SettlementResponseObservation;
}

export function validateNormalizedSettlement(
  value: unknown,
  classification: SettlementResponseObservation["classification"],
  operation: Record<string, unknown>,
): void {
  const settlement = allowedRecord(value, ["success", "transaction", "network"], ["errorReason", "payer", "amount", "extensions"]);
  if (settlement.network !== CHAIN_CAIP2) stateCorrupt("x402 settlement response network is invalid.");
  transactionHash(settlement.transaction);
  if (settlement.payer !== undefined) {
    address(settlement.payer);
    if (settlement.payer !== operation.wallet) stateCorrupt("x402 settlement payer conflicts with the frozen operation.");
  }
  if (settlement.amount !== undefined) {
    uint(settlement.amount);
    if (settlement.amount !== operation.amountAtomic) stateCorrupt("x402 settlement amount conflicts with the frozen operation.");
  }
  if (settlement.extensions !== undefined && (!isPlainRecord(settlement.extensions) || Object.keys(settlement.extensions).length !== 0)) stateCorrupt("x402 settlement response extensions are invalid.");
  if (classification === "success" && (settlement.success !== true || settlement.errorReason !== undefined)) stateCorrupt("x402 success settlement response is invalid.");
  if (classification === "settlement_pending" && (settlement.success !== false || settlement.errorReason !== "settlement_pending")) stateCorrupt("x402 pending settlement response is invalid.");
  if (classification === "failure_with_transaction" && (
    settlement.success !== false || typeof settlement.errorReason !== "string" || settlement.errorReason.length === 0 ||
    Buffer.byteLength(settlement.errorReason, "utf8") > 512 || settlement.errorReason === "settlement_pending"
  )) stateCorrupt("x402 failed settlement response is invalid.");
}

export function validateTransactionHint(value: unknown): TransactionHint {
  const hint = exactRecord(value, ["transactionHash", "source", "sourceBindingHash", "observedAt"]);
  transactionHash(hint.transactionHash);
  if (hint.source !== "payment_response" && hint.source !== "authorization_used_log") stateCorrupt("x402 transaction hint source is invalid.");
  hash(hint.sourceBindingHash); timestamp(hint.observedAt);
  return hint as unknown as TransactionHint;
}

export function validateTransferMethodEvidence(
  method: "eip3009" | "erc7710",
  transactionHint: TransactionHint | undefined,
  authorizationUsedScan: AuthorizationUsedScan | undefined,
  settlementEvidence: SettlementEvidence | undefined,
  unusedExpiryEvidence: UnusedExpiryEvidence | undefined,
): void {
  if (method === "erc7710") {
    if (authorizationUsedScan !== undefined ||
      unusedExpiryEvidence !== undefined && unusedExpiryEvidence.schemaVersion !== "apn.x402.erc7710-unused-expiry-evidence.v1" ||
      transactionHint?.source === "authorization_used_log" ||
      settlementEvidence !== undefined && settlementEvidence.schemaVersion !== "apn.x402.erc7710-settlement-evidence.v1") {
      stateCorrupt("x402 ERC-7710 operation contains EIP-3009-only evidence.");
    }
    return;
  }
  if (
    settlementEvidence !== undefined && settlementEvidence.schemaVersion !== "apn.x402.settlement-evidence.v1" ||
    unusedExpiryEvidence?.schemaVersion === "apn.x402.erc7710-unused-expiry-evidence.v1"
  ) {
    stateCorrupt("x402 EIP-3009 operation contains ERC-7710 settlement evidence.");
  }
}

export function validateAuthorizationUsedScan(value: unknown, operation: Record<string, unknown>): AuthorizationUsedScan {
  const scan = allowedRecord(value, ["schemaVersion", "searchStartBlock", "nextFromBlock", "targetSafeHead", "candidates", "status", "updatedAt", "evidenceHash"], ["lastCompletedChunk", "unavailableReason"]);
  if (scan.schemaVersion !== "apn.x402.authorization-used-scan.v1") stateCorrupt("x402 authorization-used scan version is invalid.");
  uint(scan.searchStartBlock); uint(scan.nextFromBlock);
  const preparedBlock = record(operation.preparedBlock);
  const authorization = record(operation.authorization);
  if (scan.searchStartBlock !== preparedBlock.number) stateCorrupt("x402 authorization-used scan start is not the frozen exposure start.");
  const safeHead = exactRecord(scan.targetSafeHead, ["number", "hash", "observedAt"]);
  uint(safeHead.number); bytes32(safeHead.hash); timestamp(safeHead.observedAt);
  const start = BigInt(scan.searchStartBlock as string);
  const next = BigInt(scan.nextFromBlock as string);
  const head = BigInt(safeHead.number as string);
  if (head < start || next < start || next > head + 1n) stateCorrupt("x402 authorization-used scan cursor is outside the frozen range.");
  let completedTo: bigint | undefined;
  if (scan.lastCompletedChunk !== undefined) {
    const chunk = exactRecord(scan.lastCompletedChunk, ["fromBlock", "toBlock", "toBlockHash"]);
    uint(chunk.fromBlock); uint(chunk.toBlock); bytes32(chunk.toBlockHash);
    const from = BigInt(chunk.fromBlock as string);
    const to = BigInt(chunk.toBlock as string);
    if (from < start || from > to || to > head || to - from + 1n > 2048n || next !== to + 1n) stateCorrupt("x402 authorization-used chunk is invalid.");
    if (to === head && chunk.toBlockHash !== safeHead.hash) stateCorrupt("x402 authorization-used terminal chunk hash is invalid.");
    completedTo = to;
  } else if (next !== start) {
    stateCorrupt("x402 authorization-used cursor advanced without a completed chunk.");
  }
  if (!Array.isArray(scan.candidates) || scan.candidates.length > 2) stateCorrupt("x402 authorization-used candidates are invalid.");
  const candidateKeys = new Set<string>();
  for (const item of scan.candidates) {
    const candidate = exactRecord(item, ["blockNumber", "blockHash", "transactionHash", "logIndex", "authorizer", "nonce"]);
    uint(candidate.blockNumber); bytes32(candidate.blockHash); transactionHash(candidate.transactionHash); uint(candidate.logIndex); address(candidate.authorizer); bytes32(candidate.nonce);
    const candidateBlock = BigInt(candidate.blockNumber as string);
    if (
      candidate.authorizer !== operation.wallet || candidate.nonce !== authorization.nonce || completedTo === undefined ||
      candidateBlock < start || candidateBlock > completedTo
    ) stateCorrupt("x402 authorization-used candidate does not bind the frozen operation and committed range.");
    const completedChunk = scan.lastCompletedChunk === undefined ? undefined : record(scan.lastCompletedChunk);
    if (
      (candidateBlock === head && candidate.blockHash !== safeHead.hash) ||
      (completedChunk !== undefined && candidate.blockNumber === completedChunk.toBlock && candidate.blockHash !== completedChunk.toBlockHash)
    ) stateCorrupt("x402 authorization-used candidate block hash conflicts with validated range evidence.");
    const key = `${candidate.blockHash as string}\0${candidate.transactionHash as string}\0${candidate.logIndex as string}`;
    if (candidateKeys.has(key)) stateCorrupt("x402 authorization-used candidates are not deduplicated.");
    candidateKeys.add(key);
  }
  if (!["active", "complete", "unavailable", "ambiguous"].includes(scan.status as string)) stateCorrupt("x402 authorization-used scan status is invalid.");
  if ((scan.status === "unavailable") !== (scan.unavailableReason === "pruned" || scan.unavailableReason === "range_unavailable")) stateCorrupt("x402 authorization-used unavailable reason is invalid.");
  if (scan.status === "active" && (scan.candidates.length > 1 || next > head)) stateCorrupt("x402 active authorization-used scan is invalid.");
  if (scan.status === "complete" && (scan.candidates.length > 1 || completedTo === undefined || next !== head + 1n)) stateCorrupt("x402 complete authorization-used scan is invalid.");
  if (scan.status === "ambiguous" && (scan.candidates.length !== 2 || completedTo === undefined)) stateCorrupt("x402 ambiguous authorization-used scan is invalid.");
  if (scan.status === "unavailable" && scan.candidates.length > 1) stateCorrupt("x402 unavailable authorization-used scan is invalid.");
  timestamp(scan.updatedAt); hash(scan.evidenceHash);
  const { evidenceHash: _hash, ...body } = scan;
  if (scan.evidenceHash !== domainHash("apn.x402.authorization-used-scan.v1", canonicalJson(body))) stateCorrupt("x402 authorization-used scan hash is invalid.");
  return scan as unknown as AuthorizationUsedScan;
}

export function validateSettlementEvidence(value: unknown, operation?: Record<string, unknown>): SettlementEvidence {
  const candidate = record(value);
  return candidate.schemaVersion === "apn.x402.erc7710-settlement-evidence.v1"
    ? validateErc7710SettlementEvidence(candidate, operation)
    : validateEip3009SettlementEvidence(candidate, operation);
}

function validateEip3009SettlementEvidence(value: unknown, operation?: Record<string, unknown>): SettlementEvidence {
  const evidence = exactRecord(value, [
    "schemaVersion", "network", "chainId", "token", "transactionHash", "safeHead", "transactionBlock", "receiptStatus",
    "blockHashRechecked", "authorizationUsed", "transfer", "authorizationState", "rpcOriginHash", "evidenceHash",
  ]);
  if (evidence.schemaVersion !== "apn.x402.settlement-evidence.v1" || evidence.network !== CHAIN_CAIP2 || evidence.chainId !== "8453" || evidence.token !== BASE_USDC.toLowerCase()) stateCorrupt("x402 settlement evidence discriminant is invalid.");
  transactionHash(evidence.transactionHash);
  const safeHead = exactRecord(evidence.safeHead, ["number", "hash", "observedAt"]);
  positive(safeHead.number); bytes32(safeHead.hash); timestamp(safeHead.observedAt);
  const transactionBlock = exactRecord(evidence.transactionBlock, ["number", "hash", "timestamp"]);
  positive(transactionBlock.number); bytes32(transactionBlock.hash); uint(transactionBlock.timestamp);
  if (BigInt(transactionBlock.number as string) > BigInt(safeHead.number as string)) stateCorrupt("x402 settlement block is newer than the safe head.");
  if (evidence.receiptStatus !== "1" || evidence.blockHashRechecked !== true) stateCorrupt("x402 settlement receipt proof is invalid.");
  const used = exactRecord(evidence.authorizationUsed, ["logIndex", "authorizer", "nonce", "blockNumber", "blockHash", "transactionHash"]);
  uint(used.logIndex); address(used.authorizer); bytes32(used.nonce); positive(used.blockNumber); bytes32(used.blockHash); transactionHash(used.transactionHash);
  const transfer = exactRecord(evidence.transfer, ["logIndex", "from", "to", "value", "blockNumber", "blockHash", "transactionHash"]);
  uint(transfer.logIndex); address(transfer.from); address(transfer.to); positive(transfer.value); positive(transfer.blockNumber); bytes32(transfer.blockHash); transactionHash(transfer.transactionHash);
  for (const member of [used, transfer]) {
    if (member.blockNumber !== transactionBlock.number || member.blockHash !== transactionBlock.hash || member.transactionHash !== evidence.transactionHash) stateCorrupt("x402 settlement log binding is invalid.");
  }
  if (operation !== undefined) {
    const authorization = record(operation.authorization);
    if (used.authorizer !== operation.wallet || used.nonce !== authorization.nonce) stateCorrupt("x402 authorization-used evidence conflicts with the frozen authorization.");
    if (transfer.from !== operation.wallet || transfer.to !== operation.payee || transfer.value !== operation.amountAtomic) stateCorrupt("x402 transfer evidence conflicts with the frozen economics.");
  }
  const authorizationState = exactRecord(evidence.authorizationState, ["value", "blockNumber", "blockHash", "blockTag", "observedAt"]);
  if (authorizationState.value !== true || (authorizationState.blockTag !== "safe" && authorizationState.blockTag !== "number")) stateCorrupt("x402 settlement authorization state is invalid.");
  positive(authorizationState.blockNumber); bytes32(authorizationState.blockHash); timestamp(authorizationState.observedAt);
  const authorizationBlock = BigInt(authorizationState.blockNumber as string);
  if (authorizationBlock < BigInt(transactionBlock.number as string) || authorizationBlock > BigInt(safeHead.number as string)) stateCorrupt("x402 authorization-state block is outside the safe settlement range.");
  if (authorizationState.blockTag === "safe" && (
    authorizationState.blockNumber !== safeHead.number || authorizationState.blockHash !== safeHead.hash
  )) stateCorrupt("x402 safe-tag authorization state does not bind the safe head.");
  const transactionIdentity = { number: transactionBlock.number, hash: transactionBlock.hash };
  const safeIdentity = { number: safeHead.number, hash: safeHead.hash };
  const authorizationIdentity = { number: authorizationState.blockNumber, hash: authorizationState.blockHash };
  for (const [left, right] of [
    [transactionIdentity, safeIdentity],
    [transactionIdentity, authorizationIdentity],
    [safeIdentity, authorizationIdentity],
  ] as const) {
    if (left.number === right.number && left.hash !== right.hash) stateCorrupt("x402 equal block numbers have conflicting hashes.");
  }
  hash(evidence.rpcOriginHash); hash(evidence.evidenceHash);
  const { evidenceHash: _hash, ...body } = evidence;
  if (evidence.evidenceHash !== domainHash("apn.x402.settlement-evidence.v1", canonicalJson(body))) stateCorrupt("x402 settlement evidence hash is invalid.");
  return evidence as unknown as SettlementEvidence;
}

function validateErc7710SettlementEvidence(
  value: unknown,
  operation?: Record<string, unknown>,
): Erc7710SettlementEvidence {
  const evidence = exactRecord(value, [
    "schemaVersion", "network", "chainId", "token", "transactionHash", "safeHead", "transactionBlock",
    "receiptStatus", "blockHashRechecked", "transfer", "methodBinding", "rpcOriginHash", "evidenceHash",
  ]);
  if (evidence.schemaVersion !== "apn.x402.erc7710-settlement-evidence.v1" || evidence.network !== CHAIN_CAIP2 ||
    evidence.chainId !== "8453" || evidence.token !== BASE_USDC.toLowerCase() || evidence.receiptStatus !== "1" ||
    evidence.blockHashRechecked !== true) stateCorrupt("x402 ERC-7710 settlement discriminant is invalid.");
  transactionHash(evidence.transactionHash);
  const safeHead = exactRecord(evidence.safeHead, ["number", "hash", "observedAt"]);
  positive(safeHead.number); bytes32(safeHead.hash); timestamp(safeHead.observedAt);
  const transactionBlock = exactRecord(evidence.transactionBlock, ["number", "hash", "timestamp"]);
  positive(transactionBlock.number); bytes32(transactionBlock.hash); uint(transactionBlock.timestamp);
  if (BigInt(transactionBlock.number as string) > BigInt(safeHead.number as string)) {
    stateCorrupt("x402 ERC-7710 settlement block is newer than the safe head.");
  }
  if (transactionBlock.number === safeHead.number && transactionBlock.hash !== safeHead.hash) {
    stateCorrupt("x402 ERC-7710 settlement block conflicts with the safe head.");
  }
  const transfer = exactRecord(evidence.transfer, ["logIndex", "from", "to", "value", "blockNumber", "blockHash", "transactionHash"]);
  uint(transfer.logIndex); address(transfer.from); address(transfer.to); positive(transfer.value);
  positive(transfer.blockNumber); bytes32(transfer.blockHash); transactionHash(transfer.transactionHash);
  if (transfer.blockNumber !== transactionBlock.number || transfer.blockHash !== transactionBlock.hash ||
    transfer.transactionHash !== evidence.transactionHash) stateCorrupt("x402 ERC-7710 transfer log binding is invalid.");
  const binding = exactRecord(evidence.methodBinding, [
    "paymentResponseHash", "operationBindingHash", "offerHash", "method", "delegationManager", "delegator",
    "childHash", "permissionContextHash",
  ]);
  if (binding.method !== "erc7710") stateCorrupt("x402 ERC-7710 method binding is invalid.");
  hash(binding.paymentResponseHash); hash(binding.operationBindingHash); hash(binding.offerHash);
  address(binding.delegationManager); address(binding.delegator); hash(binding.childHash); hash(binding.permissionContextHash);
  if (operation !== undefined) {
    const delegated = record(operation.delegatedMaterial);
    const offer = record(operation.selectedOffer);
    const response = record(operation.settlementResponseObservation);
    if (transfer.from !== operation.wallet || transfer.to !== operation.payee || transfer.value !== operation.amountAtomic ||
      binding.paymentResponseHash !== response.settlementResponseHash || binding.offerHash !== offer.offerHash ||
      binding.delegationManager !== delegated.delegationManager || binding.delegator !== operation.wallet ||
      binding.childHash !== operation.signatureHash || binding.permissionContextHash !== operation.paymentContextHash ||
      evidence.rpcOriginHash !== delegated.rpcOriginHash ||
      binding.operationBindingHash !== x402OperationBindingHash(operation as unknown as Parameters<typeof x402OperationBindingHash>[0])) {
      stateCorrupt("x402 ERC-7710 evidence conflicts with the frozen operation.");
    }
  }
  hash(evidence.rpcOriginHash); hash(evidence.evidenceHash);
  const { evidenceHash: _hash, ...body } = evidence;
  if (evidence.evidenceHash !== domainHash("apn.x402.erc7710-settlement-evidence.v1", canonicalJson(body))) {
    stateCorrupt("x402 ERC-7710 settlement evidence hash is invalid.");
  }
  return evidence as unknown as Erc7710SettlementEvidence;
}

export function validateUnusedExpiryEvidence(value: unknown, operation?: Record<string, unknown>): UnusedExpiryEvidence {
  if (record(value).schemaVersion === "apn.x402.erc7710-unused-expiry-evidence.v1") {
    return validateErc7710UnusedExpiryEvidence(value, operation);
  }
  const evidence = exactRecord(value, ["schemaVersion", "network", "chainId", "token", "validBefore", "finalizedHead", "authorizationState", "absence", "rpcOriginHash", "evidenceHash"]);
  if (evidence.schemaVersion !== "apn.x402.unused-expiry-evidence.v1" || evidence.network !== CHAIN_CAIP2 || evidence.chainId !== "8453" || evidence.token !== BASE_USDC.toLowerCase()) stateCorrupt("x402 unused-expiry evidence discriminant is invalid.");
  uint(evidence.validBefore);
  const finalizedHead = exactRecord(evidence.finalizedHead, ["number", "hash", "timestamp", "observedAt"]);
  positive(finalizedHead.number); bytes32(finalizedHead.hash); uint(finalizedHead.timestamp); timestamp(finalizedHead.observedAt);
  if (BigInt(finalizedHead.timestamp as string) < BigInt(evidence.validBefore as string)) stateCorrupt("x402 unused-expiry head precedes authorization expiry.");
  const authorizationState = exactRecord(evidence.authorizationState, ["value", "blockNumber", "blockHash", "blockTag", "observedAt"]);
  if (authorizationState.value !== false || authorizationState.blockTag !== "finalized") stateCorrupt("x402 unused-expiry authorization state is invalid.");
  positive(authorizationState.blockNumber); bytes32(authorizationState.blockHash); timestamp(authorizationState.observedAt);
  if (
    operation !== undefined && (
      evidence.validBefore !== record(operation.authorization).validBefore ||
      authorizationState.blockNumber !== finalizedHead.number || authorizationState.blockHash !== finalizedHead.hash
    )
  ) stateCorrupt("x402 unused-expiry evidence conflicts with the frozen authorization or finalized head.");
  const absence = exactRecord(evidence.absence, ["localSettlement", "httpSettlement", "authorizationUsed", "transactionReceipt"]);
  if (Object.values(absence).some((item) => item !== false)) stateCorrupt("x402 unused-expiry absence proof is invalid.");
  hash(evidence.rpcOriginHash); hash(evidence.evidenceHash);
  const { evidenceHash: _hash, ...body } = evidence;
  if (evidence.evidenceHash !== domainHash("apn.x402.unused-expiry-evidence.v1", canonicalJson(body))) stateCorrupt("x402 unused-expiry evidence hash is invalid.");
  return evidence as unknown as UnusedExpiryEvidence;
}

function validateErc7710UnusedExpiryEvidence(
  value: unknown,
  operation?: Record<string, unknown>,
): UnusedExpiryEvidence {
  const evidence = exactRecord(value, [
    "schemaVersion", "network", "chainId", "token", "effectiveExpiryUnix", "searchStartBlock",
    "expiryBlock", "finalizedHead", "scan", "methodBinding", "rpcOriginHash", "evidenceHash",
  ]);
  if (
    evidence.schemaVersion !== "apn.x402.erc7710-unused-expiry-evidence.v1" || evidence.network !== CHAIN_CAIP2 ||
    evidence.chainId !== "8453" || evidence.token !== BASE_USDC.toLowerCase()
  ) stateCorrupt("x402 ERC-7710 unused-expiry evidence discriminant is invalid.");
  positive(evidence.effectiveExpiryUnix);
  const start = exactRecord(evidence.searchStartBlock, ["number", "hash", "observedAt"]);
  uint(start.number); bytes32(start.hash); timestamp(start.observedAt);
  const expiry = exactRecord(evidence.expiryBlock, ["number", "hash", "timestamp", "observedAt"]);
  uint(expiry.number); bytes32(expiry.hash); uint(expiry.timestamp); timestamp(expiry.observedAt);
  const finalized = exactRecord(evidence.finalizedHead, ["number", "hash", "timestamp", "observedAt"]);
  uint(finalized.number); bytes32(finalized.hash); uint(finalized.timestamp); timestamp(finalized.observedAt);
  if (
    BigInt(start.number as string) > BigInt(expiry.number as string) ||
    BigInt(expiry.number as string) > BigInt(finalized.number as string) ||
    BigInt(expiry.timestamp as string) < BigInt(evidence.effectiveExpiryUnix as string) ||
    BigInt(finalized.timestamp as string) < BigInt(evidence.effectiveExpiryUnix as string) ||
    (expiry.number === finalized.number && expiry.hash !== finalized.hash)
  ) stateCorrupt("x402 ERC-7710 unused-expiry block range is invalid.");
  const scan = exactRecord(evidence.scan, ["fromBlock", "toBlock", "matchingTransferCount", "completedAt"]);
  uint(scan.fromBlock); uint(scan.toBlock); timestamp(scan.completedAt);
  if (
    scan.fromBlock !== start.number || scan.toBlock !== expiry.number || scan.matchingTransferCount !== "0"
  ) stateCorrupt("x402 ERC-7710 unused-expiry scan is incomplete.");
  const binding = exactRecord(evidence.methodBinding, [
    "operationBindingHash", "offerHash", "method", "delegationManager", "delegator", "childHash",
    "permissionContextHash",
  ]);
  if (binding.method !== "erc7710") stateCorrupt("x402 ERC-7710 unused-expiry method binding is invalid.");
  hash(binding.operationBindingHash); hash(binding.offerHash); address(binding.delegationManager);
  address(binding.delegator); hash(binding.childHash); hash(binding.permissionContextHash);
  if (operation !== undefined) {
    const delegated = record(operation.delegatedMaterial);
    const prepared = record(operation.preparedBlock);
    const offer = record(operation.selectedOffer);
    if (
      evidence.effectiveExpiryUnix !== delegated.effectiveExpiryUnix || start.number !== prepared.number ||
      start.hash !== prepared.hash || start.observedAt !== prepared.observedAt ||
      binding.operationBindingHash !== x402OperationBindingHash(operation as unknown as Parameters<typeof x402OperationBindingHash>[0]) ||
      binding.offerHash !== offer.offerHash || binding.delegationManager !== delegated.delegationManager ||
      binding.delegator !== operation.wallet || binding.childHash !== operation.signatureHash ||
      binding.permissionContextHash !== operation.paymentContextHash || evidence.rpcOriginHash !== delegated.rpcOriginHash
    ) stateCorrupt("x402 ERC-7710 unused-expiry evidence conflicts with the frozen operation.");
  }
  hash(evidence.rpcOriginHash); hash(evidence.evidenceHash);
  const { evidenceHash: _hash, ...body } = evidence;
  if (
    evidence.evidenceHash !== domainHash("apn.x402.erc7710-unused-expiry-evidence.v1", canonicalJson(body))
  ) stateCorrupt("x402 ERC-7710 unused-expiry evidence hash is invalid.");
  return evidence as unknown as UnusedExpiryEvidence;
}
