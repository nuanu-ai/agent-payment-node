import type { Hex } from "viem";
import { canonicalJson, hashObject } from "../canonical.js";
import type { StateStore } from "../state.js";
import { CircleRepository } from "./repository.js";
import { CircleEffectStore } from "./custody.js";
import { CIRCLE_DEPLOYMENT_PINS, CIRCLE_SOURCE_OWNER, CIRCLE_SOURCE_TOKEN, CIRCLE_MESSENGER, CIRCLE_MINTER, CIRCLE_TRANSMITTER, circleRoute } from "./catalog.js";
import { circleBlocked, validateCircle, type CircleOperationV1, type CircleEffect } from "./operation-model.js";
import { circleHex, circleRecord, circleUint, circleWord, decodeCircleSource, verifyCircleApproval, type CircleObservation, type CircleReceiptProof } from "./protocol.js";
import { verifyCleanup85PublicWire, cleanup85Reanchor } from "./cleanup85-public-proof.js";
import { readCircleDeployment, type CircleRpc } from "./rpc.js";
import type { CircleDeploymentSnapshot } from "./preflight.js";
/** This module verifies public source history only. It cannot authorize any effect or ledger write. */
export const HISTORICAL_LINEA_OPERATION = "23f54a86f0ec0cfaf0a69f419c9a0c9fd19420fc9f2195bfe6c00192ab7b44c6";
export const HISTORICAL_MONAD_OPERATION = "df077b005a9723de748d425d9172c4fb1cf5c6e4b2cc5bdd18327f770cd1ad46";
const pins = {
  [HISTORICAL_LINEA_OPERATION]: { chain: 59144, destination: "evm-live-buyer", approval: "0x6d54f1726719935803bdbc4282b66661f18fafecd2d5e811a64c03ca35401c87", burn: "0xbe0d229c23bf4038f939bbbdfb34ef59a2f025b9ee6650597688d20099461779", nonce: "79" },
  [HISTORICAL_MONAD_OPERATION]: { chain: 143, destination: "default", approval: "0x500836d2b7f3b772c700fc3fce3b2e598a1b748b5e057418d86cca7146d518db", burn: "0x276f5a55dd7589b602f5957838b84d2d839846c72f94eacb5daa6135dea6de3f", nonce: "82" },
} as const;
export interface HistoricalPaidSourceEvidence {
  readonly version: "apn.circle-historical-paid-source.v1";
  readonly operationDigest: string;
  readonly approvalProof: CircleReceiptProof;
  readonly sourceProof: ReturnType<typeof decodeCircleSource>;
  readonly cleanupProof: CircleReceiptProof | null;
  readonly acceptanceBlock: { readonly hash: string; readonly numberAtomic: string; readonly timestampAtomic: string };
  readonly allowanceAtomic: "0";
  readonly historicalNonceAtomic: string;
  readonly nonceFloorAtomic: string;
  readonly finalityBlock: { readonly hash: string; readonly numberAtomic: string; readonly timestampAtomic: string };
  readonly deployment: CircleDeploymentSnapshot;
  readonly materialHeaderDigest: string;
  readonly evidenceHash: string;
}
export interface VerifiedHistoricalPaidSource { readonly kind: "verified-historical-paid-source"; }
const verified = new WeakMap<VerifiedHistoricalPaidSource, { readonly root: string; readonly state: StateStore; readonly operation: CircleOperationV1; readonly evidence: HistoricalPaidSourceEvidence }>();
function frozen<T>(value: T): T { const copy = structuredClone(value); const freeze = (v: unknown): void => { if (v !== null && typeof v === "object") { Object.values(v).forEach(freeze); Object.freeze(v); } }; freeze(copy); return copy; }
async function durable(state: StateStore, op: CircleOperationV1): Promise<void> {
  const saved = await new CircleRepository(state.root).load(op.operationId);
  if (saved === null || canonicalJson(saved) !== canonicalJson(op)) circleBlocked("historical_paid_durable_operation_changed");
}
function admitted(op: CircleOperationV1): void {
  validateCircle(op); const pin = pins[op.operationId as keyof typeof pins];
  if (pin === undefined || op.profile !== "evm-live-buyer" || op.destinationChain !== pin.chain || op.destinationProfile !== pin.destination || op.source === null || op.attestation === null || op.nonceRetirement !== undefined || op.usage.length !== 5 || op.effects[0]!.phase !== "confirmed" || op.effects[1]!.phase !== "confirmed" || op.effects[0]!.transactionHash !== pin.approval || op.effects[1]!.transactionHash !== pin.burn || op.effects[1]!.envelope.nonceAtomic !== pin.nonce || op.sourceCustody.walletAddress !== CIRCLE_SOURCE_OWNER) circleBlocked("historical_paid_exact_source_required");
  for (const effect of op.effects.filter(e => e.role !== "mint")) {
    if (effect.phase !== "confirmed" || effect.materialHash === null || effect.proof === null || effect.role === "cleanup" && (effect.proof.finalityTag !== "finalized" || BigInt(effect.envelope.nonceAtomic) <= BigInt(pin.nonce))) circleBlocked("historical_paid_owned_cleanup_required");
    for (const suffix of ["signing_fence", "material_sealed", "submission_fence"]) if (!op.transitions.some(t => t.reason === `${effect.role}_${suffix}`)) circleBlocked("historical_paid_effect_fence_required");
  }
}
function stableProof(saved: CircleReceiptProof | null, fresh: CircleReceiptProof): void {
  if (saved === null || ["transactionHash", "blockHash", "blockNumberAtomic", "receiptHash", "logsHash", "actualFeeAtomic"].some(k => saved[k as keyof CircleReceiptProof] !== fresh[k as keyof CircleReceiptProof])) circleBlocked("historical_paid_original_receipt_changed");
}
async function material(source: CircleRpc, op: CircleOperationV1, effect: CircleEffect, observation: CircleObservation): Promise<CircleObservation> {
  if (effect.transactionHash === null) circleBlocked("historical_paid_material_missing");
  // Parse archive signature quantities only for wire reconstruction; raw RPC metadata stays intact.
  const raw = circleRecord(observation.transaction), order = 0xfffffffffffffffffffffffffffffffebaaedce6af48a03bbfd25e8cd0364141n;
  const scalar = (value: unknown, low: boolean): Hex => { if (typeof value !== "string" || !/^0x[a-fA-F0-9]{1,64}$/u.test(value)) circleBlocked("historical_paid_signature_scalar"); const n = BigInt(value); if (n <= 0n || n >= order || low && n > order / 2n) circleBlocked("historical_paid_signature_scalar"); return `0x${n.toString(16).padStart(64, "0")}`; };
  const wireObservation = { ...observation, transaction: { ...raw, r: scalar(raw.r, false), s: scalar(raw.s, true) } };
  const rawTransaction = await verifyCleanup85PublicWire(wireObservation, effect.envelope, effect.transactionHash);
  if (hashObject({ schemaVersion: "apn.circle-v2-evm-effect.v1", operationId: op.operationId, role: effect.role, fingerprint: op.fingerprint, envelopeHash: effect.envelope.envelopeHash, rawTransaction, transactionHash: effect.transactionHash }) !== effect.materialHash) circleBlocked("historical_paid_original_material_changed");
  // Exact old operations only: some archive transports omit this non-signed metadata field.
  // All transaction/receipt/header/index/membership/signature checks and numbered reanchors
  // precede reconstruction. Present malformed values are never treated as omission.
  await cleanup85Reanchor(source, observation);
  const transaction = circleRecord(observation.transaction), block = circleRecord(observation.canonicalBlock);
  if (Object.hasOwn(transaction, "blockTimestamp") && (typeof transaction.blockTimestamp !== "string" || circleUint(transaction.blockTimestamp) !== circleUint(block.timestamp))) circleBlocked("historical_paid_transaction_timestamp_changed");
  const normalized = Object.hasOwn(transaction, "blockTimestamp") ? observation : { ...observation, transaction: { ...transaction, blockTimestamp: block.timestamp } };
  if (effect.proof === null || hashObject(normalized.transaction) !== effect.proof.transactionHashBinding) circleBlocked("historical_paid_full_transaction_binding_changed");
  return normalized;
}
function deploymentPins(snapshot: CircleDeploymentSnapshot, op: CircleOperationV1): void {
  const route = circleRoute(op.destinationChain), expected = CIRCLE_DEPLOYMENT_PINS[42161];
  if (snapshot.chainId !== 42161 || snapshot.domain !== 3 || snapshot.remoteDomain !== route.domain || snapshot.remoteMessenger !== circleWord(CIRCLE_MESSENGER) || snapshot.pairedToken !== CIRCLE_SOURCE_TOKEN || snapshot.localMinter !== CIRCLE_MINTER || snapshot.localMessageTransmitter !== CIRCLE_TRANSMITTER || snapshot.localTokenMessenger !== CIRCLE_MESSENGER || snapshot.messageVersion !== 1 || snapshot.messageBodyVersion !== 1 || snapshot.tokenDecimals !== 6 || snapshot.transmitterPaused || snapshot.minterPaused || snapshot.tokenPaused) circleBlocked("historical_paid_deployment_configuration");
  for (const key of ["messenger", "transmitter", "minter", "token"] as const) { const actual = snapshot.contracts[key], pin = expected[key]; if (actual.address.toLowerCase() !== pin.address.toLowerCase() || actual.implementation.toLowerCase() !== pin.implementation.toLowerCase() || actual.proxyCodeHash !== pin.proxyCodeHash || actual.implementationCodeHash !== pin.implementationCodeHash) circleBlocked("historical_paid_deployment_code_pin"); }
}
function blockIdentity(value: unknown) { const b = circleRecord(value), hash = circleHex(b.hash, 32), numberAtomic = circleUint(b.number).toString(), timestampAtomic = circleUint(b.timestamp).toString(); if (hash === "0x" + "0".repeat(64) || BigInt(numberAtomic) === 0n || BigInt(timestampAtomic) === 0n) circleBlocked("historical_paid_block_identity"); return { hash, numberAtomic, timestampAtomic }; }
/** Re-reads the durable actual parent before RPC and after the complete anchored observation.
 * Financial expiry/current policy pointers are deliberately irrelevant to this public-only proof. */
export async function verifyHistoricalPaidSource(state: StateStore, input: CircleOperationV1, source: CircleRpc): Promise<VerifiedHistoricalPaidSource> {
  const op = frozen(input); await durable(state, op); admitted(op); if (source.chainId !== 42161) circleBlocked("historical_paid_source_chain"); await source.identity();
  const headers = await new CircleEffectStore(state.root, { load: async () => { circleBlocked("historical_paid_private_forbidden"); }, create: async () => { circleBlocked("historical_paid_private_forbidden"); } }).historicalPaidHeaders(op);
  let approval = await source.observation(op.effects[0]!.transactionHash!, "finalized"), burn = await source.observation(op.effects[1]!.transactionHash!, "finalized");
  if (approval === null || burn === null) circleBlocked("historical_paid_source_not_finalized");
  approval = await material(source, op, op.effects[0]!, approval); burn = await material(source, op, op.effects[1]!, burn);
  const approvalBlock = circleRecord(approval.canonicalBlock), approvalTag = { blockHash: circleHex(approvalBlock.hash, 32), requireCanonical: true as const };
  const approvalProof = verifyCircleApproval(approval, false, String(await source.read(CIRCLE_SOURCE_TOKEN, "allowance", [CIRCLE_SOURCE_OWNER, CIRCLE_MESSENGER], approvalTag))), sourceProof = decodeCircleSource(burn, op.destinationChain);
  stableProof(op.effects[0]!.proof, approvalProof); stableProof(op.effects[1]!.proof, sourceProof); stableProof(op.source, sourceProof);
  if (op.source!.sourceMessageHash !== sourceProof.sourceMessageHash) circleBlocked("historical_paid_source_message_changed");
  let acceptance = burn, cleanupProof: CircleReceiptProof | null = null; const cleanup = op.effects.find(e => e.role === "cleanup");
  if (cleanup !== undefined) { let observed = await source.observation(cleanup.transactionHash!, "finalized"); if (observed === null) circleBlocked("historical_paid_owned_cleanup_not_finalized"); observed = await material(source, op, cleanup, observed); acceptance = observed; const tag = { blockHash: circleHex(circleRecord(observed.canonicalBlock).hash, 32), requireCanonical: true as const }; cleanupProof = verifyCircleApproval(observed, true, String(await source.read(CIRCLE_SOURCE_TOKEN, "allowance", [CIRCLE_SOURCE_OWNER, CIRCLE_MESSENGER], tag))); stableProof(cleanup.proof, cleanupProof); if (BigInt(cleanupProof.actualFeeAtomic) > 15000000000000n) circleBlocked("historical_paid_cleanup_fee_cap"); }
  const acceptanceBlock = blockIdentity(acceptance.canonicalBlock), current = await source.block("finalized"), finalityBlock = blockIdentity(current), floor = BigInt((cleanup ?? op.effects[1]!).envelope.nonceAtomic) + 1n;
  if (BigInt(finalityBlock.numberAtomic) < BigInt(acceptanceBlock.numberAtomic) || BigInt(finalityBlock.timestampAtomic) < BigInt(acceptanceBlock.timestampAtomic) || [approval, burn, acceptance].some(x => BigInt(finalityBlock.numberAtomic) < circleUint(circleRecord(x.finalityHead).number))) circleBlocked("historical_paid_finality_regressed");
  const tag = { blockHash: acceptanceBlock.hash, requireCanonical: true as const }, currentTag = { blockHash: finalityBlock.hash, requireCanonical: true as const };
  const [allowance, historicalNonce, latest, pending, finalized] = await Promise.all([source.read(CIRCLE_SOURCE_TOKEN, "allowance", [CIRCLE_SOURCE_OWNER, CIRCLE_MESSENGER], tag), source.call("eth_getTransactionCount", [CIRCLE_SOURCE_OWNER, tag]), source.call("eth_getTransactionCount", [CIRCLE_SOURCE_OWNER, "latest"]), source.call("eth_getTransactionCount", [CIRCLE_SOURCE_OWNER, "pending"]), source.call("eth_getTransactionCount", [CIRCLE_SOURCE_OWNER, currentTag])]);
  if (String(allowance) !== "0" || [historicalNonce, latest, pending, finalized].some(x => circleUint(x) < floor)) circleBlocked("historical_paid_allowance_or_nonce_floor");
  const deployment = await readCircleDeployment(source, op.destinationChain, circleRecord(acceptance.canonicalBlock)); deploymentPins(deployment, op);
  for (const observation of [approval, burn, ...(cleanup === undefined ? [] : [acceptance])]) await cleanup85Reanchor(source, observation);
  const rechecked = blockIdentity(await source.block(String(current.number))); if (canonicalJson(rechecked) !== canonicalJson(finalityBlock)) circleBlocked("historical_paid_current_finality_reorg"); await durable(state, op);
  const body = { version: "apn.circle-historical-paid-source.v1" as const, operationDigest: hashObject(op), approvalProof, sourceProof, cleanupProof, acceptanceBlock, allowanceAtomic: "0" as const, historicalNonceAtomic: circleUint(historicalNonce).toString(), nonceFloorAtomic: floor.toString(), finalityBlock, deployment, materialHeaderDigest: hashObject(headers) }, evidence = frozen({ ...body, evidenceHash: hashObject(body) });
  const token = Object.freeze({ kind: "verified-historical-paid-source" as const }); verified.set(token, { root: state.root, state, operation: op, evidence }); return token;
}
/** Detached verified public metadata, not a caller flag or ledger capability. */
export async function historicalPaidSourceBody(token: VerifiedHistoricalPaidSource, state: StateStore, op: CircleOperationV1): Promise<{ readonly operation: CircleOperationV1; readonly evidence: HistoricalPaidSourceEvidence }> {
  const body = verified.get(token); if (body === undefined || body.state !== state || body.root !== state.root || hashObject(op) !== body.evidence.operationDigest) circleBlocked("historical_paid_private_source_required"); await durable(state, body.operation); return Object.freeze({ operation: body.operation, evidence: body.evidence });
}
