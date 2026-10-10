import { canonicalJson, domainHash } from "../canonical.js";
import { validateAssetUsageReservation } from "../asset-usage-ledger.js";
import { permit2UsageIdentity, permit2UsageReservationId, Permit2ExposureLifecycle } from "./exposure-lifecycle.js";
import { validatePermit2ExecutionIntent } from "./execution-intent.js";
import { SecureStateStore } from "../secure-state-store.js";
import { ApnError } from "../errors.js";
/** Mere blocked unsigned intents do not claim account conflicts. Existing lease/exposure risk does. */
export class Permit2LegacyConflictRepository extends SecureStateStore {
    async listOperations(profileHash) {
        const records = [];
        for (const entry of await this.readDirectory("permit2-exposures")) {
            if (!entry.isFile() || !/^[a-f0-9]{64}\.json$/u.test(entry.name))
                corrupt();
            const id = entry.name.slice(0, -5);
            const exposure = await new Permit2ExposureLifecycle(this.root).loadReadOnly(id);
            if (exposure === null)
                corrupt();
            const value = await this.readJson(`permit2-intents/${id}.json`);
            if (value === null)
                corrupt();
            const intent = validatePermit2ExecutionIntent(value, id);
            if (intent.profileHash !== exposure.profileHash || intent.owner !== exposure.owner || intent.chain !== exposure.chain ||
                intent.policyDigest !== exposure.policyDigest || intent.prepareHash !== exposure.prepareHash || intent.amountAtomic !== exposure.amountAtomic ||
                intent.nonce !== exposure.nonce || intent.deadline !== exposure.deadline || intent.reservationId !== exposure.reservationId || intent.token !== exposure.token || intent.typedDataDigest !== exposure.typedDataDigest ||
                intent.eip2612Digest !== exposure.eip2612Digest || intent.challengeHash !== exposure.challengeHash)
                corrupt();
            const identity = permit2UsageIdentity(exposure), leaseId = permit2UsageReservationId(exposure);
            const rawLease = await this.readJson(`asset-usage/${domainHash("apn.asset-usage-bucket.v1", canonicalJson(identity))}/${leaseId}.json`);
            const lease = rawLease === null ? null : validateAssetUsageReservation(rawLease);
            if (lease !== null && (lease.reservationId !== leaseId || lease.policyDigest !== intent.policyDigest || lease.rail !== "x402" ||
                lease.amountAtomic !== intent.amountAtomic || canonicalJson({ account: lease.account, chain: lease.chain, asset: lease.asset }) !== canonicalJson(identity)))
                corrupt();
            if (intent.profileHash === profileHash && (lease !== null || exposure.usageReservationId !== null || exposure.state !== "reserving")) {
                records.push({ operationId: id, profileHash, idempotencyHash: intent.idempotencyHash, requestHash: intent.requestHash,
                    terminal: false, state: exposure.state, chainId: 43114, account: intent.owner });
            }
        }
        return records;
    }
}
function corrupt() { throw new ApnError("APN_STATE_CORRUPT", "Legacy Permit2 conflict evidence is corrupt."); }
//# sourceMappingURL=legacy-conflicts.js.map