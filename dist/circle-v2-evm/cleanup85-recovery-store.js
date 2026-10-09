import { exactKeys, hashObject, isPlainRecord, canonicalJson, sha256 } from "../canonical.js";
import { validateEvmNativeCustody } from "../evm-native-custody.js";
import { SecureStateStore } from "../secure-state-store.js";
import { assertConsumedBurnIdentity, SEALED_BURN_OPERATION } from "./burn-retirement.js";
import { circleRetirementBinding } from "./nonce-retirement-store.js";
import { assertConsumedBurnEvidence } from "./consumed-burn-rpc.js";
import { circleBlocked } from "./operation-model.js";
export const CLEANUP85_HASH = "0x24cb1b6244a30ca2a829b4f561c907565d49aad806735137e3160ae0f7f03b95";
export const CLEANUP85_MATERIAL = "737b794790d7867a18e90d15033f72c1177cc5204a7b2cff699687cb4aa03468";
export const CLEANUP85_ENVELOPE = "62e62f220a1afbf65889ab0edfbc090c3b67bc4d5f9b161ec8e33dc8137a3583";
export function assertCleanup85Parent(op, observedOriginal = false) {
    assertConsumedBurnIdentity(op);
    const e = op.effects.find(x => x.role === "cleanup");
    if (op.effects.length !== 3 || e?.phase !== "unknown" || e.transactionHash !== CLEANUP85_HASH || e.materialHash !== CLEANUP85_MATERIAL || e.envelope.envelopeHash !== CLEANUP85_ENVELOPE || e.envelope.nonceAtomic !== "85" || e.proof !== null ||
        !observedOriginal && op.transitions.some(t => /^cleanup_(?:submission|submitted)/u.test(t.reason)) || !op.transitions.some(t => t.reason === "cleanup_material_sealed"))
        circleBlocked("exact_unknown_cleanup85_parent_required");
}
export function cleanup85CancellationRequest(intent) {
    return { parentOperationId: SEALED_BURN_OPERATION, parentIntentHash: intent.parentIntentHash, recoveryBinding: intent.recoveryBinding, oldCleanupTransactionHash: CLEANUP85_HASH, oldCleanupMaterialHash: CLEANUP85_MATERIAL, oldCleanupEnvelopeHash: CLEANUP85_ENVELOPE };
}
const instant = (v) => typeof v === "string" && Number.isFinite(Date.parse(v)) && new Date(v).toISOString() === v;
export function validateCleanup85RecoveryIntent(value, op, parent) {
    assertCleanup85Parent(op);
    if (!isPlainRecord(value) || !exactKeys(value, ["version", "parentOperationId", "parentIntentHash", "parentBinding", "parentPrefix", "sourceCustody", "destinationCustody", "recipientCustody", "policies", "capturedAt", "windowEndsAt", "evidence", "recoveryBinding"]))
        circleBlocked("cleanup85_recovery_intent_shape");
    const i = value, { recoveryBinding, ...body } = i;
    if (i.version !== "apn.circle-cleanup85-recovery.v1" || i.parentOperationId !== SEALED_BURN_OPERATION || i.parentIntentHash !== parent.intentHash || parent.version !== "apn.circle-consumed-burn-retirement.v1" || parent.cleanupEnvelope.envelopeHash !== CLEANUP85_ENVELOPE || i.parentBinding !== circleRetirementBinding(op) || recoveryBinding !== hashObject(body) ||
        !Array.isArray(i.parentPrefix) || i.parentPrefix.length < 14 || i.parentPrefix.some((x, n) => x !== op.transitions[n]?.snapshotHash) || hashObject(i.sourceCustody) !== hashObject(op.sourceCustody) || hashObject(i.destinationCustody) !== hashObject(op.destinationCustody) ||
        !instant(i.capturedAt) || i.windowEndsAt !== null && !instant(i.windowEndsAt) || !Array.isArray(i.policies) || i.policies.length !== 2 || new Set(i.policies.map(p => p.profileHash)).size !== 2)
        circleBlocked("cleanup85_recovery_intent_binding");
    for (const p of i.policies)
        if (!isPlainRecord(p) || !exactKeys(p, ["profile", "profileHash", "policyDigest", "revision", "activationDigest"]) || typeof p.profile !== "string" || ![op.profile, op.destinationProfile].includes(p.profile) || p.profileHash !== (p.profile === op.profile ? op.profileHash : op.destinationProfileHash) || ![p.policyDigest, p.activationDigest].every(x => typeof x === "string" && /^[a-f0-9]{64}$/u.test(x)) || typeof p.revision !== "number" || !Number.isSafeInteger(p.revision) || p.revision < 1)
            circleBlocked("cleanup85_recovery_policy_shape");
    validateEvmNativeCustody(i.recipientCustody);
    if (i.recipientCustody.walletAddress !== "0x0B4Dd0C3dA001Fa146EEd3f80B01860BEF6B8a14" || i.recipientCustody.profileHash !== sha256("profile\0default"))
        circleBlocked("cleanup85_default_recipient_changed");
    assertConsumedBurnEvidence(i.evidence, op);
    return i;
}
export function assertCleanup85Window(i, now) {
    if (now < Date.parse(i.capturedAt) || i.windowEndsAt !== null && now >= Date.parse(i.windowEndsAt))
        circleBlocked("cleanup85_recovery_policy_window_expired");
}
export class Cleanup85RecoveryStore extends SecureStateStore {
    path(id, suffix = "intent") { if (id !== SEALED_BURN_OPERATION)
        circleBlocked("finite_cleanup85_recovery_only"); return `circle-cleanup85-recovery/${id}-${suffix}.json`; }
    async load(op, parent) {
        const value = await this.readJson(this.path(op.operationId));
        return value === null ? null : validateCleanup85RecoveryIntent(value, op, parent);
    }
    async start(op, parent, frame) {
        const existing = await this.load(op, parent);
        if (existing !== null)
            return existing;
        const body = { version: "apn.circle-cleanup85-recovery.v1", parentOperationId: SEALED_BURN_OPERATION, parentIntentHash: parent.intentHash, parentBinding: circleRetirementBinding(op), parentPrefix: op.transitions.map(t => t.snapshotHash), ...frame };
        const intent = validateCleanup85RecoveryIntent({ ...body, recoveryBinding: hashObject(body) }, op, parent);
        await this.initialize();
        await this.ensureDirectory("circle-cleanup85-recovery");
        await this.writeJson(this.path(op.operationId), intent, true);
        return intent;
    }
    async assertRetainedMaterialHeaders(op, observedOriginal = false) {
        assertCleanup85Parent(op, observedOriginal);
        for (const effect of op.effects) {
            const header = await this.readJson(`circle-v2-evm-effects/${op.operationId}-${effect.role}.json`);
            if (!isPlainRecord(header) || !exactKeys(header, ["schemaVersion", "operationId", "role", "fingerprint", "envelopeHash", "salt", "nonce", "ciphertext", "tag"]) || header.schemaVersion !== "apn.circle-v2-evm-effect-envelope.v1" || header.operationId !== op.operationId || header.role !== effect.role || header.fingerprint !== op.fingerprint || header.envelopeHash !== effect.envelope.envelopeHash || typeof header.ciphertext !== "string" || header.ciphertext.length === 0)
                circleBlocked("cleanup85_retained_material_header_required");
        }
    }
    async publicRecord(op, suffix) { return this.readJson(this.path(op.operationId, suffix)); }
    async createPublicRecord(op, suffix, value) {
        const current = await this.publicRecord(op, suffix);
        if (current !== null) {
            if (canonicalJson(current) !== canonicalJson(value))
                circleBlocked("cleanup85_recovery_record_replacement");
            return;
        }
        await this.initialize();
        await this.ensureDirectory("circle-cleanup85-recovery");
        await this.writeJson(this.path(op.operationId, suffix), value, true);
    }
}
//# sourceMappingURL=cleanup85-recovery-store.js.map