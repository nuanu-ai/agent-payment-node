import { validateFundingExternalFulfillment, type CircleFundingExternalFulfillment } from "./funding-external-proof.js";
import { getAddress, type Address, type Hex } from "viem";
import { canonicalJson, exactKeys, hashObject, isPlainRecord, sha256 } from "../canonical.js";
import { ApnError } from "../errors.js";
import { validateEvmNativeCustody, type EvmNativeCustody } from "../evm-native-custody.js";
import { validateAssetUsageReservation, type AssetUsageReservation } from "../asset-usage-ledger.js";
import { assertStoredFieldsEqual } from "../stored-record-binding.js";
import { CIRCLE_SOURCE_TOKEN, CIRCLE_MESSENGER, CIRCLE_TRANSMITTER, circleRoute, type CircleDestinationChain } from "./catalog.js";
import { assertCircleSource, assertCircleAttestation, encodeCircleApproval, encodeCircleBurn, encodeCircleMint,
  type CircleSourceProof, type CircleAttestation, type CircleReceiptProof, type decodeCircleDestination } from "./protocol.js";
import { circleBlocked, circleCorrupt, circleSame, validateCircle, publicCircle, type CircleOperationV1, type CircleRole, type CircleEffect, type CircleEnvelope } from "./operation-model.js";
import { validateCircleFundingBinding, assertCircleFundingFee, type CircleFundingBindingV2, type CircleFundingFeeV2 } from "./funding-binding.js";
export interface CircleFundingOperationV2 extends Omit<CircleOperationV1, "schemaVersion" | "externalFulfillment" | "nonceRetirement" | "state"> {
  readonly schemaVersion: "apn.circle-v2-evm-operation.v2";
  readonly funding: CircleFundingBindingV2;
  readonly feeQuote: CircleFundingFeeV2;
  readonly state: Exclude<CircleOperationV1["state"], "nonce_retired">;
  readonly externalFulfillment?: CircleFundingExternalFulfillment;
}
/** Initial source envelopes and the economic/authority context remain immutable through every transition. */
export function circleFundingFingerprint(op: Pick<CircleFundingOperationV2, "requestHash" | "funding" | "feeQuote" | "sourceCustody" | "destinationCustody" | "policies" | "deploymentDigest" | "effects" | "preparedAt" | "expiresAt">): string {
  return hashObject({ schemaVersion: "apn.circle-v2-evm-operation.v2", requestHash: op.requestHash, funding: op.funding, feeQuote: op.feeQuote,
    sourceCustody: op.sourceCustody, destinationCustody: op.destinationCustody, policies: op.policies, deploymentDigest: op.deploymentDigest,
    sourceEnvelopes: op.effects.filter(e => e.role === "approval" || e.role === "burn").map(e => ({ role: e.role, envelope: e.envelope })),
    preparedAt: op.preparedAt, expiresAt: op.expiresAt });
}
export function sealCircleFundingOperation(input: Omit<CircleFundingOperationV2, "integrityHash"> | CircleFundingOperationV2): CircleFundingOperationV2 {
  const { integrityHash: _old, ...body } = input as CircleFundingOperationV2; return { ...body, integrityHash: hashObject(body) };
}
export function advanceCircleFundingOperation(op: CircleFundingOperationV2, patch: Partial<CircleFundingOperationV2>, reason: string, now: number): CircleFundingOperationV2 {
  const { transitions, integrityHash: _old, ...body } = { ...op, ...patch };
  const entry = { sequence: transitions.length, at: new Date(now).toISOString(), reason, previousHash: op.transitions.at(-1)?.snapshotHash ?? null, snapshotHash: hashObject(body) };
  return sealCircleFundingOperation({ ...body, transitions: [...transitions, entry] });
}
/** Source effects are signed by the binding's source wallet and the mint by its gas wallet; the operation validator binds
 * both to the operation's own custody records. */
export function validateCircleFundingEnvelope(e: CircleEnvelope, role: CircleRole, chain: CircleDestinationChain, attestation: CircleAttestation | null, funding: CircleFundingBindingV2): void {
  if (!isPlainRecord(e) || !exactKeys(e, ["chainId", "from", "to", "data", "valueAtomic", "nonceAtomic", "gasLimitAtomic", "maxFeePerGasAtomic", "maxPriorityFeePerGasAtomic", "envelopeHash"])) circleCorrupt("envelope_shape");
  const { envelopeHash, ...body } = e, route = circleRoute(chain), destination = role === "mint";
  const data = destination ? attestation === null ? null : encodeCircleMint(attestation) : role === "burn" ? encodeCircleBurn(chain, funding) : encodeCircleApproval(role === "cleanup", funding);
  if (envelopeHash !== hashObject(body) || e.chainId !== (destination ? chain : 42161) || e.from !== (destination ? funding.gasPayer : funding.sourceOwner) ||
    e.to !== (destination ? CIRCLE_TRANSMITTER : role === "burn" ? CIRCLE_MESSENGER : CIRCLE_SOURCE_TOKEN) || e.data !== data || e.valueAtomic !== "0") circleCorrupt("envelope_binding");
  for (const field of [e.nonceAtomic, e.gasLimitAtomic, e.maxFeePerGasAtomic, e.maxPriorityFeePerGasAtomic]) if (!/^(?:0|[1-9][0-9]{0,77})$/u.test(field) || BigInt(field) >= 1n << 256n) circleCorrupt("envelope_quantity");
  if (BigInt(e.nonceAtomic) > BigInt(Number.MAX_SAFE_INTEGER) || BigInt(e.gasLimitAtomic) < 1n || BigInt(e.gasLimitAtomic) > (role === "approval" || role === "cleanup" ? 100_000n : 600_000n) ||
    BigInt(e.maxFeePerGasAtomic) === 0n || BigInt(e.maxPriorityFeePerGasAtomic) > BigInt(e.maxFeePerGasAtomic) ||
    BigInt(e.gasLimitAtomic) * BigInt(e.maxFeePerGasAtomic) > BigInt(destination ? route.destinationNativeCap : role === "cleanup" ? "15000000000000" : "30000000000000")) circleCorrupt("envelope_fee_cap");
}
export function validateCircleFundingOperation(value: unknown): CircleFundingOperationV2 {
  if (!isPlainRecord(value) || !exactKeys(value, ["schemaVersion", "funding", "feeQuote", "operationId", "profile", "profileHash", "destinationProfile", "destinationProfileHash", "idempotencyHash", "requestHash", "fingerprint", "destinationChain", "sourceCustody", "destinationCustody", "policies", "preparedAt", "expiresAt", "deploymentDigest", "feeQuoteAtomic", "state", "terminal", "effects", "source", "attestation", "destination", "residualAllowanceAtomic", "usage", "usageFinalized", "transitions", "integrityHash", ...(value.externalFulfillment === undefined ? [] : ["externalFulfillment"])])) circleCorrupt("shape");
  const op = value as unknown as CircleFundingOperationV2, { integrityHash, ...body } = op;
  if (op.schemaVersion !== "apn.circle-v2-evm-operation.v2" || hashObject(body) !== integrityHash || ![op.operationId, op.profileHash, op.destinationProfileHash, op.idempotencyHash, op.requestHash, op.fingerprint, op.deploymentDigest].every(x => typeof x === "string" && /^[a-f0-9]{64}$/u.test(x))) circleCorrupt("integrity");
  if (op.fingerprint !== circleFundingFingerprint(op)) circleCorrupt("funding_fingerprint");
  const funding = validateCircleFundingBinding(op.funding), route = circleRoute(op.destinationChain);
  assertCircleFundingFee(funding, op.feeQuote, Date.parse(op.preparedAt));
  if (funding.destinationChain !== op.destinationChain || op.feeQuoteAtomic !== op.feeQuote.quotedFeeAtomic || Date.parse(op.expiresAt) !== Date.parse(op.preparedAt) + 900_000) circleCorrupt("funding_intent_binding");
  validateEvmNativeCustody(op.sourceCustody); validateEvmNativeCustody(op.destinationCustody);
  // OWNR 5.2: the binding's identity is the operation's own profiles and custody wallets, never an owner constant.
  assertStoredFieldsEqual(funding, { sourceProfile: op.profile, sourceOwner: op.sourceCustody.walletAddress, destinationProfile: op.destinationProfile,
    gasPayer: op.destinationCustody.walletAddress }, () => circleCorrupt("funding_identity_binding"));
  if (op.profileHash !== sha256(`profile\0${op.profile}`) || op.destinationProfileHash !== sha256(`profile\0${op.destinationProfile}`) || op.profileHash !== op.sourceCustody.profileHash || op.destinationProfileHash !== op.destinationCustody.profileHash || !/^(?:0|[1-9][0-9]*)$/u.test(op.feeQuoteAtomic) || BigInt(op.feeQuoteAtomic) > BigInt(funding.maxFeeAtomic) ||
    !["awaiting_source", "source_unknown", "awaiting_mint", "mint_unknown", "awaiting_finality", "cleanup_required", "completed", "cleaned", "cancelled_unsubmitted", "external_fulfilled"].includes(op.state) || op.terminal !== ["completed", "cleaned", "cancelled_unsubmitted", "external_fulfilled"].includes(op.state) ||
    !Number.isFinite(Date.parse(op.preparedAt)) || !Number.isFinite(Date.parse(op.expiresAt)) || Date.parse(op.expiresAt) <= Date.parse(op.preparedAt) ||
    !["0", funding.amountAtomic].includes(op.residualAllowanceAtomic) || typeof op.usageFinalized !== "boolean" || !Array.isArray(op.usage) || !Array.isArray(op.policies)) circleCorrupt("intent");
  if (op.policies.length !== new Set([op.profileHash, op.destinationProfileHash]).size || new Set(op.policies.map(p => p.profileHash)).size !== op.policies.length) circleCorrupt("policy_count");
  for (const p of op.policies) if (!shape(p, ["profile", "profileHash", "policyDigest", "revision", ...(p.activationDigest === undefined ? [] : ["activationDigest"])]) || ![op.profile, op.destinationProfile].includes(p.profile) || ![op.profileHash, op.destinationProfileHash].includes(p.profileHash) || !/^[a-f0-9]{64}$/u.test(p.policyDigest) || !Number.isSafeInteger(p.revision) || p.revision < 1 || (p.activationDigest === undefined || !/^[a-f0-9]{64}$/u.test(p.activationDigest))) circleCorrupt("policy_binding");
  if (op.usage.length > 5 || op.state !== "cancelled_unsubmitted" && ![0, 5].includes(op.usage.length)) circleCorrupt("usage_count");
  for (const u of op.usage) validateAssetUsageReservation(u);
  const expectedUsage = [
    { account: funding.sourceOwner, chain: "eip155:42161", kind: "token", identifier: CIRCLE_SOURCE_TOKEN, amount: funding.amountAtomic },
    { account: funding.sourceOwner, chain: "eip155:42161", kind: "native", identifier: null, amount: "30000000000000" },
    { account: funding.sourceOwner, chain: "eip155:42161", kind: "native", identifier: null, amount: "30000000000000" },
    { account: funding.sourceOwner, chain: "eip155:42161", kind: "native", identifier: null, amount: "15000000000000" },
    { account: funding.gasPayer, chain: `eip155:${op.destinationChain}`, kind: "native", identifier: null, amount: route.destinationNativeCap }];
  for (const [i, u] of op.usage.entries()) {
    const expected = expectedUsage[i]!;
    if (u.account !== expected.account || u.chain !== expected.chain || u.asset.kind !== expected.kind || u.asset.identifier !== expected.identifier || u.amountAtomic !== expected.amount || u.rail !== "bridge" || !op.policies.some(p => p.policyDigest === u.policyDigest)) circleCorrupt("usage_binding");
  }
  if (op.usageFinalized && op.state !== "external_fulfilled" && (op.state === "cancelled_unsubmitted" ? op.usage.some(u => u.state !== "failed_before_effect") : op.usage.length !== 5 || op.usage.some(u => !["finalized", "failed_confirmed_revert"].includes(u.state)))) circleCorrupt("usage_finality");
  if (op.externalFulfillment !== undefined) {
    validateFundingExternalFulfillment(op.externalFulfillment, op);
    if (op.destination !== null || op.effects.some(e => ["mint", "cleanup"].includes(e.role) && (e.phase !== "prepared" || e.transactionHash !== null || e.materialHash !== null || e.proof !== null))) circleCorrupt("external_owned_effect");
  }
  if (op.state === "external_fulfilled" && (op.externalFulfillment === undefined || !op.usageFinalized || op.usage.length !== 5 || op.usage.some((u,i) => u.state !== (i < 3 ? "finalized" : "released_unsubmitted")))) circleCorrupt("external_terminal_binding");
  if (new Set(op.usage.map(u => u.reservationId)).size !== op.usage.length) circleCorrupt("duplicate_usage");
  if (!Array.isArray(op.effects) || op.effects.length < 2 || op.effects.length > 4 || op.effects[0]?.role !== "approval" || op.effects[1]?.role !== "burn" || new Set(op.effects.map(x => x.role)).size !== op.effects.length) circleCorrupt("effects");
  for (const inputEffect of op.effects) {
    const e = inputEffect as CircleEffect;
    if (!shape(e, ["role", "phase", "envelope", "transactionHash", "materialHash", "proof"]) || !["approval", "burn", "mint", "cleanup"].includes(e.role) || !["prepared", "signing_started", "sealed", "submission_started", "submitted", "unknown", "confirmed", "reverted", "abandoned_unsent"].includes(e.phase)) circleCorrupt("effect_shape");
    validateCircleFundingEnvelope(e.envelope, e.role, op.destinationChain, op.attestation, funding);
    if ((e.transactionHash !== null && !/^0x[a-f0-9]{64}$/u.test(e.transactionHash)) || (e.materialHash !== null && !/^[a-f0-9]{64}$/u.test(e.materialHash)) ||
      (["sealed", "submission_started", "submitted", "confirmed", "reverted"].includes(e.phase) && (e.materialHash === null || e.transactionHash === null)) ||
      (["confirmed", "reverted"].includes(e.phase) && (e.proof === null || e.proof.transactionHash !== e.transactionHash)) ||
      // Never crossed its submission fence and can never be sent: no bytes were saved, or they were discarded after a never-lands proof.
      (e.phase === "abandoned_unsent" && (e.proof !== null || (e.transactionHash === null) !== (e.materialHash === null)))) circleCorrupt("effect_material");
    if (e.phase === "reverted" && (e.proof?.finalityTag !== "finalized" || e.role === "mint")) circleCorrupt("revert_finality");
  }
  if (BigInt(op.effects[1]!.envelope.nonceAtomic) !== BigInt(op.effects[0]!.envelope.nonceAtomic) + 1n) circleCorrupt("source_nonce_order");
  if (op.source !== null) { assertCircleSource(op.source, funding); if (op.source.destinationChain !== op.destinationChain || op.source.transactionHash !== op.effects[1]!.transactionHash) circleCorrupt("source_binding"); }
  if (op.attestation !== null) { if (op.source === null) circleCorrupt("attestation_without_source"); assertCircleAttestation(op.source, op.attestation, funding); }
  if (op.destination !== null && (op.attestation === null || op.destination.nonce !== op.attestation.nonce || op.destination.attestedMessageHash !== op.attestation.hash || op.destination.transactionHash !== op.effects.find(e => e.role === "mint")?.transactionHash)) circleCorrupt("destination_binding");
  if (op.destination !== null && (op.destination.recipient !== funding.recipient || op.destination.token !== funding.destinationToken || op.destination.amountAtomic !== op.attestation?.receivedAtomic)) circleCorrupt("funding_destination_economics");
  if (op.state === "completed" && (op.source?.finalityTag !== "finalized" || op.destination?.finalityTag !== "safe" || op.residualAllowanceAtomic !== "0" || !op.usageFinalized)) circleCorrupt("completion_finality");
  if (op.state === "cancelled_unsubmitted" && (op.source !== null || op.attestation !== null || op.destination !== null || op.residualAllowanceAtomic !== "0" || !op.usageFinalized || op.effects.some(e => e.phase !== "abandoned_unsent" && (e.phase !== "prepared" || e.transactionHash !== null || e.materialHash !== null || e.proof !== null)))) circleCorrupt("cancel_private_entry");
  if (op.state === "cleaned" && (op.residualAllowanceAtomic !== "0" || op.source !== null || !op.usageFinalized)) circleCorrupt("cleanup_completion");
  if (!Array.isArray(op.transitions) || op.transitions.length < 1 || op.transitions.length > 500) circleCorrupt("transitions");
  for (const [i, t] of op.transitions.entries()) if (!shape(t, ["sequence", "at", "reason", "previousHash", "snapshotHash"]) || t.sequence !== i || t.previousHash !== (i === 0 ? null : op.transitions[i - 1]!.snapshotHash) || !/^[a-f0-9]{64}$/u.test(t.snapshotHash) || !Number.isFinite(Date.parse(t.at)) || i > 0 && t.at < op.transitions[i - 1]!.at) circleCorrupt("transition_chain");
  const { integrityHash: _hash, transitions: _transitions, ...snapshot } = op;
  if (op.transitions.at(-1)!.snapshotHash !== hashObject(snapshot)) circleCorrupt("snapshot_binding");
  return op;
}
export function publicCircleFundingOperation(op: CircleFundingOperationV2) { return { operation_id: op.operationId, kind: "circle_route", state: op.state, terminal: op.terminal,
  source_profile: op.profile, destination_profile: op.destinationProfile, destination_chain: op.destinationChain,
  amount_atomic: op.funding.amountAtomic, minimum_output_atomic: op.funding.minMintAtomic, maximum_issuer_fee_atomic: op.funding.maxFeeAtomic, recipient: op.funding.recipient,
  effects: op.effects.map(e => ({ role: e.role, phase: e.phase, transaction_hash: e.transactionHash, actual_fee_atomic: e.proof?.actualFeeAtomic ?? null })),
  source_finality: op.source?.finalityTag ?? null, destination_finality: op.destination?.finalityTag ?? op.externalFulfillment?.destinationReceipt.finalityTag ?? null,
  residual_allowance_atomic: op.residualAllowanceAtomic, usage_finalized: op.usageFinalized, integrity_hash: op.integrityHash,
  ...(op.externalFulfillment === undefined ? {} : { external_fulfillment: op.externalFulfillment, proof_class: "circle_funding_external_mint_fulfillment", controlled_destination_native_atomic: "0", external_destination_fee_payer: op.externalFulfillment.caller }),
  next_actions: op.terminal ? [] : [`apn circle evm observe --operation ${op.operationId}`] }; }
function shape(value: unknown, keys: readonly string[]): boolean { return isPlainRecord(value) && exactKeys(value, keys); }

/** Closed internal dispatcher; historical validators remain v1-only. */
export type CircleKnownOperation = CircleOperationV1 | CircleFundingOperationV2;
export function validateKnownCircle(value: unknown): CircleKnownOperation {
  if (!isPlainRecord(value)) circleCorrupt("shape");
  if (value.schemaVersion === "apn.circle-v2-evm-operation.v1") return validateCircle(value);
  if (value.schemaVersion === "apn.circle-v2-evm-operation.v2") return validateCircleFundingOperation(value);
  return circleCorrupt("unsupported_operation_schema");
}
export function publicKnownCircle(op: CircleKnownOperation) {
  return op.schemaVersion === "apn.circle-v2-evm-operation.v1" ? publicCircle(op) : publicCircleFundingOperation(op);
}
