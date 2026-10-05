import { randomBytes } from "node:crypto";
import { canonicalJson, domainHash, sha256 } from "../canonical.js";
import { loadActiveAssetPolicyRegistry } from "../allowlist-active-policy.js";
import { assertPermit2OwnerLocked } from "./production-owner-admission.js";
import { AssetUsageLedger, assetUsageReservationId } from "../asset-usage-ledger.js";
import { ApnError } from "../errors.js";
import { evmAddressLock, assertExclusiveEvmOwner } from "../evm-address-ownership.js";
import { StateStore } from "../state.js";
import { OperationService } from "../operation-service.js";
import { canonicalProfile } from "../wallet-policy.js";
import { canonicalIdempotencyKey } from "../transfer-policy.js";
import { validatePermit2CheckedChallenge } from "./checked-challenge.js";
import { permit2WalletBinding } from "./owner-binding.js";
import { createPermit2ProductionReadPort } from "./read-port.js";
import { createPermit2ProductionMaterial, PERMIT2_PRODUCTION_SCHEMA, reconstructPermit2ProductionMaterial } from "./production-material.js";
import { selectPermit2Offer } from "./offer.js";
import { X402_PERMIT2_ASSETS, X402_PERMIT2_MECHANISM } from "./registry.js";
import { Permit2ProductionRepository, permit2ProductionId, productionRecordBody, productionUsageIdentity, productionUsageKey, sealPermit2ProductionRecord } from "./production-repository.js";
const asset = X402_PERMIT2_ASSETS[0];
/** Durable unsigned production preparation. No custody, send, merchant HTTP or settlement port exists. */
export class Permit2ProductionPreparation {
    ports;
    records;
    state;
    usage;
    operations;
    constructor(root, ports) {
        this.ports = ports;
        this.records = new Permit2ProductionRepository(root);
        this.state = new StateStore(root);
        this.usage = new AssetUsageLedger(root);
        this.operations = new OperationService(this.state);
    }
    now() {
        const now = (this.ports.now ?? (() => new Date()))();
        if (!(now instanceof Date) || !Number.isFinite(now.getTime()))
            blocked("Invalid production clock.");
        return new Date(Math.floor(now.getTime() / 1000) * 1000);
    }
    locks(record) {
        return [`profile:${record.profileHash}`, `operation:${record.operationId}`, evmAddressLock(record.material.wallet.account)];
    }
    async prepare(input) {
        const profile = canonicalProfile(input.profile), key = canonicalIdempotencyKey(input.idempotencyKey);
        const checked = validatePermit2CheckedChallenge(input.checked);
        const operationId = permit2ProductionId(profile, key), profileHash = this.state.profileHash(profile);
        const requestHash = domainHash(`${PERMIT2_PRODUCTION_SCHEMA}.request`, canonicalJson({ profileHash, checked, expected: input.expected }));
        await this.records.ready();
        const saved = await this.records.findOperation(operationId);
        if (saved !== null)
            return this.state.withLocks(this.locks(saved), async () => {
                const existing = await this.required(operationId);
                if (existing.requestHash !== requestHash)
                    throw new ApnError("APN_IDEMPOTENCY_CONFLICT", "Permit2 key names different merchant request or challenge.");
                return existing;
            });
        const wallet = await permit2WalletBinding(this.state, profile);
        return this.state.withLocks([`profile:${profileHash}`, `operation:${operationId}`, evmAddressLock(wallet.account)], async () => {
            const existing = await this.records.findOperation(operationId);
            if (existing !== null) {
                if (existing.requestHash !== requestHash)
                    throw new ApnError("APN_IDEMPOTENCY_CONFLICT", "Permit2 key names different merchant request or challenge.");
                return existing;
            }
            await assertExclusiveEvmOwner(this.state, wallet.account, profileHash);
            await this.operations.assertEvmAccountAvailable(profileHash, asset.chainId, wallet.account);
            const selection = selectPermit2Offer(checked.challenge.accepts, wallet.account);
            if (input.expected.index !== selection.index || input.expected.challengeHash !== checked.challengeHash ||
                canonicalJson(input.expected.requirement) !== canonicalJson(selection.requirement))
                blocked("Merchant terms changed.");
            const now = this.now(), signingSecond = Math.floor(now.getTime() / 1000);
            const nonce = BigInt(`0x${randomBytes(32).toString("hex")}`);
            const read = createPermit2ProductionReadPort({ profile, stateRoot: this.state.root,
                localAccount: async () => (await permit2WalletBinding(this.state, profile)).account,
                usage: { usage: (identity, at) => this.usage.usageReadOnly(identity, at) }, rpc: this.ports.rpc,
                ...(this.ports.transport === undefined ? {} : { transport: this.ports.transport }), now: () => this.now() });
            const observed = await read.readChecked({ payer: wallet.account, chainId: 43114, token: asset.token,
                challengeHash: checked.challengeHash, offerHash: selection.offerHash, amountAtomic: selection.amountAtomic,
                nowSeconds: signingSecond, nonceBitmapWordIndex: (nonce >> 8n).toString() });
            if (canonicalJson(wallet) !== canonicalJson(await permit2WalletBinding(this.state, profile)))
                blocked("Wallet binding changed during preparation.");
            const material = createPermit2ProductionMaterial({ checked, wallet, checkpoint: observed.checkpoint,
                owner: observed.owner, evidence: observed.evidence, signingSecond, nonce: nonce.toString() });
            const identity = { account: wallet.account, chain: asset.chain, asset: { kind: "token", identifier: asset.token } };
            const record = sealPermit2ProductionRecord({ schemaVersion: PERMIT2_PRODUCTION_SCHEMA, operationId, profileHash,
                idempotencyHash: sha256(`idempotency\0x402-permit2-production.v2\0${key}`), requestHash, material,
                createdAt: now.toISOString(), updatedAt: now.toISOString(), state: "prepared", terminal: false, reservationStarted: false,
                usageReservationId: assetUsageReservationId(identity, productionUsageKey(operationId)), usageReservationDigest: null,
                exposureAt: null, releaseDigest: null });
            await this.records.persistPreparedLocked(record, { now: () => this.now() });
            return record;
        });
    }
    async required(id) {
        const record = await this.records.findOperation(id);
        if (record === null)
            throw new ApnError("APN_OPERATION_NOT_FOUND", "Permit2 production operation was not found.");
        return record;
    }
    /** Concrete active-policy admission; ledger snapshot is acquired without profile/operation locks. */
    async assertCurrentOwner(id) {
        const record = await this.required(id), now = this.now();
        const snapshot = await this.usage.usageWithReservation(productionUsageIdentity(record), record.usageReservationId, now);
        let used = BigInt(snapshot.snapshot.amountAtomic);
        if (snapshot.reservation !== null) {
            const lease = snapshot.reservation;
            if (lease.policyDigest !== record.material.owner.policyDigest || lease.registryVersion !== record.material.checkpoint.registryVersion || lease.rail !== "x402" ||
                lease.amountAtomic !== reconstructPermit2ProductionMaterial(record.material).amountAtomic || lease.state !== "reserved" ||
                record.usageReservationDigest !== null && record.usageReservationDigest !== lease.reservationDigest)
                blocked("Permit2 lease changed.");
            if (used < BigInt(lease.amountAtomic))
                blocked("Permit2 usage is inconsistent.");
            used -= BigInt(lease.amountAtomic);
        }
        else if (record.state === "reserved" || record.state === "exposure_unknown")
            blocked("Permit2 lease is missing.");
        return this.state.withLocks(this.locks(record), async () => {
            const current = await this.required(id);
            if (current.integrityHash !== record.integrityHash || current.exposureAt !== null || current.terminal)
                blocked("Permit2 lifecycle changed.");
            await assertPermit2OwnerLocked(this.state, this.operations, current, now, used.toString());
            return current;
        });
    }
    async reserve(id) {
        await this.records.ready();
        let record = await this.assertCurrentOwner(id);
        if (!["prepared", "reserving", "reserved"].includes(record.state))
            blocked("Permit2 operation cannot reserve.");
        if (record.state === "reserved")
            return record;
        record = await this.state.withLocks(this.locks(record), async () => {
            const current = await this.required(id);
            if (current.integrityHash !== record.integrityHash)
                blocked("Permit2 reservation raced.");
            const next = sealPermit2ProductionRecord({ ...productionRecordBody(current), state: "reserving", reservationStarted: true, updatedAt: this.now().toISOString() });
            await this.records.persistLocked(next);
            return next;
        });
        // No state lock spans this ledger call. Recovery uses exactly the saved reservation key.
        const active = await loadActiveAssetPolicyRegistry(this.state.root, record.material.wallet.profile, this.now());
        if (active === null || active.digest !== record.material.owner.policyDigest || active.registry.registryVersion !== record.material.checkpoint.registryVersion ||
            active.revision !== record.material.checkpoint.policyRevision ||
            active.activationDigest !== record.material.checkpoint.activationDigest)
            blocked("Permit2 owner changed before reserve.");
        const lease = await this.usage.reserve({ ...productionUsageIdentity(record), registry: active.registry, rail: "x402",
            mechanism: X402_PERMIT2_MECHANISM, amountAtomic: reconstructPermit2ProductionMaterial(record.material).amountAtomic,
            idempotencyKey: productionUsageKey(id), now: this.now() });
        if ((await this.required(id)).state === "release_pending")
            return this.releaseExpired(id);
        await this.assertCurrentOwner(id);
        return this.state.withLocks(this.locks(record), async () => {
            const current = await this.required(id);
            if (current.state === "reserved" && current.usageReservationDigest === lease.reservationDigest)
                return current;
            if (current.state !== "reserving" || current.exposureAt !== null || lease.state !== "reserved" ||
                lease.reservationId !== current.usageReservationId)
                blocked("Permit2 reservation changed.");
            const next = sealPermit2ProductionRecord({ ...productionRecordBody(current), state: "reserved",
                usageReservationDigest: lease.reservationDigest, updatedAt: this.now().toISOString() });
            await this.records.persistLocked(next);
            return next;
        });
    }
    /** Expiry only releases proven unsigned material. No caller proof digest or exposed-release API exists. */
    async releaseExpired(id) {
        let record = await this.required(id);
        record = await this.state.withLocks(this.locks(record), async () => {
            const current = await this.required(id), now = this.now(), p = reconstructPermit2ProductionMaterial(current.material);
            if (current.terminal)
                return current;
            if (current.exposureAt !== null || current.state === "exposure_unknown" || BigInt(p.expiresAtUnix) > BigInt(Math.floor(now.getTime() / 1000))) {
                blocked("Permit2 expiry cannot prove unexposed material.");
            }
            const next = sealPermit2ProductionRecord({ ...productionRecordBody(current), state: "release_pending", updatedAt: now.toISOString(),
                releaseDigest: domainHash(`${PERMIT2_PRODUCTION_SCHEMA}.unsigned-expiry`, canonicalJson({ operationId: id,
                    materialHash: current.material.materialHash, deadline: p.expiresAtUnix })) });
            await this.records.persistLocked(next);
            return next;
        });
        if (record.terminal)
            return record;
        await this.usage.cancelUnsubmittedReservation({ ...productionUsageIdentity(record),
            idempotencyKey: productionUsageKey(id), policyDigest: record.material.owner.policyDigest,
            registryVersion: record.material.checkpoint.registryVersion, rail: "x402",
            amountAtomic: reconstructPermit2ProductionMaterial(record.material).amountAtomic,
            outcomeDigest: record.releaseDigest, now: this.now() });
        return this.state.withLocks(this.locks(record), async () => {
            const current = await this.required(id);
            if (current.state !== "release_pending" || current.exposureAt !== null || current.releaseDigest !== record.releaseDigest)
                blocked("Permit2 release changed.");
            const next = sealPermit2ProductionRecord({ ...productionRecordBody(current), state: "released_unsubmitted", terminal: true,
                updatedAt: this.now().toISOString() });
            await this.records.persistLocked(next);
            return next;
        });
    }
}
function blocked(message) { throw new ApnError("APN_OPERATION_BLOCKED", message); }
//# sourceMappingURL=production-prepare.js.map