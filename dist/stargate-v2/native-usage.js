import { getAddress } from "viem";
import { loadActiveAssetPolicyRegistry } from "../allowlist-active-policy.js";
import { bridgeMechanismAdmitted, evaluateAssetPolicy } from "../asset-policy-registry.js";
import { AssetUsageLedger, assetUsageReservationId } from "../asset-usage-ledger.js";
import { canonicalJson, domainHash } from "../canonical.js";
import { ApnError } from "../errors.js";
import { STARGATE_NATIVE_MECHANISM } from "./native-record.js";
const TERMINAL = ["finalized", "failed_before_effect", "failed_confirmed_revert", "released_unsubmitted"];
const refused = (message) => new ApnError("APN_ALLOWLIST_REFUSED", message);
const corrupt = (message) => new ApnError("APN_STATE_CORRUPT", message);
function usageIdentity(owner) {
    return { account: getAddress(owner), chain: "eip155:1", asset: { kind: "native", identifier: null } };
}
const usageKey = (operationId) => `apn.stargate-native-usage:${operationId}`;
/** Owner admission and the shared asset-usage ledger for the native lane, in the token lane's shape. */
export class StargateNativeUsage {
    state;
    now;
    ledger;
    constructor(state, now) {
        this.state = state;
        this.now = now;
        this.ledger = new AssetUsageLedger(state.root);
    }
    async admitPolicy(input) {
        const active = await this.active(input.profile, input.owner), at = new Date(this.now());
        this.admit(active, input.amountAtomic, at, (await this.ledger.usage(usageIdentity(input.owner), at)).amountAtomic);
        return { policyDigest: active.digest, policyRevision: active.revision, mechanism: { ...STARGATE_NATIVE_MECHANISM } };
    }
    /** Before signing: the active policy must still be the prepared one, and the principal is held under the shared caps. */
    async reserve(op) {
        const binding = op.policy;
        if (binding === undefined)
            throw new ApnError("APN_REPREPARE_REQUIRED", "Stargate native operation predates owner admission; prepare again.");
        const active = await this.active(op.profile, op.owner);
        if (active.digest !== binding.policyDigest || active.revision !== binding.policyRevision ||
            canonicalJson(binding.mechanism) !== canonicalJson(STARGATE_NATIVE_MECHANISM))
            throw refused("The active Stargate owner policy changed; prepare again.");
        const identity = usageIdentity(op.owner), reservationId = assetUsageReservationId(identity, usageKey(op.operationId)), at = new Date(this.now());
        const existing = await this.ledger.load(identity, reservationId);
        if (existing !== null) {
            // A retry after an interrupted pre-sign step keeps its own hold instead of counting it twice.
            if (existing.state !== "reserved" || existing.policyDigest !== binding.policyDigest || existing.amountAtomic !== op.amountAtomic)
                throw corrupt("Stargate native usage reservation does not match the unsigned operation.");
            return;
        }
        this.admit(active, op.amountAtomic, at, (await this.ledger.usage(identity, at)).amountAtomic);
        const reservation = await this.ledger.reserve({ ...identity, registry: active.registry, rail: "bridge", mechanism: binding.mechanism,
            amountAtomic: op.amountAtomic, idempotencyKey: usageKey(op.operationId), now: at });
        if (reservation.state !== "reserved")
            throw corrupt("Stargate native usage reservation is not held.");
    }
    /** Idempotent: brings the hold to the state the journal proves, and never reopens a terminal hold. */
    async follow(op, target) {
        if (op.policy === undefined)
            return; // v1/v2 records were written before the native lane held usage.
        const identity = usageIdentity(op.owner), reservationId = assetUsageReservationId(identity, usageKey(op.operationId));
        const current = await this.ledger.load(identity, reservationId);
        if (current === null) {
            if (target === "failed_before_effect")
                return;
            throw corrupt("Stargate native usage reservation is missing.");
        }
        if (current.state === target)
            return;
        if (TERMINAL.includes(current.state)) {
            if (target === "submitted" || target === "unknown_finality")
                return;
            throw corrupt("Stargate native usage reservation reached a conflicting terminal state.");
        }
        if (target === "submitted" && current.state === "unknown_finality")
            return;
        const move = async (state) => {
            const outcome = TERMINAL.includes(state) ? { outcomeDigest: domainHash("apn.stargate-native-usage-outcome.v1", canonicalJson({ operationId: op.operationId, target: state, integrityHash: op.integrityHash })) } : {};
            await this.ledger.transition({ ...identity, reservationId, policyDigest: current.policyDigest, state, now: new Date(this.now()), ...outcome });
        };
        // A hold still at "reserved" when a revert is proven passed the attempt marker without its send outcome being recorded.
        if (target === "failed_confirmed_revert" && current.state === "reserved")
            await move("unknown_finality");
        await move(target);
    }
    async active(profile, owner) {
        const active = await loadActiveAssetPolicyRegistry({ state: this.state, clock: { now: () => new Date(this.now()) } }, profile);
        if (active === null || active.accounts.evm !== owner)
            throw refused("Stargate native execution requires an active owner policy for this EVM account.");
        return active;
    }
    admit(active, amountAtomic, at, dailyUsageAtomic) {
        const admission = evaluateAssetPolicy(active.registry, { chain: "eip155:1", asset: { kind: "native", identifier: null }, rail: "bridge",
            amountAtomic, dailyUsageAtomic, asOfDate: at.toISOString().slice(0, 10), asOf: at.toISOString(), mechanism: STARGATE_NATIVE_MECHANISM });
        if (!bridgeMechanismAdmitted(admission, STARGATE_NATIVE_MECHANISM))
            throw refused("The active bridge mechanism pin does not authorize this exact Stargate V2 native lane.");
    }
}
//# sourceMappingURL=native-usage.js.map