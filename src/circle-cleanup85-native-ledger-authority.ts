import { canonicalJson, hashObject } from "./canonical.js";
import { activeAssetPolicyFromState, type ActiveAssetPolicy } from "./allowlist-active-policy.js";
import { AllowlistPolicyStore } from "./allowlist-policy-store.js";
import { evaluateAssetPolicy } from "./asset-policy-registry.js";
import { DirectPublicEffectJournal } from "./direct-public-effect.js";
import { cleanup85OperationEnvelope } from "./circle-cleanup85-native-binding.js";
import { CLEANUP85_OWNER, cleanup85Blocked, verifyCleanup85Observation } from "./circle-cleanup85-native-codec.js";
import type { Cleanup85NativeRpc } from "./circle-cleanup85-native-rpc.js";
import { verifyCleanup85RecoveryAdmission, verifiedCleanup85RecoveryAdmission } from "./circle-v2-evm/cleanup85-recovery-admission.js";
import { assertCleanup85Window } from "./circle-v2-evm/cleanup85-recovery-store.js";
import type { CircleRpc } from "./circle-v2-evm/rpc.js";
import type { OperationRecord } from "./model.js";
import type { StateStore } from "./state.js";

export interface VerifiedCleanup85NativeReservation { readonly kind: "verified-cleanup85-native-reservation"; }
export interface VerifiedCleanup85NativeSettlement { readonly kind: "verified-cleanup85-native-settlement"; }
export interface Cleanup85NativeReservationBody {
  readonly operation: OperationRecord; readonly policy: ActiveAssetPolicy;
  readonly reservationId: string; readonly idempotencyKey: string;
  readonly reservedAtomic: "2000000000000"; readonly signedMaximumDebitAtomic: string;
}
export interface Cleanup85NativeActualSettlement {
  readonly kind: "circle_cleanup85_native_actual"; readonly operationId: string; readonly fingerprint: string;
  readonly requestBinding: string; readonly transactionHash: string; readonly receiptHash: string;
  readonly blockHash: string; readonly blockNumberAtomic: string; readonly actualFeeAtomic: string;
  readonly nativeConsumedAtomic: string; readonly reservedAtomic: "2000000000000";
  readonly nativeReservationId: string; readonly policyDigest: string; readonly outcomeDigest: string;
}
const reservations = new WeakMap<VerifiedCleanup85NativeReservation, { root: string; body: Cleanup85NativeReservationBody }>();
const settlements = new WeakMap<VerifiedCleanup85NativeSettlement, { root: string; operation: OperationRecord; settlement: Cleanup85NativeActualSettlement }>();
export function verifiedCleanup85NativeReservation(token: VerifiedCleanup85NativeReservation, exactRoot: string): Cleanup85NativeReservationBody {
  const value = reservations.get(token); if (value === undefined || value.root !== exactRoot) cleanup85Blocked("root_owned_reservation_required");
  return structuredClone(value.body);
}
export function verifiedCleanup85NativeSettlement(token: VerifiedCleanup85NativeSettlement, exactRoot: string): { operation: OperationRecord; settlement: Cleanup85NativeActualSettlement } {
  const value = settlements.get(token); if (value === undefined || value.root !== exactRoot) cleanup85Blocked("root_owned_settlement_required");
  return structuredClone({ operation: value.operation, settlement: value.settlement });
}
/** Under canonical wallet/address/operation outer locks and TRUE allowlist profile inner lock.
 * Fresh full public A admission and the saved unsigned native operation precede reservation. */
export async function verifyCleanup85NativeReservation(state: StateStore, id: string, source: CircleRpc, destination: CircleRpc, native: Cleanup85NativeRpc, now: () => Date): Promise<VerifiedCleanup85NativeReservation> {
  const o = await state.findOperation(id);
  if (o === null || o.state !== "awaiting_approval" || o.terminal || now().toISOString() >= o.expiresAt || o.allowlist === undefined) cleanup85Blocked("reservation_unsigned_operation");
  const e = cleanup85OperationEnvelope(o), b = o.evm!.cleanup85Cancellation!;
  await new DirectPublicEffectJournal(state).assertUnstarted(o);
  const admission = await verifyCleanup85RecoveryAdmission(state, source, destination, b.request), checked = verifiedCleanup85RecoveryAdmission(admission, b.request);
  assertCleanup85Window(checked.intent, now().getTime());
  if (hashObject(checked.intent.recipientCustody) !== hashObject(b.recipientCustody) || hashObject(checked.parent.sourceCustody) !== hashObject(o.evm!.nativeCustody)) cleanup85Blocked("reservation_custody");
  await native.snapshot(e);
  const at = now(), p = activeAssetPolicyFromState(await new AllowlistPolicyStore(state.root).readUnderProfileLock(o.profile), at);
  if (p === null || p.accounts.evm !== CLEANUP85_OWNER || p.digest !== o.allowlist.policyDigest || p.revision !== o.allowlist.policyRevision || p.activationDigest !== b.activationDigest || at.toISOString() >= o.expiresAt) cleanup85Blocked("reservation_policy");
  evaluateAssetPolicy(p.registry, { chain: "eip155:42161", asset: { kind: "native", identifier: null }, rail: "direct", amountAtomic: b.nativeReserveAtomic, dailyUsageAtomic: "0", asOfDate: at.toISOString().slice(0,10), asOf: at.toISOString() });
  if ((await state.findOperation(id))?.integrityHash !== o.integrityHash) cleanup85Blocked("reservation_operation_changed");
  const body: Cleanup85NativeReservationBody = { operation: o, policy: p, reservationId: b.nativeReservationId, idempotencyKey: `apn.cleanup85-native:${id}`, reservedAtomic: b.nativeReserveAtomic, signedMaximumDebitAtomic: (BigInt(e.gasLimitAtomic) * BigInt(e.maxFeePerGasAtomic) + 1n).toString() };
  const token = Object.freeze({ kind: "verified-cleanup85-native-reservation" as const }); reservations.set(token, structuredClone({ root: state.root, body })); return token;
}
/** Only a freshly independently verified FINALIZED receipt for this root's durable operation mints settlement.
 * Moving finalized anchors never enter the stable accounting digest. */
export async function verifyCleanup85NativeSettlement(state: StateStore, id: string, native: Cleanup85NativeRpc): Promise<VerifiedCleanup85NativeSettlement> {
  const o = await state.findOperation(id);
  if (o === null || o.state !== "completed" || !o.terminal || o.transactionHash === undefined || o.rawTransactionHash !== o.transactionHash || o.allowlist === undefined) cleanup85Blocked("settlement_terminal_operation");
  const e = cleanup85OperationEnvelope(o), b = o.evm!.cleanup85Cancellation!;
  const effect = await new DirectPublicEffectJournal(state).effect(o);
  if (effect.transactionHash !== o.transactionHash) cleanup85Blocked("settlement_signed_claim");
  const observation = await native.observation(effect.transactionHash); if (observation === null) cleanup85Blocked("settlement_finality");
  const receipt = await verifyCleanup85Observation(e, effect.transactionHash, observation); await native.finalizedAccount(observation);
  if ((await state.findOperation(id))?.integrityHash !== o.integrityHash) cleanup85Blocked("settlement_operation_changed");
  const body = { kind: "circle_cleanup85_native_actual" as const, operationId: id, fingerprint: o.fingerprint, requestBinding: hashObject(b.request), ...receipt, reservedAtomic: b.nativeReserveAtomic, nativeReservationId: b.nativeReservationId, policyDigest: o.allowlist.policyDigest };
  const settlement = { ...body, outcomeDigest: hashObject(body) };
  const token = Object.freeze({ kind: "verified-cleanup85-native-settlement" as const }); settlements.set(token, structuredClone({ root: state.root, operation: o, settlement })); return token;
}
/** C must reread the durable owning operation while holding the bucket lock, before any mutation. */
export function sameCleanup85LedgerOperation(expected: OperationRecord, actual: OperationRecord | null): boolean {
  return actual !== null && canonicalJson(actual) === canonicalJson(expected);
}
