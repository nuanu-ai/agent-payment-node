import { canonicalJson, sha256 } from "../canonical.js";
import { ApnError } from "../errors.js";
import { AssetUsageLedger } from "../asset-usage-ledger.js";
import { evmAddressLock } from "../evm-address-ownership.js";
import { OperationService } from "../operation-service.js";
import { assertPermit2OwnerLocked } from "./production-owner-admission.js";
import { reconstructPermit2ProductionMaterial } from "./production-material.js";
import { productionUsageIdentity, productionUsageKey } from "./production-repository.js";
import { assertSigningTime } from "./production-signing-facts.js";
/** Only an owned exact self lease is excluded; no caller record or daily usage is accepted. */
export async function signingOwnerFence(state, records, id, mode, clock, expected) {
    const record = await records.findOperation(id);
    if (record === null)
        blocked();
    assertSigningLifecycle(record, mode);
    assertSigningTime(record, clock());
    const usage = await new AssetUsageLedger(state.root).usageWithReservation(productionUsageIdentity(record), record.usageReservationId, clock());
    const lease = checkedSigningLease(record, usage.reservation, mode, expected);
    const used = BigInt(usage.snapshot.amountAtomic) - BigInt(lease.amountAtomic);
    if (used < 0n)
        blocked();
    await state.withLocks([`profile:${record.profileHash}`, `operation:${id}`, evmAddressLock(record.material.wallet.account)], async () => {
        const current = await records.findOperation(id);
        if (current === null || current.integrityHash !== record.integrityHash)
            blocked();
        assertSigningLifecycle(current, mode);
        await assertPermit2OwnerLocked(state, new OperationService(state), current, clock(), used.toString());
        assertSigningTime(current, clock());
    });
    // All returned material is repository-owned; compare canonical records, not caller assertions.
    if (expected !== undefined && canonicalJson(record.material.wallet) !== canonicalJson(expected.record.material.wallet))
        blocked();
    return { record, lease };
}
/** Shared strict self-lease predicates only; callers must obtain the actual locked ledger snapshot. */
export function checkedSigningLease(record, lease, mode, expected) {
    const id = record.operationId, p = reconstructPermit2ProductionMaterial(record.material);
    if (lease === null || lease.reservationId !== record.usageReservationId || lease.policyDigest !== record.material.owner.policyDigest ||
        lease.registryVersion !== record.material.checkpoint.registryVersion || lease.rail !== "x402" || lease.amountAtomic !== p.amountAtomic ||
        lease.idempotencyHash !== sha256(`asset-usage-idempotency\0${productionUsageKey(id)}`) ||
        lease.state !== (mode === "reserved" ? "reserved" : "unknown_finality") ||
        mode === "reserved" && lease.reservationDigest !== record.usageReservationDigest ||
        expected !== undefined && (record.integrityHash !== expected.record.integrityHash || lease.reservationDigest !== expected.lease.reservationDigest))
        blocked();
    return lease;
}
export function assertSigningLifecycle(record, mode) {
    if (record.terminal || record.usageReservationDigest === null || !record.reservationStarted)
        blocked();
    if (mode === "reserved") {
        if (record.state !== "reserved" || record.exposureAt !== null || record.exposureJournal !== undefined)
            blocked();
    }
    else if (mode === "exposed") {
        const j = record.exposureJournal;
        if (record.state !== "exposure_unknown" || record.exposureAt === null || j === undefined || !j.holdConfirmed ||
            j.signed !== null || j.request !== null || j.terminalIntent !== null)
            blocked();
    }
    else if (mode === "dispatch") {
        const j = record.exposureJournal;
        if (!["exposure_unknown", "request_pending"].includes(record.state) || record.exposureAt === null ||
            j === undefined || !j.holdConfirmed || j.signed === null || j.terminalIntent !== null ||
            (record.state === "request_pending") !== (j.request !== null))
            blocked();
    }
    else
        blocked();
}
function blocked() { throw new ApnError("APN_OPERATION_BLOCKED", "Permit2 current signing owner, lifecycle or self lease changed."); }
//# sourceMappingURL=production-signing-owner.js.map