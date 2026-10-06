import { canonicalJson, sha256 } from "../canonical.js";
import { ApnError } from "../errors.js";
import { AssetUsageLedger, type AssetUsageReservation } from "../asset-usage-ledger.js";
import { evmAddressLock } from "../evm-address-ownership.js";
import { OperationService } from "../operation-service.js";
import type { StateStore } from "../state.js";
import { assertPermit2OwnerLocked } from "./production-owner-admission.js";
import { reconstructPermit2ProductionMaterial } from "./production-material.js";
import { productionUsageIdentity, productionUsageKey, type Permit2ProductionRecord, type Permit2ProductionRepository } from "./production-repository.js";
import { assertSigningTime } from "./production-signing-facts.js";

export type Permit2SigningMode = "reserved" | "exposed";
export type Permit2MetadataMode = Permit2SigningMode | "dispatch";
/** Only an owned exact self lease is excluded; no caller record or daily usage is accepted. */
export async function signingOwnerFence(state: StateStore, records: Permit2ProductionRepository,
  id: string, mode: Permit2SigningMode, clock: () => Date, expected?: { readonly record: Permit2ProductionRecord; readonly lease: AssetUsageReservation }) {
  const record = await records.findOperation(id); if (record === null) blocked();
  assertSigningLifecycle(record, mode); assertSigningTime(record, clock());
  const usage = await new AssetUsageLedger(state.root).usageWithReservation(productionUsageIdentity(record), record.usageReservationId, clock());
  const lease = checkedSigningLease(record, usage.reservation, mode, expected);
  const used = BigInt(usage.snapshot.amountAtomic) - BigInt(lease.amountAtomic); if (used < 0n) blocked();
  await state.withLocks([`profile:${record.profileHash}`, `operation:${id}`, evmAddressLock(record.material.wallet.account)], async () => {
    const current = await records.findOperation(id); if (current === null || current.integrityHash !== record.integrityHash) blocked();
    assertSigningLifecycle(current, mode);
    await assertPermit2OwnerLocked(state, new OperationService(state), current, clock(), used.toString());
    assertSigningTime(current, clock());
  });
  // All returned material is repository-owned; compare canonical records, not caller assertions.
  if (expected !== undefined && canonicalJson(record.material.wallet) !== canonicalJson(expected.record.material.wallet)) blocked();
  return { record, lease };
}
/** Shared strict self-lease predicates only; callers must obtain the actual locked ledger snapshot. */
export function checkedSigningLease(record: Permit2ProductionRecord, lease: AssetUsageReservation | null, mode: Permit2MetadataMode,
  expected?: { readonly record: Permit2ProductionRecord; readonly lease: AssetUsageReservation }): AssetUsageReservation {
  const id = record.operationId, p = reconstructPermit2ProductionMaterial(record.material);
  if (lease === null || lease.reservationId !== record.usageReservationId || lease.policyDigest !== record.material.owner.policyDigest ||
      lease.registryVersion !== record.material.checkpoint.registryVersion || lease.rail !== "x402" || lease.amountAtomic !== p.amountAtomic ||
      lease.idempotencyHash !== sha256(`asset-usage-idempotency\0${productionUsageKey(id)}`) ||
      lease.state !== (mode === "reserved" ? "reserved" : "unknown_finality") ||
      mode === "reserved" && lease.reservationDigest !== record.usageReservationDigest ||
      expected !== undefined && (record.integrityHash !== expected.record.integrityHash || lease.reservationDigest !== expected.lease.reservationDigest)) blocked();
  return lease;
}
export function assertSigningLifecycle(record: Permit2ProductionRecord, mode: Permit2MetadataMode): void {
  if (record.terminal || record.usageReservationDigest === null || !record.reservationStarted) blocked();
  if (mode === "reserved") {
    if (record.state !== "reserved" || record.exposureAt !== null || record.exposureJournal !== undefined) blocked();
  } else if (mode === "exposed") {
    const j = record.exposureJournal;
    if (record.state !== "exposure_unknown" || record.exposureAt === null || j === undefined || !j.holdConfirmed ||
        j.signed !== null || j.request !== null || j.terminalIntent !== null) blocked();
  } else if (mode === "dispatch") {
    const j = record.exposureJournal;
    if (!["exposure_unknown", "request_pending"].includes(record.state) || record.exposureAt === null ||
        j === undefined || !j.holdConfirmed || j.signed === null || j.terminalIntent !== null ||
        (record.state === "request_pending") !== (j.request !== null)) blocked();
  } else blocked();
}
function blocked(): never { throw new ApnError("APN_OPERATION_BLOCKED", "Permit2 current signing owner, lifecycle or self lease changed."); }
