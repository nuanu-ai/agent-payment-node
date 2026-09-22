import { canonicalJson, domainHash, exactKeys, hashObject, isPlainRecord } from "../../canonical.js";
import { ApnError } from "../../errors.js";
import { SecureStateStore, stateIdentifier } from "../../secure-state-store.js";
export class UniswapTokenEffectJournal extends SecureStateStore {
    async load(op, kind) {
        await this.initialize();
        const value = await this.readJson(this.path(op.operationId, kind));
        return value === null ? null : validate(value, op, kind);
    }
    async seal(op, kind, transactionHash, envelope, now, primaryProviderId = null) {
        const attempt = attemptOf(op, kind), at = instant(now), envelopeHash = domainHash("apn.uniswap-token-envelope.v1", canonicalJson(envelope));
        provider(primaryProviderId);
        const body = { schemaVersion: "apn.uniswap-token-effect.v2", operationId: op.operationId, kind,
            markerHash: attempt.markerHash, envelopeHash, transactionHash, phase: "sealed", sendAttempts: 0,
            createdAt: at, updatedAt: at, primaryProviderId };
        const effect = validate({ ...body, integrityHash: hashObject(body) }, op, kind);
        await this.initialize();
        await this.ensureDirectory("uniswap-token-effects");
        return await this.withLocks([`uniswap-token-effect:${op.operationId}:${kind}`], async () => {
            const prior = await this.load(op, kind);
            if (prior !== null) {
                if (prior.transactionHash !== transactionHash || prior.envelopeHash !== envelopeHash)
                    corrupt("Uniswap token effect changed after sealing.");
                if (prior.schemaVersion === "apn.uniswap-token-effect.v2") {
                    if (prior.primaryProviderId !== primaryProviderId)
                        corrupt("Uniswap token effect provider binding changed.");
                    return prior;
                }
                if (primaryProviderId !== null) {
                    const { integrityHash: _old, schemaVersion: _schema, ...legacy } = prior, upgraded = { ...legacy, schemaVersion: "apn.uniswap-token-effect.v2", primaryProviderId };
                    const next = validate({ ...upgraded, integrityHash: hashObject(upgraded) }, op, kind);
                    await this.writeJson(this.path(op.operationId, kind), next);
                    return next;
                }
                return prior;
            }
            await this.writeJson(this.path(op.operationId, kind), effect, true);
            return effect;
        });
    }
    async markStarted(op, kind, now) {
        return await this.move(op, kind, "send_started", now);
    }
    async markOutcome(op, kind, phase, now) {
        return await this.move(op, kind, phase, now);
    }
    async move(op, kind, phase, now) {
        return await this.withLocks([`uniswap-token-effect:${op.operationId}:${kind}`], async () => {
            const current = await this.load(op, kind);
            if (current === null)
                corrupt("Uniswap token signed effect is missing.");
            const allowed = { sealed: ["send_started"],
                send_started: ["send_accepted", "send_ambiguous"], send_accepted: [], send_ambiguous: [] };
            if (!allowed[current.phase].includes(phase))
                blocked("Uniswap token effect was already attempted.", "uniswap_token_single_send");
            const { integrityHash: _old, ...old } = current, body = { ...old, phase, sendAttempts: 1, updatedAt: instant(now) };
            const next = validate({ ...body, integrityHash: hashObject(body) }, op, kind);
            await this.writeJson(this.path(op.operationId, kind), next);
            return next;
        });
    }
    path(id, kind) { stateIdentifier(id, "Uniswap token operation"); return `uniswap-token-effects/${id}-${kind}.json`; }
}
function validate(value, op, kind) {
    const keys = ["schemaVersion", "operationId", "kind", "markerHash", "envelopeHash", "transactionHash",
        "phase", "sendAttempts", "createdAt", "updatedAt", "integrityHash"];
    if (!isPlainRecord(value) || !["apn.uniswap-token-effect.v1", "apn.uniswap-token-effect.v2"].includes(value.schemaVersion) ||
        !exactKeys(value, value.schemaVersion === "apn.uniswap-token-effect.v2" ? [...keys, "primaryProviderId"] : keys) ||
        value.operationId !== op.operationId || value.kind !== kind || !["sealed", "send_started", "send_accepted", "send_ambiguous"].includes(value.phase) ||
        !/^0x[a-f0-9]{64}$/u.test(value.transactionHash) || !/^[a-f0-9]{64}$/u.test(value.markerHash) ||
        !/^[a-f0-9]{64}$/u.test(value.envelopeHash) || !/^[a-f0-9]{64}$/u.test(value.integrityHash))
        corrupt("Uniswap token effect is invalid.");
    const effect = value, attempt = attemptOf(op, kind), { integrityHash, ...body } = effect;
    if (effect.markerHash !== attempt.markerHash || effect.sendAttempts !== (effect.phase === "sealed" ? 0 : 1) || integrityHash !== hashObject(body) ||
        !canonicalInstant(effect.createdAt) || !canonicalInstant(effect.updatedAt) || effect.updatedAt < effect.createdAt ||
        effect.schemaVersion === "apn.uniswap-token-effect.v2" && !validProvider(effect.primaryProviderId))
        corrupt("Uniswap token effect binding is invalid.");
    return effect;
}
function provider(value) { if (!validProvider(value))
    corrupt("Uniswap token effect provider binding is invalid."); }
function validProvider(value) { return value === null || typeof value === "string" && /^[a-f0-9]{64}$/u.test(value); }
function attemptOf(op, kind) {
    const attempt = kind === "approval" ? op.approvalAttempt : kind === "swap" ? op.swapAttempt : op.cleanupAttempt;
    if (attempt === null)
        corrupt("Uniswap token effect has no durable marker.");
    return attempt;
}
function instant(value) { if (!(value instanceof Date) || !Number.isFinite(value.getTime()))
    corrupt("Uniswap token effect time is invalid."); return value.toISOString(); }
function canonicalInstant(value) { return Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value; }
function corrupt(message) { throw new ApnError("APN_STATE_CORRUPT", message); }
function blocked(message, reason) { throw new ApnError("APN_OPERATION_BLOCKED", message, { reason }); }
//# sourceMappingURL=token-effects.js.map