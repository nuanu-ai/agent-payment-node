import { getAddress } from "viem";
import { canonicalJson, domainHash } from "./canonical.js";
import { evaluateAssetPolicy, validateAssetPolicyRegistry, } from "./asset-policy-registry.js";
import { SecureStateStore } from "./secure-state-store.js";
import { ASSET_USAGE_RESERVATION_SCHEMA, ASSET_USAGE_WINDOW, validateAssetUsageReservation, expectedStates, reservationIdFor, seal, sumUsage, assertReplay, assertBucketWindow, assertTransition, validateIdentity, exactIdentity, exactAsset, withoutDigest, canonicalAccount, idempotency, atomic, instant, digest, invalid, blocked, corrupt, } from "./asset-usage-ledger-record.js";
export { ASSET_USAGE_RESERVATION_SCHEMA, ASSET_USAGE_WINDOW, assetUsageReservationId, validateAssetUsageReservation } from "./asset-usage-ledger-record.js";
/**
 * Durable common usage ledger for all admitted rails. Money-rail owners reserve here while holding
 * no other state lock, then persist their own operation under their existing lock discipline.
 */
export class AssetUsageLedger extends SecureStateStore {
    initialized;
    /** Relay and this ledger hash idempotency keys in separate domains. Hold the
     * exact source asset bucket lock through the caller's retirement write. */
    async withNoMatchingRelayReservation(account, policyDigest, amountAtomic, action, sourceChainId = 1, allowFailedBeforeEffectReservationId) {
        if (policyDigest !== undefined)
            digest(policyDigest, "Policy digest");
        const identity = validateIdentity(sourceChainId === 56
            ? { account: getAddress(account), chain: "eip155:56", asset: { kind: "native", identifier: null } }
            : { account: getAddress(account), chain: "eip155:1",
                asset: { kind: "token", identifier: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48" } });
        await this.ready();
        return this.withLocks([this.bucketLock(identity)], async () => {
            const records = await this.loadBucket(identity);
            if (records.some(record => record.rail === "bridge" &&
                (policyDigest === undefined || record.policyDigest === policyDigest) && record.amountAtomic === amountAtomic &&
                !(record.reservationId === allowFailedBeforeEffectReservationId && record.state === "failed_before_effect"))) {
                throw blocked("Relay retirement is refused because a matching usage reservation exists.");
            }
            return action();
        });
    }
    async reserve(input) {
        const registry = validateAssetPolicyRegistry(input.registry);
        const at = instant(input.now);
        const initial = evaluateAssetPolicy(registry, {
            chain: input.chain, asset: input.asset, rail: input.rail, ...(input.mechanism === undefined ? {} : { mechanism: input.mechanism }),
            amountAtomic: input.amountAtomic, dailyUsageAtomic: "0", asOfDate: at.slice(0, 10), asOf: at,
        });
        const account = canonicalAccount(initial.chain, input.account, false);
        const idempotencyHash = idempotency(input.idempotencyKey);
        const identity = { account, chain: initial.chain, asset: exactAsset(initial.asset) };
        const reservationId = reservationIdFor(identity, idempotencyHash);
        await this.ready();
        return await this.withLocks([this.bucketLock(identity)], async () => {
            const reservations = await this.loadBucket(identity);
            const existing = reservations.find((entry) => entry.reservationId === reservationId);
            if (existing !== undefined) {
                assertReplay(existing, initial.policyDigest, initial.registryVersion, input.rail, initial.amountAtomic, idempotencyHash);
                if (input.retryFailedBeforeEffect === true && existing.state === "failed_before_effect") {
                    assertBucketWindow(reservations, at);
                    const usage = sumUsage(reservations, input.now);
                    evaluateAssetPolicy(registry, {
                        chain: identity.chain, asset: identity.asset, rail: input.rail, ...(input.mechanism === undefined ? {} : { mechanism: input.mechanism }),
                        amountAtomic: initial.amountAtomic, dailyUsageAtomic: usage, asOfDate: at.slice(0, 10), asOf: at,
                    });
                    const reopened = seal({ ...withoutDigest(existing), state: "reserved", reservedAt: at, updatedAt: at,
                        effectAt: null, outcomeDigest: null });
                    await this.writeJson(this.recordPath(identity, reservationId), reopened);
                    return reopened;
                }
                return existing;
            }
            assertBucketWindow(reservations, at);
            const usage = sumUsage(reservations, input.now);
            evaluateAssetPolicy(registry, {
                chain: identity.chain, asset: identity.asset, rail: input.rail, ...(input.mechanism === undefined ? {} : { mechanism: input.mechanism }),
                amountAtomic: initial.amountAtomic, dailyUsageAtomic: usage, asOfDate: at.slice(0, 10), asOf: at,
            });
            const body = {
                schemaVersion: ASSET_USAGE_RESERVATION_SCHEMA,
                reservationId,
                idempotencyHash,
                policyDigest: initial.policyDigest,
                registryVersion: initial.registryVersion,
                ...identity,
                rail: input.rail,
                amountAtomic: initial.amountAtomic,
                state: "reserved",
                reservedAt: at,
                updatedAt: at,
                effectAt: null,
                outcomeDigest: null,
            };
            const record = seal(body);
            await this.writeJson(this.recordPath(identity, reservationId), record, true);
            return record;
        });
    }
    /** Direct pre-private recovery: hold the exact reservation through its durable outcome and release.
     * The callback must not acquire this bucket lock. Its owning profile/operation/custody locks remain held. */
    async releaseDirectReservedAfter(expectedValue, persistOutcome) {
        const expected = structuredClone(validateAssetUsageReservation(expectedValue));
        if (expected.rail !== "direct" || expected.state !== "reserved")
            throw blocked("Only an unchanged direct reserve can close a pre-private attempt.");
        const identity = validateIdentity(expected);
        await this.ready();
        return this.withLocks([this.bucketLock(identity)], async () => {
            const value = await this.readJson(this.recordPath(identity, expected.reservationId));
            if (value === null || canonicalJson(validateAssetUsageReservation(value)) !== canonicalJson(expected)) {
                throw blocked("The exact no-private-entry reservation is no longer held unchanged.");
            }
            const outcome = await persistOutcome();
            const at = instant(outcome.now), outcomeDigest = digest(outcome.outcomeDigest, "Outcome digest");
            if (at < expected.updatedAt)
                throw blocked("The usage reservation transition cannot move backward in time.");
            const released = seal({ ...withoutDigest(expected), state: "failed_before_effect", updatedAt: at,
                effectAt: null, outcomeDigest });
            await this.writeJson(this.recordPath(identity, expected.reservationId), released);
            return outcome.value;
        });
    }
    async transition(input) {
        const identity = validateIdentity(input);
        const reservationId = digest(input.reservationId, "Reservation id");
        const policyDigest = digest(input.policyDigest, "Policy digest");
        const at = instant(input.now);
        const expectedCurrentStates = input.expectedCurrentStates === undefined
            ? undefined
            : expectedStates(input.expectedCurrentStates);
        await this.ready();
        return await this.withLocks([this.bucketLock(identity)], async () => {
            const value = await this.readJson(this.recordPath(identity, reservationId));
            if (value === null)
                throw blocked("The usage reservation does not exist.");
            const current = validateAssetUsageReservation(value);
            if (current.reservationId !== reservationId || current.policyDigest !== policyDigest ||
                canonicalJson(exactIdentity(current)) !== canonicalJson(identity)) {
                throw blocked("The usage reservation binding does not match the requested transition.");
            }
            if (expectedCurrentStates !== undefined && !expectedCurrentStates.includes(current.state)) {
                throw blocked("The usage reservation is no longer in an expected source state.");
            }
            if (at < current.updatedAt)
                throw blocked("The usage reservation transition cannot move backward in time.");
            const terminal = input.state === "finalized" || input.state === "failed_before_effect" ||
                input.state === "released_unsubmitted" || input.state === "failed_confirmed_revert";
            const outcomeDigest = terminal ? digest(input.outcomeDigest, "Outcome digest") : null;
            const consumedAtomic = input.consumedAtomic === undefined ? undefined : atomic(input.consumedAtomic, false, true).toString();
            if (consumedAtomic !== undefined && (input.state !== "failed_confirmed_revert" ||
                BigInt(consumedAtomic) > BigInt(current.amountAtomic))) {
                throw blocked("Confirmed-revert consumption exceeds or conflicts with the reservation.");
            }
            if (current.state === input.state) {
                if (current.outcomeDigest !== outcomeDigest || current.consumedAtomic !== consumedAtomic) {
                    throw blocked("The idempotent usage transition outcome does not match.");
                }
                return current;
            }
            assertTransition(current.state, input.state);
            const body = {
                ...withoutDigest(current),
                state: input.state,
                updatedAt: at,
                effectAt: input.state === "finalized" || consumedAtomic !== undefined ? at : null,
                outcomeDigest,
                ...(consumedAtomic === undefined ? {} : { consumedAtomic }),
            };
            const next = seal(body);
            await this.writeJson(this.recordPath(identity, reservationId), next);
            return next;
        });
    }
    /** Atomic cancellation in the existing schema; a delayed reserve can only replay the released row. */
    async cancelUnsubmittedReservation(input) {
        if (input.chain !== "eip155:43114" || input.asset.kind !== "token" ||
            input.asset.identifier !== "0x9702230A8Ea53601f5cD2dc00fDBc13d4dF4A8c7" ||
            input.rail !== "x402" || !/^x402-permit2-production\.v2:[a-f0-9]{64}$/u.test(input.idempotencyKey) ||
            typeof input.registryVersion !== "string" || !/^[a-z0-9][a-z0-9._-]{0,63}$/u.test(input.registryVersion)) {
            throw invalid("Unsigned cancellation is restricted to a frozen Permit2 production lease.");
        }
        const identity = validateIdentity(input), at = instant(input.now), idempotencyHash = idempotency(input.idempotencyKey);
        const reservationId = reservationIdFor(identity, idempotencyHash);
        const policyDigest = digest(input.policyDigest, "Policy digest"), outcomeDigest = digest(input.outcomeDigest, "Outcome digest");
        const amountAtomic = atomic(input.amountAtomic, true, false).toString();
        await this.ready();
        return this.withLocks([this.bucketLock(identity)], async () => {
            const records = await this.loadBucket(identity);
            assertBucketWindow(records, at);
            const current = records.find(record => record.reservationId === reservationId);
            if (current !== undefined) {
                assertReplay(current, policyDigest, input.registryVersion, input.rail, amountAtomic, idempotencyHash);
                if (at < current.updatedAt)
                    throw blocked("Unsigned cancellation cannot move backward in time.");
                if (current.state === "released_unsubmitted") {
                    if (current.outcomeDigest !== outcomeDigest)
                        throw blocked("Unsigned cancellation outcome changed.");
                    return current;
                }
                if (current.state !== "reserved" || at < current.updatedAt)
                    throw blocked("An exposed or terminal reservation cannot be cancelled.");
            }
            const body = current === undefined
                ? { schemaVersion: ASSET_USAGE_RESERVATION_SCHEMA, ...identity, reservationId, idempotencyHash, policyDigest,
                    registryVersion: input.registryVersion, rail: "x402", amountAtomic, reservedAt: at, updatedAt: at,
                    state: "released_unsubmitted", effectAt: null, outcomeDigest }
                : { ...withoutDigest(current), state: "released_unsubmitted", updatedAt: at, effectAt: null, outcomeDigest };
            const released = seal(body);
            await this.writeJson(this.recordPath(identity, reservationId), released, current === undefined);
            return released;
        });
    }
    async usage(identityValue, now) {
        const identity = validateIdentity(identityValue);
        const at = instant(now);
        await this.ready();
        return await this.withLocks([this.bucketLock(identity)], async () => ({
            windowPolicy: ASSET_USAGE_WINDOW,
            windowStart: `${at.slice(0, 10)}T00:00:00.000Z`,
            windowEnd: new Date(Date.parse(`${at.slice(0, 10)}T00:00:00.000Z`) + 86_400_000).toISOString(),
            amountAtomic: sumUsage(await this.loadBucket(identity), now),
        }));
    }
    /** Existing-ledger snapshot for nonpersistent preflight; never initializes, locks, or creates a bucket. */
    async usageReadOnly(identityValue, now) {
        const identity = validateIdentity(identityValue);
        const at = instant(now);
        return {
            windowPolicy: ASSET_USAGE_WINDOW,
            windowStart: `${at.slice(0, 10)}T00:00:00.000Z`,
            windowEnd: new Date(Date.parse(`${at.slice(0, 10)}T00:00:00.000Z`) + 86_400_000).toISOString(),
            amountAtomic: sumUsage(await this.loadBucket(identity, false), now),
        };
    }
    /** Read the daily total and one reservation from the same locked bucket snapshot. */
    async usageWithReservation(identityValue, reservationIdValue, now) {
        const identity = validateIdentity(identityValue);
        const reservationId = digest(reservationIdValue, "Reservation id");
        const at = instant(now);
        await this.ready();
        return await this.withLocks([this.bucketLock(identity)], async () => {
            const records = await this.loadBucket(identity);
            return {
                snapshot: {
                    windowPolicy: ASSET_USAGE_WINDOW,
                    windowStart: `${at.slice(0, 10)}T00:00:00.000Z`,
                    windowEnd: new Date(Date.parse(`${at.slice(0, 10)}T00:00:00.000Z`) + 86_400_000).toISOString(),
                    amountAtomic: sumUsage(records, now),
                },
                reservation: records.find(record => record.reservationId === reservationId) ?? null,
            };
        });
    }
    async load(identityValue, reservationIdValue) {
        const identity = validateIdentity(identityValue);
        const reservationId = digest(reservationIdValue, "Reservation id");
        await this.ready();
        return await this.withLocks([this.bucketLock(identity)], async () => {
            const value = await this.readJson(this.recordPath(identity, reservationId));
            if (value === null)
                return null;
            const record = validateAssetUsageReservation(value);
            if (record.reservationId !== reservationId || canonicalJson(exactIdentity(record)) !== canonicalJson(identity)) {
                corrupt("A usage reservation path binding is invalid.");
            }
            return record;
        });
    }
    async ready() {
        this.initialized ??= (async () => { await super.initialize(); await this.ensureDirectory("asset-usage"); })();
        await this.initialized;
    }
    async loadBucket(identity, create = true) {
        const directory = this.bucketDirectory(identity);
        if (create)
            await this.ensureDirectory(directory);
        const entries = await this.readDirectory(directory);
        const records = [];
        for (const entry of entries) {
            if (!entry.isFile() || !/^[a-f0-9]{64}\.json$/u.test(entry.name))
                corrupt("The usage ledger directory contains an invalid entry.");
            const value = await this.readJson(`${directory}/${entry.name}`);
            if (value === null)
                corrupt("A usage reservation disappeared during a protected read.");
            const record = validateAssetUsageReservation(value);
            if (canonicalJson(exactIdentity(record)) !== canonicalJson(identity) || `${record.reservationId}.json` !== entry.name) {
                corrupt("A usage reservation path binding is invalid.");
            }
            records.push(record);
        }
        return records;
    }
    bucketDirectory(identity) {
        return `asset-usage/${domainHash("apn.asset-usage-bucket.v1", canonicalJson(identity))}`;
    }
    recordPath(identity, reservationId) {
        return `${this.bucketDirectory(identity)}/${reservationId}.json`;
    }
    bucketLock(identity) {
        return `asset-usage:${domainHash("apn.asset-usage-lock.v1", canonicalJson(identity))}`;
    }
}
//# sourceMappingURL=asset-usage-ledger.js.map