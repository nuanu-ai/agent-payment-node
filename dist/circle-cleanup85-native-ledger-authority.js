import { canonicalJson, hashObject, exactKeys, isPlainRecord } from "./canonical.js";
import { activeAssetPolicyFromState } from "./allowlist-active-policy.js";
import { AllowlistPolicyStore } from "./allowlist-policy-store.js";
import { evaluateAssetPolicy } from "./asset-policy-registry.js";
import { Cleanup85NativePublicRecords } from "./circle-cleanup85-native-records.js";
import { DirectPublicEffectJournal } from "./direct-public-effect.js";
import { cleanup85OperationEnvelope } from "./circle-cleanup85-native-binding.js";
import { CLEANUP85_OWNER, cleanup85Blocked, verifyCleanup85Observation } from "./circle-cleanup85-native-codec.js";
import { verifyCleanup85RecoveryAdmission, verifiedCleanup85RecoveryAdmission } from "./circle-v2-evm/cleanup85-recovery-admission.js";
import { assertCleanup85Window } from "./circle-v2-evm/cleanup85-recovery-store.js";
const reservations = new WeakMap();
const settlements = new WeakMap();
export function verifiedCleanup85NativeReservation(token, exactRoot) {
    const value = reservations.get(token);
    if (value === undefined || value.root !== exactRoot)
        cleanup85Blocked("root_owned_reservation_required");
    return structuredClone(value.body);
}
export function verifiedCleanup85NativeSettlement(token, exactRoot) {
    const value = settlements.get(token);
    if (value === undefined || value.root !== exactRoot)
        cleanup85Blocked("root_owned_settlement_required");
    return structuredClone({ operation: value.operation, settlement: value.settlement });
}
/** Under canonical wallet/address/operation outer locks and TRUE allowlist profile inner lock.
 * Fresh full public A admission and the saved unsigned native operation precede reservation. */
export async function verifyCleanup85NativeReservation(state, id, source, destination, native, now) {
    const o = await state.findOperation(id);
    if (o === null || o.state !== "awaiting_approval" || o.terminal || now().toISOString() >= o.expiresAt || o.allowlist === undefined)
        cleanup85Blocked("reservation_unsigned_operation");
    const e = cleanup85OperationEnvelope(o), b = o.evm.cleanup85Cancellation;
    await assertCleanup85NativeSlot(state, o);
    await new DirectPublicEffectJournal(state).assertUnstarted(o);
    const admission = await verifyCleanup85RecoveryAdmission(state, source, destination, b.request), checked = verifiedCleanup85RecoveryAdmission(admission, b.request);
    assertCleanup85Window(checked.intent, now().getTime());
    if (checked.intent.windowEndsAt !== null && o.expiresAt > checked.intent.windowEndsAt)
        cleanup85Blocked("reservation_frozen_recovery_window");
    if (hashObject(checked.intent.recipientCustody) !== hashObject(b.recipientCustody) || hashObject(checked.parent.sourceCustody) !== hashObject(o.evm.nativeCustody))
        cleanup85Blocked("reservation_custody");
    const snapshot = await native.snapshot(e), anchor = await source.block(`0x${BigInt(snapshot.blockNumberAtomic).toString(16)}`);
    if (anchor.hash !== snapshot.blockHash)
        cleanup85Blocked("reservation_archive_native_anchor_agreement");
    await source.identity();
    const at = now(), p = activeAssetPolicyFromState(await new AllowlistPolicyStore(state.root).readUnderProfileLock(o.profile), at);
    if (p === null || p.accounts.evm !== CLEANUP85_OWNER || p.digest !== o.allowlist.policyDigest || p.revision !== o.allowlist.policyRevision || p.activationDigest !== b.activationDigest || at.toISOString() >= o.expiresAt)
        cleanup85Blocked("reservation_policy");
    if (p.registry.expiresAt !== undefined && o.expiresAt > p.registry.expiresAt)
        cleanup85Blocked("reservation_frozen_native_policy_window");
    evaluateAssetPolicy(p.registry, { chain: "eip155:42161", asset: { kind: "native", identifier: null }, rail: "direct", amountAtomic: b.nativeReserveAtomic, dailyUsageAtomic: "0", asOfDate: at.toISOString().slice(0, 10), asOf: at.toISOString() });
    if ((await state.findOperation(id))?.integrityHash !== o.integrityHash)
        cleanup85Blocked("reservation_operation_changed");
    const body = { operation: o, policy: p, reservationId: b.nativeReservationId, idempotencyKey: `apn.cleanup85-native:${id}`, reservedAtomic: b.nativeReserveAtomic, signedMaximumDebitAtomic: (BigInt(e.gasLimitAtomic) * BigInt(e.maxFeePerGasAtomic) + 1n).toString() };
    const token = Object.freeze({ kind: "verified-cleanup85-native-reservation" });
    reservations.set(token, structuredClone({ root: state.root, body }));
    return token;
}
/** Only a freshly independently verified FINALIZED receipt for this root's durable operation mints settlement.
 * Moving finalized anchors never enter the stable accounting digest. */
export async function verifyCleanup85NativeSettlement(state, id, native) {
    const o = await state.findOperation(id);
    if (o === null || o.state !== "completed" || !o.terminal || o.transactionHash === undefined || o.rawTransactionHash !== o.transactionHash || o.allowlist === undefined)
        cleanup85Blocked("settlement_terminal_operation");
    const e = cleanup85OperationEnvelope(o), b = o.evm.cleanup85Cancellation;
    await assertCleanup85NativeSlot(state, o);
    const records = new Cleanup85NativePublicRecords(state.root), frozen = await records.load(id, "canonical");
    const effect = await new DirectPublicEffectJournal(state).effect(o);
    if (effect.transactionHash !== o.transactionHash)
        cleanup85Blocked("settlement_signed_claim");
    const observation = await native.observation(effect.transactionHash);
    if (observation === null)
        cleanup85Blocked("settlement_finality");
    const receipt = await verifyCleanup85Observation(e, effect.transactionHash, observation);
    if (frozen === null)
        await native.finalizedAccount(observation);
    else
        await native.finalizedConsumedAccount(observation);
    if ((await state.findOperation(id))?.integrityHash !== o.integrityHash)
        cleanup85Blocked("settlement_operation_changed");
    const body = { kind: "circle_cleanup85_native_actual", operationId: id, fingerprint: o.fingerprint, requestBinding: hashObject(b.request), ...receipt, reservedAtomic: b.nativeReserveAtomic, nativeReservationId: b.nativeReservationId, policyDigest: o.allowlist.policyDigest };
    const settlement = { ...body, outcomeDigest: hashObject(body) };
    if (frozen === null)
        await records.publish(id, "canonical", { version: "apn.cleanup85-native-canonical.v1", operationId: id, fingerprint: o.fingerprint, observation, settlement });
    else {
        if (!isPlainRecord(frozen) || !exactKeys(frozen, ["version", "operationId", "fingerprint", "observation", "settlement"]) || frozen.version !== "apn.cleanup85-native-canonical.v1" || frozen.operationId !== id || frozen.fingerprint !== o.fingerprint || canonicalJson(frozen.settlement) !== canonicalJson(settlement))
            cleanup85Blocked("frozen_canonical_accounting");
        const original = await verifyCleanup85Observation(e, effect.transactionHash, frozen.observation);
        if (canonicalJson(original) !== canonicalJson(receipt))
            cleanup85Blocked("frozen_canonical_effect");
    }
    const token = Object.freeze({ kind: "verified-cleanup85-native-settlement" });
    settlements.set(token, structuredClone({ root: state.root, operation: o, settlement }));
    return token;
}
/** C must reread the durable owning operation while holding the bucket lock, before any mutation. */
export function sameCleanup85LedgerOperation(expected, actual) {
    return actual !== null && canonicalJson(actual) === canonicalJson(expected);
}
export async function assertCleanup85NativeSlot(state, o) {
    const r = o.evm?.cleanup85Cancellation?.request;
    if (r === undefined)
        cleanup85Blocked("cancellation_slot_binding");
    if (o.operationId !== state.operationId("evm-live-buyer", `cleanup85-native:${r.recoveryBinding}`) || o.requestHash !== hashObject({ method: "apn.cleanup85-native.v1", request: r }))
        cleanup85Blocked("cancellation_operation_identity");
    const expected = { version: "apn.cleanup85-single-cancellation.v1", parentOperationId: r.parentOperationId, oldCleanupMaterialHash: r.oldCleanupMaterialHash, requestBinding: hashObject(r), operationId: o.operationId, fingerprint: o.fingerprint };
    if (canonicalJson(await new Cleanup85NativePublicRecords(state.root).load(r.parentOperationId, "slot")) !== canonicalJson(expected))
        cleanup85Blocked("permanent_cancellation_slot");
}
//# sourceMappingURL=circle-cleanup85-native-ledger-authority.js.map