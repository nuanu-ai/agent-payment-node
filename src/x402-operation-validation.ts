import { canonicalJson, domainHash, isPlainRecord, sha256 } from "./canonical.js";
import { BASE_USDC, CHAIN_CAIP2 } from "./constants.js";
import { parseAtomic } from "./money.js";
import { decodePaymentRequiredHeader, inspectCandidates } from "./x402-codec.js";
import { frozenErc7710FacilitatorsMatch } from "./x402-erc7710-codec.js";
import {
  X402_STATE_VERSION,
  TRANSITION_VERSION,
  ZERO_HASH,
  x402AuthorizationIntentHash,
  x402Fingerprint,
  x402RequestHash,
  x402TransactionHintSourceBindingHash,
  type AuthorizationUsedScan,
  type SafeNextAction,
  type SettlementEvidence,
  type SettlementResponseObservation,
  type TransactionHint,
  type UnusedExpiryEvidence,
  type X402Attempt,
  type X402FinalityClass,
  type X402OperationRecord,
  type X402ProofClass,
  type X402Reason,
  type X402State,
  type X402Transition,
} from "./x402-state-model.js";
import {
  validateAttempts,
  validateAuthorizationUsedScan,
  validateSettlementEvidence,
  validateSettlementResponseObservation,
  validateTransferMethodEvidence,
  validateTransactionHint,
  validateUnusedExpiryEvidence,
} from "./x402-evidence-validation.js";
import {
  address,
  allowedKeys,
  bytes32,
  canonicalText,
  exactRecord,
  hash,
  positive,
  record,
  stateCorrupt,
  timestamp,
} from "./x402-state-validation-primitives.js";
export function validateX402OperationUnsafe(value: unknown): X402OperationRecord {
  const operation = record(value);
  const required = [
    "schemaVersion", "kind", "operationId", "idempotencyHash", "profile", "profileHash", "requestHash", "fingerprint",
    "resource", "sellerWire", "chainId", "network", "token", "wallet", "payee", "amountAtomic", "capAtomic",
    "selectedOffer", "preparedBlock", "authorization", "attempts", "state", "finalityClass", "terminal", "reason",
    "proofClass", "nextActions", "createdAt", "updatedAt", "transitions", "integrityHash",
  ];
  const optional = [
    "paymentIdentifier", "providerSigner", "delegatedMaterial", "signatureHash", "paymentPayloadHash", "paymentHeaderHash", "paymentContextHash", "settlementResponseObservation",
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
  const resolvedRecord = record(selectedOffer.resolved);
  const resolved = resolvedRecord.assetTransferMethod === "erc7710"
    ? exactRecord(resolvedRecord, ["assetTransferMethod", "paymentFlow", "facilitatorAddresses"])
    : exactRecord(resolvedRecord, ["tokenName", "tokenVersion", "assetTransferMethod", "paymentFlow"]);
  if (resolved.assetTransferMethod === "erc7710") {
    if (resolved.paymentFlow !== "delegatedErc20Transfer" || !Array.isArray(resolved.facilitatorAddresses) ||
      resolved.facilitatorAddresses.length === 0 || resolved.facilitatorAddresses.length > 16 ||
      new Set(resolved.facilitatorAddresses).size !== resolved.facilitatorAddresses.length) {
      stateCorrupt("x402 ERC-7710 resolved offer is invalid.");
    }
    for (const facilitator of resolved.facilitatorAddresses) address(facilitator);
  } else if (
    typeof resolved.tokenName !== "string" || typeof resolved.tokenVersion !== "string" ||
    resolved.assetTransferMethod !== "eip3009" || resolved.paymentFlow !== "transferWithAuthorization"
  ) stateCorrupt("x402 EIP-3009 resolved offer defaults are invalid.");
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
  const methodFieldsMatch = candidate?.assetTransferMethod === "erc7710" && resolved.assetTransferMethod === "erc7710"
    ? frozenErc7710FacilitatorsMatch(record(record(requirements).extra), resolved.facilitatorAddresses)
    : candidate?.assetTransferMethod === "eip3009" && resolved.assetTransferMethod === "eip3009" &&
      candidate.tokenName === resolved.tokenName && candidate.tokenVersion === resolved.tokenVersion;
  if (
    candidate === undefined || candidate.offerHash !== selectedOffer.offerHash || candidate.asset !== operation.token ||
    candidate.amountAtomic !== operation.amountAtomic || candidate.payTo !== operation.payee ||
    candidate.assetTransferMethod !== resolved.assetTransferMethod || candidate.paymentFlow !== resolved.paymentFlow ||
    !methodFieldsMatch
  ) stateCorrupt("x402 frozen offer economics disagree with protected state.");

  const preparedBlock = exactRecord(operation.preparedBlock, ["number", "hash", "observedAt"]);
  parseAtomic(preparedBlock.number);
  bytes32(preparedBlock.hash);
  timestamp(preparedBlock.observedAt);

  if (operation.providerSigner !== undefined) {
    const signer = exactRecord(operation.providerSigner, [
      "schemaVersion", "providerId", "profileRevision", "capabilityHash", "accountBindingHash",
      "executionMode", "executionOwner", "retryOwner",
    ]);
    if (
      signer.schemaVersion !== "apn.x402.provider-signer.v1" ||
      typeof signer.providerId !== "string" || !/^[a-z0-9][a-z0-9._-]{0,63}$/u.test(signer.providerId) ||
      signer.providerId === "local" || !Number.isSafeInteger(signer.profileRevision) || Number(signer.profileRevision) < 1 ||
      typeof signer.capabilityHash !== "string" || typeof signer.accountBindingHash !== "string" ||
      signer.executionMode !== "provider_detached_eip3009_apn_paid_retry" || signer.executionOwner !== "apn" ||
      signer.retryOwner !== "apn_state_machine"
    ) stateCorrupt("x402 provider signer binding is invalid.");
    hash(signer.capabilityHash);
    hash(signer.accountBindingHash);
  }

  if (operation.delegatedMaterial !== undefined) {
    const binding = exactRecord(operation.delegatedMaterial, [
      "schemaVersion", "method", "providerId", "profileRevision", "capabilityHash", "accountBindingHash",
      "permissionRevision", "rootGrantFingerprint", "sessionAddress", "delegationManager",
      "facilitatorAddresses", "effectiveExpiryUnix", "rpcOriginHash",
    ]);
    if (
      binding.schemaVersion !== "apn.x402.delegated-material-binding.v1" || binding.method !== "erc7710" ||
      typeof binding.providerId !== "string" || !/^[a-z0-9][a-z0-9._-]{0,63}$/u.test(binding.providerId) ||
      !Number.isSafeInteger(binding.profileRevision) || Number(binding.profileRevision) < 1 ||
      !Number.isSafeInteger(binding.permissionRevision) || Number(binding.permissionRevision) < 1 ||
      !Array.isArray(binding.facilitatorAddresses) || binding.facilitatorAddresses.length === 0 ||
      binding.facilitatorAddresses.length > 16 || new Set(binding.facilitatorAddresses).size !== binding.facilitatorAddresses.length ||
      resolved.assetTransferMethod !== "erc7710" ||
      canonicalJson(binding.facilitatorAddresses) !== canonicalJson(resolved.facilitatorAddresses)
    ) stateCorrupt("x402 delegated material binding is invalid.");
    hash(binding.capabilityHash); hash(binding.accountBindingHash); hash(binding.rootGrantFingerprint); hash(binding.rpcOriginHash);
    address(binding.sessionAddress); address(binding.delegationManager); positive(binding.effectiveExpiryUnix);
    for (const facilitator of binding.facilitatorAddresses) address(facilitator);
  }
  if (
    (resolved.assetTransferMethod === "erc7710") !== (operation.delegatedMaterial !== undefined) ||
    operation.providerSigner !== undefined && operation.delegatedMaterial !== undefined
  ) stateCorrupt("x402 transfer method and provider binding disagree.");

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
    authorization.validAfter !== "0" ||
    (resolved.assetTransferMethod === "eip3009"
      ? BigInt(authorization.validBefore as string) !== BigInt(authorization.createdAt as string) + BigInt(candidate.maxTimeoutSeconds)
      : BigInt(authorization.validBefore as string) !== BigInt(
          operation.delegatedMaterial === undefined ? "0" : String(record(operation.delegatedMaterial).effectiveExpiryUnix),
        ) ||
        BigInt(authorization.validBefore as string) > BigInt(authorization.createdAt as string) + BigInt(candidate.maxTimeoutSeconds))
  ) stateCorrupt("x402 authorization economics are invalid.");
  const { intentHash: _intentHash, ...intent } = authorization;
  if (authorization.intentHash !== x402AuthorizationIntentHash(intent as Omit<X402OperationRecord["authorization"], "intentHash">)) stateCorrupt("x402 authorization intent hash is invalid.");

  const signatureKeys = ["signatureHash", "paymentPayloadHash", "paymentHeaderHash"] as const;
  const signatureCount = signatureKeys.filter((key) => operation[key] !== undefined).length;
  if (signatureCount !== 0 && signatureCount !== signatureKeys.length) stateCorrupt("x402 payment material hashes are incomplete.");
  for (const key of signatureKeys) if (operation[key] !== undefined) hash(operation[key]);
  if (operation.paymentContextHash !== undefined) hash(operation.paymentContextHash);
  if ((resolved.assetTransferMethod === "erc7710" && signatureCount !== 0) !== (operation.paymentContextHash !== undefined)) {
    stateCorrupt("x402 delegated payment context hash is incomplete.");
  }
  const attempts = validateAttempts(operation.attempts, operation);
  const settlementResponseObservation = operation.settlementResponseObservation === undefined
    ? undefined : validateSettlementResponseObservation(operation.settlementResponseObservation, operation, attempts);
  const transactionHint = operation.transactionHint === undefined ? undefined : validateTransactionHint(operation.transactionHint);
  const authorizationUsedScan = operation.authorizationUsedScan === undefined ? undefined : validateAuthorizationUsedScan(operation.authorizationUsedScan, operation);
  const settlementEvidence = operation.settlementEvidence === undefined ? undefined : validateSettlementEvidence(operation.settlementEvidence, operation);
  const unusedExpiryEvidence = operation.unusedExpiryEvidence === undefined ? undefined : validateUnusedExpiryEvidence(operation.unusedExpiryEvidence, operation);
  validateTransferMethodEvidence(resolved.assetTransferMethod as "eip3009" | "erc7710", transactionHint,
    authorizationUsedScan, settlementEvidence, unusedExpiryEvidence);
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

export function validateTransitions(values: readonly X402Transition[]): void {
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
  authorized_not_sent: ["authorized_not_sent", "paid_request_pending", "effect_unknown", "failed_before_effect", "failed_expired_unused"],
  paid_request_pending: ["settlement_pending", "effect_unknown", "seller_result_recovery_pending", "completed"],
  settlement_pending: ["settlement_pending", "effect_unknown", "seller_result_recovery_pending", "completed", "failed_settled_without_result"],
  effect_unknown: ["effect_unknown", "settlement_pending", "paid_request_pending", "seller_result_recovery_pending", "completed", "failed_expired_unused", "failed_settled_without_result"],
  seller_result_recovery_pending: ["seller_result_recovery_pending", "effect_unknown", "completed", "failed_settled_without_result"],
  completed: [], failed_before_effect: [], failed_expired_unused: [], failed_settled_without_result: [],
};

export function legalNextState(from: X402State, to: X402State): boolean { return LEGAL_NEXT[from].includes(to); }

export function validateStateTuple(state: unknown, terminal: unknown, reason: unknown, proofClass: unknown): X402State {
  if (typeof state !== "string" || !(state in STATE_SHAPE)) stateCorrupt("x402 state is invalid.");
  const typedState = state as X402State;
  const shape = STATE_SHAPE[typedState];
  if (terminal !== shape.terminal || reason !== shape.reason || proofClass !== shape.proofClass) stateCorrupt("x402 state classification is invalid.");
  return typedState;
}

export function validateStateSummary(
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
  const archivalActions = (state === "effect_unknown" || state === "authorized_not_sent") &&
    evidence.authorizationUsedScan?.status === "unavailable"
    ? [...standardActions, "use.archival_rpc"] : standardActions;
  if (canonicalJson(actions) !== canonicalJson(archivalActions)) stateCorrupt("x402 next actions are invalid for state.");
  if (shape.terminal && evidence.attempts.some((attempt) => attempt.phase === "pending")) {
    stateCorrupt("x402 terminal state retains a pending HTTP attempt.");
  }

  const noResponseEvidence = evidence.settlementResponseObservation === undefined && evidence.transactionHint === undefined &&
    evidence.authorizationUsedScan === undefined && evidence.settlementEvidence === undefined && evidence.unusedExpiryEvidence === undefined;
  const noEffectEvidence = evidence.settlementResponseObservation === undefined && evidence.transactionHint === undefined &&
    evidence.settlementEvidence === undefined && evidence.unusedExpiryEvidence === undefined;
  const preterminalUnusedExpiry = evidence.unusedExpiryEvidence !== undefined &&
    evidence.settlementResponseObservation === undefined && evidence.transactionHint === undefined &&
    evidence.settlementEvidence === undefined && evidence.authorizationUsedScan?.status === "complete" &&
    evidence.authorizationUsedScan.candidates.length === 0;
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
  if (state === "authorized_not_sent" && (
    evidence.signatureCount !== 3 || evidence.attempts.length !== 0 || (!noEffectEvidence && !preterminalUnusedExpiry) ||
    hasResultLink || hasReceiptLink
  )) {
    stateCorrupt("x402 authorized-not-sent evidence is invalid.");
  }
  if (state === "paid_request_pending" && (evidence.signatureCount !== 3 || lastAttempt?.purpose !== "payment" || lastAttempt.phase !== "pending" || !noEffectEvidence || hasResultLink || hasReceiptLink)) {
    stateCorrupt("x402 paid-request pending marker is invalid.");
  }
  const transitionValues = Array.isArray(operation.transitions) ? operation.transitions : [];
  const previousTransition = transitionValues.at(-2);
  const currentTransition = transitionValues.at(-1);
  const scan = evidence.authorizationUsedScan;
  const zeroAttemptReorgLineage = scan !== undefined && scan.candidates.length === 0 &&
    evidence.transactionHint === undefined && evidence.settlementEvidence === undefined &&
    isPlainRecord(previousTransition) && previousTransition.state === "effect_unknown" &&
    isPlainRecord(currentTransition) && currentTransition.state === "effect_unknown";
  const zeroAttemptScanEvidence = state === "effect_unknown" && (
    evidence.authorizationUsedScan?.status === "unavailable" ||
    (evidence.authorizationUsedScan?.candidates.length ?? 0) > 0 ||
    zeroAttemptReorgLineage
  );
  if (["settlement_pending", "effect_unknown"].includes(state) && (
    evidence.signatureCount !== 3 ||
    (evidence.attempts.length === 0 && !zeroAttemptScanEvidence) ||
    hasReceiptLink || (state === "settlement_pending" && evidence.unusedExpiryEvidence !== undefined)
  )) {
    stateCorrupt("x402 ambiguous settlement evidence is invalid.");
  }
  if (state === "effect_unknown" && evidence.unusedExpiryEvidence !== undefined && (
    !preterminalUnusedExpiry || hasResultLink
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
  const delegatedPreExposureMaterial = record(record(operation.selectedOffer).resolved).assetTransferMethod === "erc7710" &&
    evidence.signatureCount === 3;
  if (state === "failed_before_effect" && (
    (evidence.signatureCount !== 0 && !delegatedPreExposureMaterial) || evidence.attempts.length !== 0 ||
    !noResponseEvidence || hasResultLink || !hasReceiptLink
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
    const fullUniqueScan = evidence.transactionHint?.source === "authorization_used_log" && scan?.status === "complete" &&
      scan.candidates.length === 1 && BigInt(scan.nextFromBlock) === BigInt(scan.targetSafeHead.number) + 1n;
    const scanBacked = evidence.settlementResponseObservation === undefined && fullUniqueScan;
    const responseTransaction = evidence.settlementResponseObservation === undefined
      ? undefined
      : (JSON.parse(evidence.settlementResponseObservation.normalizedCanonicalJson) as Record<string, unknown>).transaction;
    const responseCorroboratedByScan = fullUniqueScan && responseTransaction === evidence.transactionHint?.transactionHash;
    if (
      evidence.signatureCount !== 3 || (!responseBacked && !scanBacked && !responseCorroboratedByScan) ||
      evidence.transactionHint === undefined ||
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
