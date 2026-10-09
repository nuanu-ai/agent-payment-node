import { hashObject, exactKeys, isPlainRecord } from "../canonical.js";
import { SecureStateStore } from "../secure-state-store.js";
import { circleBlocked, validateCircleEnvelope } from "./operation-model.js";
import { assertCleanup85Parent } from "./cleanup85-recovery-store.js";
import { sanitizedCircleFailure } from "./public-failure-store.js";
const digest = (x) => typeof x === "string" && /^[a-f0-9]{64}$/u.test(x);
export function validateCleanup86Intent(value, recovery) {
    if (!isPlainRecord(value) || !exactKeys(value, ["version", "recoveryBinding", "cancellationProofHash", "envelope", "policies", "capturedAt", "windowEndsAt", "intentHash"]))
        circleBlocked("cleanup86_intent_shape");
    const i = value, { intentHash, ...body } = i;
    if (i.version !== "apn.circle-cleanup86-intent.v1" || i.recoveryBinding !== recovery.recoveryBinding || !digest(i.cancellationProofHash) || intentHash !== hashObject(body) ||
        !Array.isArray(i.policies) || i.policies.length !== 2 || hashObject(i.policies) !== hashObject(recovery.policies) || i.windowEndsAt !== recovery.windowEndsAt || typeof i.capturedAt !== "string" || !Number.isFinite(Date.parse(i.capturedAt)) || new Date(i.capturedAt).toISOString() !== i.capturedAt)
        circleBlocked("cleanup86_intent_binding");
    validateCircleEnvelope(i.envelope, "cleanup", 1329, null, "evm-live-seller");
    if (i.envelope.nonceAtomic !== "86" || BigInt(i.envelope.gasLimitAtomic) * BigInt(i.envelope.maxFeePerGasAtomic) > 15000000000000n)
        circleBlocked("cleanup86_finite_nonce_or_fee");
    return i;
}
export function validateCleanup86Effect(value, intent) {
    if (!isPlainRecord(value) || !exactKeys(value, ["version", "intentHash", "phase", "transactionHash", "materialHash", "sequence", "previousHash", "effectHash"]))
        circleBlocked("cleanup86_effect_shape");
    const e = value, { effectHash, ...body } = e;
    if (e.version !== "apn.circle-cleanup86-effect.v1" || e.intentHash !== intent.intentHash || !["prepared", "signing_started", "sealed", "submission_started", "unknown"].includes(e.phase) || !Number.isSafeInteger(e.sequence) || e.sequence < 0 || e.previousHash !== null && !digest(e.previousHash) || effectHash !== hashObject(body) ||
        e.transactionHash !== null && !/^0x[a-f0-9]{64}$/u.test(e.transactionHash) || e.materialHash !== null && !digest(e.materialHash) || (e.transactionHash === null) !== (e.materialHash === null) || ["sealed", "submission_started"].includes(e.phase) && e.transactionHash === null)
        circleBlocked("cleanup86_effect_binding");
    return e;
}
export class Cleanup86Store extends SecureStateStore {
    path(op, kind) { assertCleanup85Parent(op); return `circle-cleanup85-recovery/${op.operationId}-cleanup86-${kind}.json`; }
    async intent(op, recovery) { const v = await this.readJson(this.path(op, "intent")); return v === null ? null : validateCleanup86Intent(v, recovery); }
    async start(op, recovery, body) {
        const old = await this.intent(op, recovery);
        if (old !== null)
            return old;
        const frame = { version: "apn.circle-cleanup86-intent.v1", recoveryBinding: recovery.recoveryBinding, ...body }, i = validateCleanup86Intent({ ...frame, intentHash: hashObject(frame) }, recovery);
        await this.initialize();
        await this.ensureDirectory("circle-cleanup85-recovery");
        await this.writeJson(this.path(op, "intent"), i, true);
        return i;
    }
    async effect(op, i) { const v = await this.readJson(this.path(op, "effect")); return v === null ? null : validateCleanup86Effect(v, i); }
    async saveEffect(op, i, previous, patch) {
        const current = await this.effect(op, i);
        if (hashObject(current) !== hashObject(previous))
            circleBlocked("cleanup86_effect_concurrent_change");
        const body = { version: "apn.circle-cleanup86-effect.v1", intentHash: i.intentHash, phase: patch.phase, transactionHash: patch.transactionHash, materialHash: patch.materialHash, sequence: (previous?.sequence ?? -1) + 1, previousHash: previous?.effectHash ?? null }, e = validateCleanup86Effect({ ...body, effectHash: hashObject(body) }, i);
        await this.writeJson(this.path(op, `history-${e.sequence}`), e, true);
        await this.writeJson(this.path(op, "effect"), e, previous === null);
        return e;
    }
    async claimed(op, i, boundary) {
        const value = await this.readJson(this.path(op, boundary));
        if (value === null)
            return false;
        if (!isPlainRecord(value) || !exactKeys(value, ["version", "boundary", "intentHash", "recoveryBinding", "cancellationProofHash", ...(boundary === "send" ? ["transactionHash", "materialHash"] : [])]) || value.version !== "apn.circle-cleanup86-claim.v1" || value.boundary !== boundary || value.intentHash !== i.intentHash || value.recoveryBinding !== i.recoveryBinding || value.cancellationProofHash !== i.cancellationProofHash)
            circleBlocked("cleanup86_durable_claim_changed");
        if (boundary === "send") {
            const e = await this.effect(op, i);
            if (e === null || value.transactionHash !== e.transactionHash || value.materialHash !== e.materialHash)
                circleBlocked("cleanup86_send_material_changed");
        }
        return true;
    }
    async claim(op, i, boundary, e) {
        const { intentHash: _hash, ...body } = i;
        validateCircleEnvelope(i.envelope, "cleanup", 1329, null, "evm-live-seller");
        if (i.intentHash !== hashObject(body) || i.envelope.nonceAtomic !== "86" || BigInt(i.envelope.gasLimitAtomic) * BigInt(i.envelope.maxFeePerGasAtomic) > 15000000000000n || hashObject(await this.readJson(this.path(op, "intent"))) !== hashObject(i))
            circleBlocked("cleanup86_claim_immutable_intent_changed");
        if (await this.claimed(op, i, boundary))
            circleBlocked("cleanup86_already_claimed_observe_only");
        if (boundary === "sign" && e.phase !== "signing_started" || boundary === "send" && (e.phase !== "submission_started" || e.transactionHash === null || !await this.claimed(op, i, "sign")))
            circleBlocked("cleanup86_claim_boundary");
        await this.writeJson(this.path(op, boundary), { version: "apn.circle-cleanup86-claim.v1", boundary, intentHash: i.intentHash, recoveryBinding: i.recoveryBinding, cancellationProofHash: i.cancellationProofHash, ...(boundary === "send" ? { transactionHash: e.transactionHash, materialHash: e.materialHash } : {}) }, true);
    }
    async failure(op, i) {
        const value = await this.readJson(this.path(op, "first-failure"));
        if (value === null)
            return null;
        if (!isPlainRecord(value) || Object.keys(value).some(k => !["version", "intentHash", "code", "method", "origin", "status", "stage", "failureHash"].includes(k)) || value.version !== "apn.circle-cleanup86-first-failure.v1" || value.intentHash !== i.intentHash || typeof value.code !== "string" || !/^APN_[A-Z0-9_]{1,80}$/u.test(value.code))
            circleBlocked("cleanup86_public_failure_changed");
        const { failureHash, version: _v, intentHash: _i, code: _c, ...metadata } = value, { failureHash: _h, ...body } = value;
        if (failureHash !== hashObject(body) || hashObject(metadata) !== hashObject(sanitizedCircleFailure(metadata)))
            circleBlocked("cleanup86_public_failure_changed");
        return value;
    }
    async recordFailure(op, i, code, details) {
        if (await this.readJson(this.path(op, "first-failure")) !== null)
            return;
        const publicDetails = sanitizedCircleFailure(details);
        const body = { version: "apn.circle-cleanup86-first-failure.v1", intentHash: i.intentHash, code, ...publicDetails };
        await this.writeJson(this.path(op, "first-failure"), { ...body, failureHash: hashObject(body) }, true);
    }
}
//# sourceMappingURL=cleanup86-store.js.map