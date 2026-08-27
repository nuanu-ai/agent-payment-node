import { canonicalJson, domainHash, exactKeys, hashObject, isPlainRecord, sha256 } from "./canonical.js";
import { BASE_USDC, CHAIN_CAIP2 } from "./constants.js";
import { ApnError } from "./errors.js";
import { parseAtomic } from "./money.js";
import { decodeCanonicalBase64Json, decodePaymentRequiredHeader, inspectCandidates } from "./x402-codec.js";

const HASH = /^[a-f0-9]{64}$/u;
const ADDRESS = /^0x[0-9a-f]{40}$/u;
const BYTES32 = /^0x[0-9a-f]{64}$/u;
const UTC = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u;
const ZERO_HASH = "0".repeat(64);
const X402_STATE_VERSION = "apn.x402.state.v1" as const;
const TRANSITION_VERSION = "apn.x402.transition.v1" as const;

export type X402State =
  | "awaiting_approval"
  | "authorization_material_pending"
  | "authorized_not_sent"
  | "paid_request_pending"
  | "settlement_pending"
  | "effect_unknown"
  | "seller_result_recovery_pending"
  | "completed"
  | "failed_before_effect"
  | "failed_expired_unused"
  | "failed_settled_without_result";

export type X402FinalityClass = "pre_effect" | "unknown_finality" | "known_settled" | "terminal";
export type X402Reason =
  | "x402_awaiting_authorization"
  | "x402_authorization_material_pending"
  | "x402_authorized_not_sent"
  | "x402_paid_request_pending"
  | "x402_settlement_pending"
  | "x402_effect_unknown"
  | "x402_seller_result_recovery_pending"
  | "x402_completed"
  | "x402_failed_before_effect"
  | "x402_failed_expired_unused"
  | "x402_failed_settled_without_result";
export type X402ProofClass =
  | "x402_frozen_offer"
  | "x402_authorization_recovery"
  | "x402_authorization_verified"
  | "x402_unknown_finality"
  | "x402_settlement_verified_result_pending"
  | "x402_safe_settlement"
  | "x402_proven_no_effect"
  | "x402_expired_unused_finalized"
  | "x402_settled_result_unavailable";
export type SafeNextAction = "x402.fetch.approve" | "operation.resume" | "operation.status" | "receipt.get" | "use.archival_rpc";

export interface X402SelectedOffer {
  readonly index: string;
  readonly declaredCanonicalJson: string;
  readonly resolved: {
    readonly tokenName: string;
    readonly tokenVersion: string;
    readonly assetTransferMethod: "eip3009";
    readonly paymentFlow: "transferWithAuthorization";
  };
  readonly offerHash: string;
}

export interface X402HttpObservation {
  readonly attemptNumber: string;
  readonly purpose: "payment" | "result_recovery";
  readonly targetHash: string;
  readonly status: string;
  readonly rawHeadersHash: string;
  readonly paymentRequiredHeaderHash?: string;
  readonly paymentResponseHeaderHash?: string;
  readonly bodyHash: string;
  readonly bodyByteLength: string;
  readonly mediaType?: string;
  readonly finalUrlHash: string;
  readonly origin: string;
  readonly selectedIpFamily: "ipv4" | "ipv6";
  readonly startedAt: string;
  readonly observedAt: string;
}

export interface X402Attempt {
  readonly attemptNumber: string;
  readonly purpose: "payment" | "result_recovery";
  readonly phase: "pending" | "observed" | "ambiguous";
  readonly requestHeaderHash: string;
  readonly persistedAt: string;
  readonly observation?: X402HttpObservation;
}

export interface SettlementResponseObservation {
  readonly schemaVersion: "apn.x402.settlement-response.v1";
  readonly classification: "success" | "settlement_pending" | "failure_with_transaction";
  readonly normalizedCanonicalJson: string;
  readonly paymentResponseHeaderHash: string;
  readonly settlementResponseHash: string;
  readonly httpAttemptNumber: string;
  readonly observedAt: string;
}

export interface TransactionHint {
  readonly transactionHash: `0x${string}`;
  readonly source: "payment_response" | "authorization_used_log";
  readonly sourceBindingHash: string;
  readonly observedAt: string;
}

export interface AuthorizationUsedCandidate {
  readonly blockNumber: string;
  readonly blockHash: `0x${string}`;
  readonly transactionHash: `0x${string}`;
  readonly logIndex: string;
  readonly authorizer: `0x${string}`;
  readonly nonce: `0x${string}`;
}

export interface AuthorizationUsedScan {
  readonly schemaVersion: "apn.x402.authorization-used-scan.v1";
  readonly searchStartBlock: string;
  readonly nextFromBlock: string;
  readonly targetSafeHead: { readonly number: string; readonly hash: `0x${string}`; readonly observedAt: string };
  readonly lastCompletedChunk?: { readonly fromBlock: string; readonly toBlock: string; readonly toBlockHash: `0x${string}` };
  readonly candidates: readonly AuthorizationUsedCandidate[];
  readonly status: "active" | "complete" | "unavailable" | "ambiguous";
  readonly unavailableReason?: "pruned" | "range_unavailable";
  readonly updatedAt: string;
  readonly evidenceHash: string;
}

export interface SettlementEvidence {
  readonly schemaVersion: "apn.x402.settlement-evidence.v1";
  readonly network: "eip155:8453";
  readonly chainId: "8453";
  readonly token: `0x${string}`;
  readonly transactionHash: `0x${string}`;
  readonly safeHead: { readonly number: string; readonly hash: `0x${string}`; readonly observedAt: string };
  readonly transactionBlock: { readonly number: string; readonly hash: `0x${string}`; readonly timestamp: string };
  readonly receiptStatus: "1";
  readonly blockHashRechecked: true;
  readonly authorizationUsed: {
    readonly logIndex: string; readonly authorizer: `0x${string}`; readonly nonce: `0x${string}`;
    readonly blockNumber: string; readonly blockHash: `0x${string}`; readonly transactionHash: `0x${string}`;
  };
  readonly transfer: {
    readonly logIndex: string; readonly from: `0x${string}`; readonly to: `0x${string}`; readonly value: string;
    readonly blockNumber: string; readonly blockHash: `0x${string}`; readonly transactionHash: `0x${string}`;
  };
  readonly authorizationState: {
    readonly value: true; readonly blockNumber: string; readonly blockHash: `0x${string}`;
    readonly blockTag: "safe" | "number"; readonly observedAt: string;
  };
  readonly rpcOriginHash: string;
  readonly evidenceHash: string;
}

export interface UnusedExpiryEvidence {
  readonly schemaVersion: "apn.x402.unused-expiry-evidence.v1";
  readonly network: "eip155:8453";
  readonly chainId: "8453";
  readonly token: `0x${string}`;
  readonly validBefore: string;
  readonly finalizedHead: { readonly number: string; readonly hash: `0x${string}`; readonly timestamp: string; readonly observedAt: string };
  readonly authorizationState: {
    readonly value: false; readonly blockNumber: string; readonly blockHash: `0x${string}`;
    readonly blockTag: "finalized"; readonly observedAt: string;
  };
  readonly absence: {
    readonly localSettlement: false; readonly httpSettlement: false;
    readonly authorizationUsed: false; readonly transactionReceipt: false;
  };
  readonly rpcOriginHash: string;
  readonly evidenceHash: string;
}

export interface X402ResultRecord {
  readonly schemaVersion: "apn.x402.result.v1";
  readonly operationId: string;
  readonly mediaType: string;
  readonly bodyEncoding: "utf8";
  readonly bodyText: string;
  readonly resultHash: string;
  readonly byteLength: string;
  readonly responseStatus: "200";
  readonly createdAt: string;
  readonly integrityHash: string;
}

export type X402TerminalState = "completed" | "failed_before_effect" | "failed_expired_unused" | "failed_settled_without_result";

export interface X402ReceiptRecord {
  readonly schemaVersion: "apn.x402.receipt.v1";
  readonly kind: "x402_fetch";
  readonly operationId: string;
  readonly terminalState: X402TerminalState;
  readonly reason: X402Reason;
  readonly proofClass: X402ProofClass;
  readonly resource: { readonly origin: string; readonly path: string; readonly urlHash: string };
  readonly fingerprint: string;
  readonly offerHash: string;
  readonly payer: `0x${string}`;
  readonly payee: `0x${string}`;
  readonly amountAtomic: string;
  readonly network: "eip155:8453";
  readonly token: `0x${string}`;
  readonly paymentIdentifier?: string;
  readonly settlementResponseHash?: string;
  readonly settlementEvidence?: SettlementEvidence;
  readonly unusedExpiryEvidence?: UnusedExpiryEvidence;
  readonly result?: { readonly resultHash: string; readonly mediaType: string; readonly byteLength: string; readonly resultIntegrityHash: string };
  readonly operationBindingHash: string;
  readonly previousLinkHash: string;
  readonly createdAt: string;
  readonly integrityHash: string;
}

export interface X402Transition {
  readonly sequence: string;
  readonly at: string;
  readonly state: X402State;
  readonly terminal: boolean;
  readonly reason: X402Reason;
  readonly proofClass: X402ProofClass;
  readonly previousHash: string;
  readonly hash: string;
}

export interface X402OperationRecord {
  readonly schemaVersion: "apn.x402.state.v1";
  readonly kind: "x402_fetch";
  readonly operationId: string;
  readonly idempotencyHash: string;
  readonly profile: string;
  readonly profileHash: string;
  readonly requestHash: string;
  readonly fingerprint: string;
  readonly resource: { readonly canonicalUrl: string; readonly origin: string; readonly path: string; readonly urlHash: string };
  readonly sellerWire: { readonly resourceCanonicalJson: string; readonly resourceHash: string };
  readonly chainId: "8453";
  readonly network: "eip155:8453";
  readonly token: `0x${string}`;
  readonly wallet: `0x${string}`;
  readonly payee: `0x${string}`;
  readonly amountAtomic: string;
  readonly capAtomic: string;
  readonly selectedOffer: X402SelectedOffer;
  readonly preparedBlock: { readonly number: string; readonly hash: `0x${string}`; readonly observedAt: string };
  readonly paymentIdentifier?: { readonly declarationCanonicalJson: string; readonly declarationHash: string; readonly value: string };
  readonly authorization: {
    readonly from: `0x${string}`;
    readonly to: `0x${string}`;
    readonly value: string;
    readonly validAfter: "0";
    readonly validBefore: string;
    readonly nonce: `0x${string}`;
    readonly createdAt: string;
    readonly intentHash: string;
  };
  readonly signatureHash?: string;
  readonly paymentPayloadHash?: string;
  readonly paymentHeaderHash?: string;
  readonly attempts: readonly X402Attempt[];
  readonly settlementResponseObservation?: SettlementResponseObservation;
  readonly transactionHint?: TransactionHint;
  readonly authorizationUsedScan?: AuthorizationUsedScan;
  readonly settlementEvidence?: SettlementEvidence;
  readonly unusedExpiryEvidence?: UnusedExpiryEvidence;
  readonly resultLink?: { readonly resultHash: string; readonly resultIntegrityHash: string };
  readonly receiptLink?: { readonly receiptIntegrityHash: string };
  readonly state: X402State;
  readonly finalityClass: X402FinalityClass;
  readonly terminal: boolean;
  readonly reason: X402Reason;
  readonly proofClass: X402ProofClass;
  readonly nextActions: readonly SafeNextAction[];
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly transitions: readonly X402Transition[];
  readonly integrityHash: string;
}

export function x402RequestHash(input: { readonly profile: string; readonly canonicalUrl: string; readonly capAtomic: string }): string {
  return hashObject({
    method: "x402.fetch.prepare",
    profile: input.profile,
    canonicalUrl: input.canonicalUrl,
    capAtomic: input.capAtomic,
  });
}

export function x402Fingerprint(input: Pick<X402OperationRecord,
  "kind" | "profile" | "operationId" | "resource" | "chainId" | "network" | "token" | "capAtomic" | "selectedOffer" | "wallet" | "paymentIdentifier"
>): string {
  return domainHash("apn.x402.request.v1", canonicalJson({
    kind: input.kind,
    profile: input.profile,
    operationId: input.operationId,
    method: "GET",
    canonicalFullUrl: input.resource.canonicalUrl,
    chainId: input.chainId,
    network: input.network,
    token: input.token,
    capAtomic: input.capAtomic,
    selectedOfferHash: input.selectedOffer.offerHash,
    wallet: input.wallet,
    acceptedResolvedDefaults: input.selectedOffer.resolved,
    paymentIdentifier: input.paymentIdentifier === undefined
      ? { advertised: false }
      : { advertised: true, declarationHash: input.paymentIdentifier.declarationHash, value: input.paymentIdentifier.value },
  }));
}

export function x402AuthorizationIntentHash(value: Omit<X402OperationRecord["authorization"], "intentHash">): string {
  return domainHash("apn.x402.authorization-intent.v1", canonicalJson(value));
}

export function x402OperationBindingHash(operation: X402OperationRecord): string {
  return domainHash("apn.x402.binding.v1", canonicalJson({
    version: 1,
    x402Version: 2,
    method: "GET",
    canonicalFullUrl: operation.resource.canonicalUrl,
    resource: JSON.parse(operation.sellerWire.resourceCanonicalJson) as unknown,
    acceptedResolvedDefaults: operation.selectedOffer.resolved,
    payer: operation.wallet,
    operationId: operation.operationId,
    ...(operation.paymentIdentifier === undefined ? {} : { paymentIdentifier: operation.paymentIdentifier.value }),
  }));
}

export function x402TransactionHintSourceBindingHash(
  source: TransactionHint["source"],
  sourceHash: string,
): string {
  return domainHash("apn.x402.transaction-hint.v1", canonicalJson(
    source === "payment_response"
      ? { source, settlementResponseHash: sourceHash }
      : { source, authorizationUsedScanEvidenceHash: sourceHash },
  ));
}

export function appendX402Transition(
  previous: readonly X402Transition[],
  input: Omit<X402Transition, "sequence" | "previousHash" | "hash">,
): readonly X402Transition[] {
  const last = previous.at(-1);
  const body: Omit<X402Transition, "hash"> = {
    sequence: (BigInt(last?.sequence ?? "0") + 1n).toString(),
    ...input,
    previousHash: last?.hash ?? ZERO_HASH,
  };
  return [...previous, { ...body, hash: domainHash(TRANSITION_VERSION, canonicalJson(body)) }];
}

export function sealX402Operation(value: Omit<X402OperationRecord, "integrityHash">): X402OperationRecord {
  return { ...value, integrityHash: domainHash(X402_STATE_VERSION, canonicalJson(value)) };
}

export function validateX402Operation(value: unknown): X402OperationRecord {
  try {
    return validateX402OperationUnsafe(value);
  } catch (error) {
    if (error instanceof ApnError && error.code === "APN_STATE_CORRUPT") throw error;
    stateCorrupt("x402 operation protected state validation failed.");
  }
}

export function publicX402Operation(operation: X402OperationRecord, result?: X402ResultRecord): unknown {
  const value = {
    schemaVersion: "apn.x402.public-operation.v1",
    kind: operation.kind,
    operationId: operation.operationId,
    state: operation.state,
    finalityClass: operation.finalityClass,
    terminal: operation.terminal,
    reason: operation.reason,
    proofClass: operation.proofClass,
    nextActions: operation.nextActions,
    createdAt: operation.createdAt,
    updatedAt: operation.updatedAt,
    resource: {
      origin: operation.resource.origin,
      path: operation.resource.path,
      urlHash: operation.resource.urlHash,
    },
    payer: operation.wallet,
    payee: operation.payee,
    amountAtomic: operation.amountAtomic,
    network: operation.network,
    token: operation.token,
    ...(operation.paymentIdentifier === undefined ? {} : { paymentIdentifier: operation.paymentIdentifier.value }),
    ...(operation.transactionHint === undefined ? {} : { transactionHash: operation.transactionHint.transactionHash }),
    ...(operation.settlementEvidence === undefined ? {} : {
      blockNumber: operation.settlementEvidence.transactionBlock.number,
      blockHash: operation.settlementEvidence.transactionBlock.hash,
      authorizationState: {
        value: true as const,
        blockNumber: operation.settlementEvidence.authorizationState.blockNumber,
        blockHash: operation.settlementEvidence.authorizationState.blockHash,
      },
    }),
    ...(result === undefined ? {} : {
      result: { resultHash: result.resultHash, mediaType: result.mediaType, byteLength: result.byteLength },
    }),
  };
  return { ...value, integrityHash: domainHash("apn.x402.public-operation.v1", canonicalJson(value)) };
}

export function sealX402Result(value: Omit<X402ResultRecord, "integrityHash">): X402ResultRecord {
  return { ...value, integrityHash: domainHash("apn.x402.result.v1", canonicalJson(value)) };
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

function validateX402OperationUnsafe(value: unknown): X402OperationRecord {
  const operation = record(value);
  const required = [
    "schemaVersion", "kind", "operationId", "idempotencyHash", "profile", "profileHash", "requestHash", "fingerprint",
    "resource", "sellerWire", "chainId", "network", "token", "wallet", "payee", "amountAtomic", "capAtomic",
    "selectedOffer", "preparedBlock", "authorization", "attempts", "state", "finalityClass", "terminal", "reason",
    "proofClass", "nextActions", "createdAt", "updatedAt", "transitions", "integrityHash",
  ];
  const optional = [
    "paymentIdentifier", "signatureHash", "paymentPayloadHash", "paymentHeaderHash", "settlementResponseObservation",
    "transactionHint", "authorizationUsedScan", "settlementEvidence", "unusedExpiryEvidence", "resultLink", "receiptLink",
  ];
  allowedKeys(operation, required, optional);
  if (operation.schemaVersion !== X402_STATE_VERSION || operation.kind !== "x402_fetch") stateCorrupt("x402 operation discriminant is invalid.");
  for (const key of ["operationId", "idempotencyHash", "profileHash", "requestHash", "fingerprint", "integrityHash"] as const) hash(operation[key]);
  if (typeof operation.profile !== "string" || operation.profile.length === 0) stateCorrupt("x402 profile is invalid.");
  if (operation.profileHash !== sha256(`profile\0${operation.profile}`)) stateCorrupt("x402 profile hash is invalid.");

  const resource = exactRecord(operation.resource, ["canonicalUrl", "origin", "path", "urlHash"]);
  if (typeof resource.canonicalUrl !== "string" || typeof resource.origin !== "string" || typeof resource.path !== "string") stateCorrupt("x402 resource is invalid.");
  hash(resource.urlHash);
  const endpoint = new URL(resource.canonicalUrl);
  if (endpoint.toString() !== resource.canonicalUrl || endpoint.protocol !== "https:" || endpoint.username !== "" || endpoint.password !== "" || endpoint.hash !== "" || Buffer.byteLength(resource.canonicalUrl, "utf8") > 2048) stateCorrupt("x402 canonical URL is invalid.");
  if (resource.origin !== endpoint.origin || resource.path !== endpoint.pathname || resource.urlHash !== sha256(resource.canonicalUrl)) stateCorrupt("x402 public resource binding is invalid.");

  const sellerWire = exactRecord(operation.sellerWire, ["resourceCanonicalJson", "resourceHash"]);
  const resourceValue = canonicalText(sellerWire.resourceCanonicalJson);
  hash(sellerWire.resourceHash);
  if (sellerWire.resourceHash !== domainHash("apn.x402.resource.v1", sellerWire.resourceCanonicalJson as string)) stateCorrupt("x402 seller resource hash is invalid.");

  if (operation.chainId !== "8453" || operation.network !== CHAIN_CAIP2 || operation.token !== BASE_USDC.toLowerCase()) stateCorrupt("x402 chain or token binding is invalid.");
  address(operation.wallet);
  address(operation.payee);
  const amount = parseAtomic(operation.amountAtomic, { positive: true });
  const cap = parseAtomic(operation.capAtomic, { positive: true });
  if (amount > cap) stateCorrupt("x402 amount exceeds the frozen cap.");

  const selectedOffer = exactRecord(operation.selectedOffer, ["index", "declaredCanonicalJson", "resolved", "offerHash"]);
  parseAtomic(selectedOffer.index);
  if (BigInt(selectedOffer.index as string) >= 16n) stateCorrupt("x402 selected offer index exceeds the supported seller list bound.");
  const requirements = canonicalText(selectedOffer.declaredCanonicalJson);
  const resolved = exactRecord(selectedOffer.resolved, ["tokenName", "tokenVersion", "assetTransferMethod", "paymentFlow"]);
  if (
    typeof resolved.tokenName !== "string" || typeof resolved.tokenVersion !== "string" ||
    resolved.assetTransferMethod !== "eip3009" || resolved.paymentFlow !== "transferWithAuthorization"
  ) stateCorrupt("x402 resolved offer defaults are invalid.");
  hash(selectedOffer.offerHash);
  if (selectedOffer.offerHash !== domainHash("apn.x402.offer.v1", selectedOffer.declaredCanonicalJson as string)) stateCorrupt("x402 offer hash is invalid.");

  let declaration: unknown;
  if (operation.paymentIdentifier !== undefined) {
    const paymentIdentifier = exactRecord(operation.paymentIdentifier, ["declarationCanonicalJson", "declarationHash", "value"]);
    declaration = canonicalText(paymentIdentifier.declarationCanonicalJson);
    hash(paymentIdentifier.declarationHash);
    if (
      paymentIdentifier.declarationHash !== domainHash("apn.x402.payment-identifier-declaration.v1", paymentIdentifier.declarationCanonicalJson as string) ||
      paymentIdentifier.value !== `apn_${operation.operationId}`
    ) stateCorrupt("x402 payment identifier binding is invalid.");
  }

  const paymentRequired = {
    x402Version: 2,
    resource: resourceValue,
    accepts: [requirements],
    ...(declaration === undefined ? {} : { extensions: { "payment-identifier": declaration } }),
  };
  const header = Buffer.from(canonicalJson(paymentRequired), "utf8").toString("base64");
  const decoded = decodePaymentRequiredHeader(header);
  const candidates = inspectCandidates(decoded, resource.canonicalUrl as string);
  if (candidates.length !== 1) stateCorrupt("x402 frozen offer is no longer statically compatible.");
  const candidate = candidates[0];
  if (
    candidate === undefined || candidate.offerHash !== selectedOffer.offerHash || candidate.asset !== operation.token ||
    candidate.amountAtomic !== operation.amountAtomic || candidate.payTo !== operation.payee ||
    candidate.tokenName !== resolved.tokenName || candidate.tokenVersion !== resolved.tokenVersion ||
    candidate.assetTransferMethod !== resolved.assetTransferMethod || candidate.paymentFlow !== resolved.paymentFlow
  ) stateCorrupt("x402 frozen offer economics disagree with protected state.");

  const preparedBlock = exactRecord(operation.preparedBlock, ["number", "hash", "observedAt"]);
  parseAtomic(preparedBlock.number);
  bytes32(preparedBlock.hash);
  timestamp(preparedBlock.observedAt);

  const authorization = exactRecord(operation.authorization, ["from", "to", "value", "validAfter", "validBefore", "nonce", "createdAt", "intentHash"]);
  address(authorization.from);
  address(authorization.to);
  parseAtomic(authorization.value, { positive: true });
  parseAtomic(authorization.validBefore, { positive: true });
  parseAtomic(authorization.createdAt);
  bytes32(authorization.nonce);
  hash(authorization.intentHash);
  if (
    authorization.from !== operation.wallet || authorization.to !== operation.payee || authorization.value !== operation.amountAtomic ||
    authorization.validAfter !== "0" || BigInt(authorization.validBefore as string) !== BigInt(authorization.createdAt as string) + BigInt(candidate.maxTimeoutSeconds)
  ) stateCorrupt("x402 authorization economics are invalid.");
  const { intentHash: _intentHash, ...intent } = authorization;
  if (authorization.intentHash !== x402AuthorizationIntentHash(intent as Omit<X402OperationRecord["authorization"], "intentHash">)) stateCorrupt("x402 authorization intent hash is invalid.");

  const signatureKeys = ["signatureHash", "paymentPayloadHash", "paymentHeaderHash"] as const;
  const signatureCount = signatureKeys.filter((key) => operation[key] !== undefined).length;
  if (signatureCount !== 0 && signatureCount !== signatureKeys.length) stateCorrupt("x402 payment material hashes are incomplete.");
  for (const key of signatureKeys) if (operation[key] !== undefined) hash(operation[key]);
  const attempts = validateAttempts(operation.attempts, operation);
  const settlementResponseObservation = operation.settlementResponseObservation === undefined
    ? undefined : validateSettlementResponseObservation(operation.settlementResponseObservation, operation, attempts);
  const transactionHint = operation.transactionHint === undefined ? undefined : validateTransactionHint(operation.transactionHint);
  const authorizationUsedScan = operation.authorizationUsedScan === undefined ? undefined : validateAuthorizationUsedScan(operation.authorizationUsedScan, operation);
  const settlementEvidence = operation.settlementEvidence === undefined ? undefined : validateSettlementEvidence(operation.settlementEvidence, operation);
  const unusedExpiryEvidence = operation.unusedExpiryEvidence === undefined ? undefined : validateUnusedExpiryEvidence(operation.unusedExpiryEvidence, operation);
  if (operation.resultLink !== undefined) {
    const link = exactRecord(operation.resultLink, ["resultHash", "resultIntegrityHash"]);
    hash(link.resultHash); hash(link.resultIntegrityHash);
  }
  if (operation.receiptLink !== undefined) {
    const link = exactRecord(operation.receiptLink, ["receiptIntegrityHash"]);
    hash(link.receiptIntegrityHash);
  }
  validateStateSummary(operation, {
    signatureCount,
    attempts,
    settlementResponseObservation,
    transactionHint,
    authorizationUsedScan,
    settlementEvidence,
    unusedExpiryEvidence,
  });
  timestamp(operation.createdAt);
  timestamp(operation.updatedAt);
  if (!Array.isArray(operation.transitions)) stateCorrupt("x402 transitions are invalid.");
  validateTransitions(operation.transitions as readonly X402Transition[]);
  const last = (operation.transitions as readonly X402Transition[]).at(-1);
  if (
    last === undefined || last.state !== operation.state || last.terminal !== operation.terminal ||
    last.reason !== operation.reason || last.proofClass !== operation.proofClass
  ) stateCorrupt("x402 transition summary is invalid.");
  if (operation.createdAt !== (operation.transitions as readonly X402Transition[])[0]?.at || operation.updatedAt !== last.at) {
    stateCorrupt("x402 transition timestamps do not bind the operation summary.");
  }

  const typed = operation as unknown as X402OperationRecord;
  if (typed.requestHash !== x402RequestHash({ profile: typed.profile, canonicalUrl: typed.resource.canonicalUrl, capAtomic: typed.capAtomic })) stateCorrupt("x402 request hash is invalid.");
  if (typed.fingerprint !== x402Fingerprint(typed)) stateCorrupt("x402 request fingerprint is invalid.");
  const { integrityHash: _ignored, ...withoutIntegrity } = typed;
  if (typed.integrityHash !== domainHash(X402_STATE_VERSION, canonicalJson(withoutIntegrity))) stateCorrupt("x402 operation integrity hash is invalid.");
  return typed;
}

function validateTransitions(values: readonly X402Transition[]): void {
  let previousHash = ZERO_HASH;
  let previousAt = -Infinity;
  for (let index = 0; index < values.length; index += 1) {
    const transition = exactRecord(values[index], ["sequence", "at", "state", "terminal", "reason", "proofClass", "previousHash", "hash"]);
    if (transition.sequence !== String(index + 1) || transition.previousHash !== previousHash) stateCorrupt("x402 transition chain is discontinuous.");
    validateStateTuple(transition.state, transition.terminal, transition.reason, transition.proofClass);
    if (index === 0 && transition.state !== "awaiting_approval") stateCorrupt("x402 transition genesis is invalid.");
    if (index > 0) {
      const prior = values[index - 1];
      if (prior === undefined || !legalNextState(prior.state, transition.state as X402State)) stateCorrupt("x402 state transition is illegal.");
    }
    timestamp(transition.at);
    const transitionAt = Date.parse(transition.at as string);
    if (transitionAt < previousAt) stateCorrupt("x402 transition timestamps are not chronological.");
    previousAt = transitionAt;
    hash(transition.previousHash);
    hash(transition.hash);
    const { hash: _hash, ...body } = transition;
    if (transition.hash !== domainHash(TRANSITION_VERSION, canonicalJson(body))) stateCorrupt("x402 transition hash is invalid.");
    previousHash = transition.hash as string;
  }
  if (values.length === 0) stateCorrupt("x402 operation has no transitions.");
}

const STATE_SHAPE: Readonly<Record<X402State, {
  readonly finalityClass: X402FinalityClass;
  readonly terminal: boolean;
  readonly reason: X402Reason;
  readonly proofClass: X402ProofClass;
  readonly nextActions: readonly SafeNextAction[];
}>> = {
  awaiting_approval: { finalityClass: "pre_effect", terminal: false, reason: "x402_awaiting_authorization", proofClass: "x402_frozen_offer", nextActions: ["x402.fetch.approve", "operation.status"] },
  authorization_material_pending: { finalityClass: "pre_effect", terminal: false, reason: "x402_authorization_material_pending", proofClass: "x402_authorization_recovery", nextActions: ["operation.resume", "operation.status"] },
  authorized_not_sent: { finalityClass: "pre_effect", terminal: false, reason: "x402_authorized_not_sent", proofClass: "x402_authorization_verified", nextActions: ["operation.resume", "operation.status"] },
  paid_request_pending: { finalityClass: "unknown_finality", terminal: false, reason: "x402_paid_request_pending", proofClass: "x402_unknown_finality", nextActions: ["operation.resume", "operation.status"] },
  settlement_pending: { finalityClass: "unknown_finality", terminal: false, reason: "x402_settlement_pending", proofClass: "x402_unknown_finality", nextActions: ["operation.resume", "operation.status"] },
  effect_unknown: { finalityClass: "unknown_finality", terminal: false, reason: "x402_effect_unknown", proofClass: "x402_unknown_finality", nextActions: ["operation.resume", "operation.status"] },
  seller_result_recovery_pending: { finalityClass: "known_settled", terminal: false, reason: "x402_seller_result_recovery_pending", proofClass: "x402_settlement_verified_result_pending", nextActions: ["operation.resume", "operation.status"] },
  completed: { finalityClass: "terminal", terminal: true, reason: "x402_completed", proofClass: "x402_safe_settlement", nextActions: ["receipt.get"] },
  failed_before_effect: { finalityClass: "terminal", terminal: true, reason: "x402_failed_before_effect", proofClass: "x402_proven_no_effect", nextActions: ["receipt.get"] },
  failed_expired_unused: { finalityClass: "terminal", terminal: true, reason: "x402_failed_expired_unused", proofClass: "x402_expired_unused_finalized", nextActions: ["receipt.get"] },
  failed_settled_without_result: { finalityClass: "terminal", terminal: true, reason: "x402_failed_settled_without_result", proofClass: "x402_settled_result_unavailable", nextActions: ["receipt.get"] },
};

const LEGAL_NEXT: Readonly<Record<X402State, readonly X402State[]>> = {
  awaiting_approval: ["authorization_material_pending", "failed_before_effect"],
  authorization_material_pending: ["authorization_material_pending", "authorized_not_sent", "failed_before_effect"],
  authorized_not_sent: ["authorized_not_sent", "paid_request_pending", "effect_unknown", "failed_expired_unused"],
  paid_request_pending: ["settlement_pending", "effect_unknown", "seller_result_recovery_pending", "completed"],
  settlement_pending: ["settlement_pending", "effect_unknown", "seller_result_recovery_pending", "completed", "failed_settled_without_result"],
  effect_unknown: ["effect_unknown", "settlement_pending", "paid_request_pending", "seller_result_recovery_pending", "completed", "failed_expired_unused", "failed_settled_without_result"],
  seller_result_recovery_pending: ["seller_result_recovery_pending", "effect_unknown", "completed", "failed_settled_without_result"],
  completed: [], failed_before_effect: [], failed_expired_unused: [], failed_settled_without_result: [],
};

function legalNextState(from: X402State, to: X402State): boolean { return LEGAL_NEXT[from].includes(to); }

function validateStateTuple(state: unknown, terminal: unknown, reason: unknown, proofClass: unknown): X402State {
  if (typeof state !== "string" || !(state in STATE_SHAPE)) stateCorrupt("x402 state is invalid.");
  const typedState = state as X402State;
  const shape = STATE_SHAPE[typedState];
  if (terminal !== shape.terminal || reason !== shape.reason || proofClass !== shape.proofClass) stateCorrupt("x402 state classification is invalid.");
  return typedState;
}

function validateStateSummary(
  operation: Record<string, unknown>,
  evidence: {
    readonly signatureCount: number;
    readonly attempts: readonly X402Attempt[];
    readonly settlementResponseObservation: SettlementResponseObservation | undefined;
    readonly transactionHint: TransactionHint | undefined;
    readonly authorizationUsedScan: AuthorizationUsedScan | undefined;
    readonly settlementEvidence: SettlementEvidence | undefined;
    readonly unusedExpiryEvidence: UnusedExpiryEvidence | undefined;
  },
): void {
  const state = validateStateTuple(operation.state, operation.terminal, operation.reason, operation.proofClass);
  const shape = STATE_SHAPE[state];
  if (operation.finalityClass !== shape.finalityClass) stateCorrupt("x402 finality class is invalid for state.");
  if (!Array.isArray(operation.nextActions) || operation.nextActions.some((item) => typeof item !== "string")) stateCorrupt("x402 next actions are invalid.");
  const actions = operation.nextActions as readonly string[];
  const standardActions = shape.nextActions;
  const archivalActions = state === "effect_unknown" && evidence.authorizationUsedScan?.status === "unavailable"
    ? [...standardActions, "use.archival_rpc"] : standardActions;
  if (canonicalJson(actions) !== canonicalJson(archivalActions)) stateCorrupt("x402 next actions are invalid for state.");

  const noResponseEvidence = evidence.settlementResponseObservation === undefined && evidence.transactionHint === undefined &&
    evidence.authorizationUsedScan === undefined && evidence.settlementEvidence === undefined && evidence.unusedExpiryEvidence === undefined;
  const noEffectEvidence = evidence.settlementResponseObservation === undefined && evidence.transactionHint === undefined &&
    evidence.settlementEvidence === undefined && evidence.unusedExpiryEvidence === undefined;
  const hasResultLink = operation.resultLink !== undefined;
  const hasReceiptLink = operation.receiptLink !== undefined;
  const lastAttempt = evidence.attempts.at(-1);
  if (hasResultLink) {
    const resultLink = record(operation.resultLink);
    const response = evidence.settlementResponseObservation;
    const attemptIndex = Number(response?.httpAttemptNumber ?? "0") - 1;
    const attempt = Number.isSafeInteger(attemptIndex) && attemptIndex >= 0
      ? evidence.attempts[attemptIndex]
      : undefined;
    if (
      response?.classification !== "success" || attempt?.phase !== "observed" ||
      attempt.observation?.status !== "200" || attempt.observation.bodyHash !== resultLink.resultHash
    ) stateCorrupt("x402 result link does not bind its designated successful response.");
  }
  if (evidence.settlementEvidence !== undefined && evidence.transactionHint === undefined) {
    stateCorrupt("x402 final settlement evidence lacks a transaction hint.");
  }
  if (state === "awaiting_approval" && (evidence.signatureCount !== 0 || evidence.attempts.length !== 0 || !noResponseEvidence || hasResultLink || hasReceiptLink)) {
    stateCorrupt("x402 awaiting approval contains later-phase evidence.");
  }
  if (state === "authorization_material_pending" && (evidence.signatureCount !== 0 || evidence.attempts.length !== 0 || !noResponseEvidence || hasResultLink || hasReceiptLink)) {
    stateCorrupt("x402 authorization-pending state contains later-phase evidence.");
  }
  if (state === "authorized_not_sent" && (evidence.signatureCount !== 3 || evidence.attempts.length !== 0 || !noEffectEvidence || hasResultLink || hasReceiptLink)) {
    stateCorrupt("x402 authorized-not-sent evidence is invalid.");
  }
  if (state === "paid_request_pending" && (evidence.signatureCount !== 3 || lastAttempt?.purpose !== "payment" || lastAttempt.phase !== "pending" || !noEffectEvidence || hasResultLink || hasReceiptLink)) {
    stateCorrupt("x402 paid-request pending marker is invalid.");
  }
  if (["settlement_pending", "effect_unknown"].includes(state) && (
    evidence.signatureCount !== 3 ||
    (evidence.attempts.length === 0 && !(state === "effect_unknown" && evidence.authorizationUsedScan?.status === "unavailable")) ||
    hasReceiptLink || (state === "settlement_pending" && evidence.unusedExpiryEvidence !== undefined)
  )) {
    stateCorrupt("x402 ambiguous settlement evidence is invalid.");
  }
  if (state === "effect_unknown" && evidence.unusedExpiryEvidence !== undefined && (
    evidence.settlementResponseObservation !== undefined || evidence.transactionHint !== undefined ||
    evidence.settlementEvidence !== undefined || evidence.authorizationUsedScan?.status !== "complete" ||
    evidence.authorizationUsedScan.candidates.length !== 0 || hasResultLink
  )) stateCorrupt("x402 preterminal unused-expiry evidence is incomplete or contradictory.");
  if (state === "effect_unknown" && evidence.settlementEvidence !== undefined && hasResultLink) {
    stateCorrupt("x402 effect-unknown state cannot combine final settlement evidence with a linked seller result.");
  }
  if (state === "settlement_pending" && evidence.transactionHint === undefined) stateCorrupt("x402 settlement pending lacks a transaction hint.");
  if (state === "seller_result_recovery_pending" && (
    evidence.signatureCount !== 3 || operation.paymentIdentifier === undefined || evidence.transactionHint === undefined ||
    evidence.settlementEvidence === undefined || evidence.unusedExpiryEvidence !== undefined || hasReceiptLink ||
    (evidence.settlementResponseObservation === undefined
      ? evidence.transactionHint.source !== "authorization_used_log"
      : evidence.transactionHint.source !== "payment_response")
  )) stateCorrupt("x402 seller-result recovery evidence is invalid.");
  if (state === "completed" && (
    evidence.signatureCount !== 3 || evidence.settlementResponseObservation === undefined || evidence.transactionHint === undefined ||
    evidence.settlementEvidence === undefined || evidence.unusedExpiryEvidence !== undefined || !hasResultLink || !hasReceiptLink
  )) stateCorrupt("x402 completed evidence graph is incomplete.");
  if (state === "completed") {
    const response = evidence.settlementResponseObservation;
    const attempt = response === undefined ? undefined : evidence.attempts[Number(response.httpAttemptNumber) - 1];
    if (
      response?.classification !== "success" || evidence.transactionHint?.source !== "payment_response" ||
      (attempt?.purpose !== "payment" && attempt?.purpose !== "result_recovery") || attempt.phase !== "observed" ||
      attempt.observation?.status !== "200"
    ) stateCorrupt("x402 completed state lacks an observed successful paid response.");
  }
  if (state === "failed_before_effect" && (
    evidence.signatureCount !== 0 || evidence.attempts.length !== 0 || !noResponseEvidence || hasResultLink || !hasReceiptLink
  )) stateCorrupt("x402 failed-before-effect evidence is invalid.");
  if (state === "failed_expired_unused" && (
    evidence.signatureCount !== 3 || evidence.unusedExpiryEvidence === undefined || evidence.settlementResponseObservation !== undefined ||
    evidence.transactionHint !== undefined || evidence.settlementEvidence !== undefined ||
    evidence.authorizationUsedScan?.status !== "complete" || evidence.authorizationUsedScan.candidates.length !== 0 ||
    BigInt(evidence.authorizationUsedScan.nextFromBlock) !== BigInt(evidence.authorizationUsedScan.targetSafeHead.number) + 1n ||
    hasResultLink || !hasReceiptLink
  )) stateCorrupt("x402 expired-unused evidence is invalid.");
  if (state === "failed_settled_without_result") {
    const responseBacked = evidence.settlementResponseObservation !== undefined && evidence.transactionHint?.source === "payment_response";
    const scan = evidence.authorizationUsedScan;
    const scanBacked = evidence.settlementResponseObservation === undefined && evidence.transactionHint?.source === "authorization_used_log" &&
      scan?.status === "complete" && scan.candidates.length === 1 &&
      BigInt(scan.nextFromBlock) === BigInt(scan.targetSafeHead.number) + 1n;
    if (
      evidence.signatureCount !== 3 || (!responseBacked && !scanBacked) || evidence.transactionHint === undefined ||
      evidence.settlementEvidence === undefined || evidence.unusedExpiryEvidence !== undefined || hasResultLink || !hasReceiptLink
    ) stateCorrupt("x402 settled-without-result evidence is invalid.");
  }
  if (hasResultLink && !["settlement_pending", "effect_unknown", "seller_result_recovery_pending", "completed"].includes(state)) {
    stateCorrupt("x402 result link is invalid for state.");
  }
  if (evidence.settlementEvidence !== undefined && evidence.transactionHint !== undefined && evidence.settlementEvidence.transactionHash !== evidence.transactionHint.transactionHash) {
    stateCorrupt("x402 settlement evidence conflicts with the transaction hint.");
  }
  if (evidence.transactionHint?.source === "payment_response") {
    if (
      evidence.settlementResponseObservation === undefined ||
      evidence.transactionHint.sourceBindingHash !== x402TransactionHintSourceBindingHash(
        "payment_response",
        evidence.settlementResponseObservation.settlementResponseHash,
      )
    ) stateCorrupt("x402 payment-response transaction hint binding is invalid.");
    const normalized = JSON.parse(evidence.settlementResponseObservation.normalizedCanonicalJson) as Record<string, unknown>;
    if (evidence.transactionHint.transactionHash !== normalized.transaction) stateCorrupt("x402 payment-response transaction hint conflicts with its response.");
  }
  if (evidence.transactionHint?.source === "authorization_used_log") {
    const scan = evidence.authorizationUsedScan;
    const candidate = scan?.candidates[0];
    if (
      scan === undefined || scan.status !== "complete" || scan.candidates.length !== 1 || candidate === undefined ||
      BigInt(scan.nextFromBlock) !== BigInt(scan.targetSafeHead.number) + 1n ||
      evidence.transactionHint.sourceBindingHash !== x402TransactionHintSourceBindingHash("authorization_used_log", scan.evidenceHash) ||
      evidence.transactionHint.transactionHash !== candidate.transactionHash
    ) stateCorrupt("x402 authorization-used transaction hint is not a completed full-range unique scan proof.");
  }
}

function validateAttempts(value: unknown, operation: Record<string, unknown>): readonly X402Attempt[] {
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

function validateHttpObservation(value: unknown, attemptNumber: string, purpose: unknown, operation: Record<string, unknown>): X402HttpObservation {
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

function validateSettlementResponseObservation(
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

function validateNormalizedSettlement(
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

function validateTransactionHint(value: unknown): TransactionHint {
  const hint = exactRecord(value, ["transactionHash", "source", "sourceBindingHash", "observedAt"]);
  transactionHash(hint.transactionHash);
  if (hint.source !== "payment_response" && hint.source !== "authorization_used_log") stateCorrupt("x402 transaction hint source is invalid.");
  hash(hint.sourceBindingHash); timestamp(hint.observedAt);
  return hint as unknown as TransactionHint;
}

function validateAuthorizationUsedScan(value: unknown, operation: Record<string, unknown>): AuthorizationUsedScan {
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

function validateSettlementEvidence(value: unknown, operation?: Record<string, unknown>): SettlementEvidence {
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

function validateUnusedExpiryEvidence(value: unknown, operation?: Record<string, unknown>): UnusedExpiryEvidence {
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

function validateX402ResultUnsafe(value: unknown): X402ResultRecord {
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

function validateX402ReceiptUnsafe(value: unknown): X402ReceiptRecord {
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

function canonicalText(value: unknown, maxBytes = 48 * 1024): unknown {
  if (typeof value !== "string" || Buffer.byteLength(value, "utf8") > maxBytes) stateCorrupt("x402 protected canonical JSON is invalid.");
  const parsed = decodeCanonicalBase64Json(Buffer.from(value, "utf8").toString("base64"));
  if (canonicalJson(parsed) !== value) stateCorrupt("x402 protected JSON is not canonical.");
  return parsed;
}
function record(value: unknown): Record<string, unknown> {
  if (!isPlainRecord(value)) stateCorrupt("x402 state member is not an object.");
  return value;
}
function exactRecord(value: unknown, keys: readonly string[]): Record<string, unknown> {
  const output = record(value);
  if (!exactKeys(output, keys)) stateCorrupt("x402 state member has an unexpected schema.");
  return output;
}
function allowedRecord(value: unknown, required: readonly string[], optional: readonly string[]): Record<string, unknown> {
  const output = record(value);
  allowedKeys(output, required, optional);
  return output;
}
function allowedKeys(value: Record<string, unknown>, required: readonly string[], optional: readonly string[]): void {
  const allowed = new Set([...required, ...optional]);
  if (required.some((key) => !(key in value)) || Object.keys(value).some((key) => !allowed.has(key))) stateCorrupt("x402 operation has an unexpected schema.");
}
function hash(value: unknown): asserts value is string {
  if (typeof value !== "string" || !HASH.test(value)) stateCorrupt("x402 hash is invalid.");
}
function address(value: unknown): asserts value is `0x${string}` {
  if (typeof value !== "string" || !ADDRESS.test(value) || /^0x0{40}$/u.test(value)) stateCorrupt("x402 address is invalid.");
}
function bytes32(value: unknown): asserts value is `0x${string}` {
  if (typeof value !== "string" || !BYTES32.test(value)) stateCorrupt("x402 bytes32 is invalid.");
}
function transactionHash(value: unknown): asserts value is `0x${string}` {
  bytes32(value);
  if (/^0x0{64}$/u.test(value)) stateCorrupt("x402 transaction hash is zero.");
}
function uint(value: unknown): asserts value is string {
  try { parseAtomic(value); } catch { stateCorrupt("x402 unsigned integer is invalid."); }
}
function positive(value: unknown): asserts value is string {
  try { parseAtomic(value, { positive: true }); } catch { stateCorrupt("x402 positive integer is invalid."); }
}
function mediaType(value: unknown): asserts value is string {
  if (
    typeof value !== "string" || Buffer.byteLength(value, "utf8") > 128 ||
    (value !== "application/json" && !/^text\/[!#$%&'*+\-.^_`|~0-9a-z]+$/u.test(value))
  ) stateCorrupt("x402 media type is invalid.");
}
function timestamp(value: unknown): asserts value is string {
  if (typeof value !== "string" || !UTC.test(value)) stateCorrupt("x402 timestamp is invalid.");
  const milliseconds = Date.parse(value);
  if (!Number.isFinite(milliseconds) || new Date(milliseconds).toISOString() !== value) stateCorrupt("x402 timestamp is invalid.");
}
function hasUnpairedSurrogate(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code >= 0xd800 && code <= 0xdbff) {
      const next = value.charCodeAt(index + 1);
      if (next < 0xdc00 || next > 0xdfff) return true;
      index += 1;
    } else if (code >= 0xdc00 && code <= 0xdfff) {
      return true;
    }
  }
  return false;
}
function stateCorrupt(message: string): never {
  throw new ApnError("APN_STATE_CORRUPT", message);
}
