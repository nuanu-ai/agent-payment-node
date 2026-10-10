import { Cleanup85UnsignedRetirementStore } from "../circle-cleanup85-unsigned-retirement-store.js";
import { StateStore } from "../state.js";
import { validateCleanup86CurrentPurpose, verifiedCleanup86CurrentPurpose, claimCleanup86CurrentStart, authenticateCleanup86CurrentHistory } from "./cleanup86-current-purpose.js";
import { verifyCleanup86RecoveryContext, verifiedCleanup86RecoveryContext } from "./cleanup85-effective-context.js";
import { hashObject, exactKeys, isPlainRecord } from "../canonical.js";
import { SecureStateStore } from "../secure-state-store.js";
import { circleBlocked, validateCircleEnvelope } from "./operation-model.js";
import { assertCleanup85Parent } from "./cleanup85-recovery-store.js";
import { Cleanup86SnapshotStore } from "./cleanup86-snapshot.js";
import { sanitizedCircleFailure } from "./public-failure-store.js";
const digest = (x) => typeof x === "string" && /^[a-f0-9]{64}$/u.test(x);
export function validateCleanup86Intent(value, recovery, context, current) {
    if (!isPlainRecord(value) || !exactKeys(value, ["version", "recoveryBinding", "cancellationProofHash", "envelope", "policies", "capturedAt", "windowEndsAt", "intentHash", ...(value.version === "apn.circle-cleanup86-intent.v2" ? ["retirementProofHash", "freshReadmissionHash"] : []), ...(["apn.circle-cleanup86-intent.v3", "apn.circle-cleanup86-intent.v4"].includes(String(value.version)) ? ["currentPurpose"] : []), ...(value.version === "apn.circle-cleanup86-intent.v4" ? ["unsignedPredecessor"] : [])]))
        circleBlocked("cleanup86_intent_shape");
    const i = value, { intentHash, ...body } = i;
    const successor = context?.retirementProofHash !== null && context?.retirementProofHash !== undefined;
    const currentPurpose = ["apn.circle-cleanup86-intent.v3", "apn.circle-cleanup86-intent.v4"].includes(i.version) ? (current === undefined ? circleBlocked("cleanup86_current_context_required") : validateCleanup86CurrentPurpose(i.currentPurpose, current.root, current.op, recovery, i.envelope)) : undefined;
    if (i.version === "apn.circle-cleanup86-intent.v4") {
        const p = i.unsignedPredecessor;
        if (!isPlainRecord(p) || !exactKeys(p, ["intentHash", "file", "rootIdentity", "directoryIdentity"]) || !digest(p.intentHash) || !digest(p.rootIdentity) || !digest(p.directoryIdentity) || !isPlainRecord(p.file) || !exactKeys(p.file, ["sha256", "dev", "ino", "uid", "mode", "nlink", "size", "mtimeMs", "ctimeMs"]) || !digest(p.file.sha256) || Object.entries(p.file).some(([k, v]) => k !== "sha256" && (typeof v !== "number" || !Number.isFinite(v) || v < 0)))
            circleBlocked("cleanup86_unsigned_predecessor_shape");
    }
    const authority = currentPurpose ?? (successor ? context.readmission : recovery);
    if (currentPurpose === undefined && i.version !== (successor ? "apn.circle-cleanup86-intent.v2" : "apn.circle-cleanup86-intent.v1") || currentPurpose === undefined && successor && (i.retirementProofHash !== context.retirementProofHash || i.freshReadmissionHash !== context.readmissionHash) || i.recoveryBinding !== recovery.recoveryBinding || !digest(i.cancellationProofHash) || currentPurpose !== undefined && i.cancellationProofHash !== currentPurpose.cancellationProofHash || intentHash !== hashObject(body) ||
        !Array.isArray(i.policies) || i.policies.length !== 2 || hashObject(i.policies) !== hashObject(authority.policies) || i.windowEndsAt !== authority.windowEndsAt || currentPurpose !== undefined && i.capturedAt !== currentPurpose.capturedAt || typeof i.capturedAt !== "string" || !Number.isFinite(Date.parse(i.capturedAt)) || new Date(i.capturedAt).toISOString() !== i.capturedAt)
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
    async context(op, recovery) { if (await new Cleanup85UnsignedRetirementStore(this.root).load() === null)
        return undefined; const state = new StateStore(this.root); return verifiedCleanup86RecoveryContext(await verifyCleanup86RecoveryContext(state, op, recovery), state, op, recovery); }
    generationPath(op) { return this.path(op, "generation-1-intent"); }
    async legacy(op, recovery) {
        const v = await this.readJson(this.path(op, "intent"));
        if (v === null)
            return null;
        const current = isPlainRecord(v) && v.version === "apn.circle-cleanup86-intent.v3";
        const intent = validateCleanup86Intent(v, recovery, current ? undefined : await this.context(op, recovery), { root: this.root, op });
        if (intent.version === "apn.circle-cleanup86-intent.v4")
            circleBlocked("cleanup86_legacy_path_version_changed");
        if (current)
            await authenticateCleanup86CurrentHistory(this.root, op, intent.currentPurpose);
        return intent;
    }
    async intent(op, recovery) {
        const legacy = await this.legacy(op, recovery), generation = await this.readJson(this.generationPath(op));
        for (const entry of await this.readDirectory("circle-cleanup85-recovery"))
            if (entry.name.startsWith(`${op.operationId}-cleanup86-generation-`) && entry.name !== `${op.operationId}-cleanup86-generation-1-intent.json`)
                circleBlocked("cleanup86_ambiguous_generation");
        if (generation === null)
            return legacy;
        if (legacy?.version !== "apn.circle-cleanup86-intent.v3")
            circleBlocked("cleanup86_unsigned_predecessor_required");
        const intent = validateCleanup86Intent(generation, recovery, undefined, { root: this.root, op });
        if (intent.version !== "apn.circle-cleanup86-intent.v4" || intent.unsignedPredecessor?.intentHash !== legacy.intentHash)
            circleBlocked("cleanup86_unsigned_predecessor_changed");
        await authenticateCleanup86CurrentHistory(this.root, op, intent.currentPurpose);
        await this.assertGeneration(op, intent);
        return intent;
    }
    /** A v3 orphan is eligible only with positive stable absence of every financial artifact.
     * This is inspection evidence, never signing authority; the normal command mints a new purpose. */
    async unsignedOrphan(op, recovery) {
        const legacy = await this.legacy(op, recovery);
        if (legacy?.version !== "apn.circle-cleanup86-intent.v3")
            circleBlocked("cleanup86_unsigned_predecessor_required");
        const snapshot = await new Cleanup86SnapshotStore(this.root).capture(op.operationId), names = Object.keys(snapshot.entries);
        if (names.length !== 1 || names[0] !== `${op.operationId}-cleanup86-intent.json` || hashObject(snapshot.entries[names[0]].value) !== hashObject(legacy))
            circleBlocked("cleanup86_existing_observe_only");
        return snapshot;
    }
    async assertGeneration(op, i) {
        if (i.version !== "apn.circle-cleanup86-intent.v4")
            return;
        const s = await new Cleanup86SnapshotStore(this.root).capture(op.operationId), p = i.unsignedPredecessor, prefix = `${op.operationId}-cleanup86-`, legacy = s.entries[`${prefix}intent.json`], selected = s.entries[`${prefix}generation-1-intent.json`];
        if (s.rootIdentity !== p.rootIdentity || s.directoryIdentity !== p.directoryIdentity || legacy === undefined || hashObject(legacy.identity) !== hashObject(p.file) || !isPlainRecord(legacy.value) || legacy.value.intentHash !== p.intentHash || selected === undefined || hashObject(selected.value) !== hashObject(i))
            circleBlocked("cleanup86_unsigned_predecessor_changed");
        for (const [name, entry] of Object.entries(s.entries)) {
            const kind = name.slice(prefix.length);
            if (["intent.json", "generation-1-intent.json"].includes(kind))
                continue;
            if (kind === "effect.json" || /^history-(0|[1-9][0-9]*)\.json$/u.test(kind)) {
                const e = validateCleanup86Effect(entry.value, i);
                if (kind.startsWith("history-") && kind !== `history-${e.sequence}.json`)
                    circleBlocked("cleanup86_history_changed");
                continue;
            }
            if (kind === "sign.json" || kind === "send.json") {
                await this.claimed(op, i, kind === "sign.json" ? "sign" : "send");
                continue;
            }
            if (kind === "first-failure.json") {
                await this.failure(op, i);
                continue;
            }
            if (kind === "material.json") {
                const h = entry.value;
                if (!isPlainRecord(h) || !exactKeys(h, ["version", "operationId", "intentHash", "recoveryBinding", "envelopeHash", "materialHash", "transactionHash", "salt", "nonce", "ciphertext", "tag"]) || h.version !== "apn.circle-cleanup86-envelope.v1" || h.operationId !== op.operationId || h.intentHash !== i.intentHash || h.recoveryBinding !== i.recoveryBinding || h.envelopeHash !== i.envelope.envelopeHash || !digest(h.materialHash) || typeof h.transactionHash !== "string" || !/^0x[a-f0-9]{64}$/u.test(h.transactionHash) || typeof h.ciphertext !== "string" || h.ciphertext.length === 0 || !await this.claimed(op, i, "sign"))
                    circleBlocked("cleanup86_material_metadata_changed");
                continue;
            }
            if (kind === "finalized-proof.json")
                continue; // Independently verified by the settlement observer.
            circleBlocked("cleanup86_unknown_artifact_observe_only");
        }
        const head = s.entries[`${prefix}effect.json`];
        const histories = Object.entries(s.entries).filter(([name]) => name.startsWith(`${prefix}history-`)).map(([, entry]) => validateCleanup86Effect(entry.value, i)).sort((a, b) => a.sequence - b.sequence);
        if ((head === undefined) !== (histories.length === 0) || histories.some((e, index) => e.sequence !== index || e.previousHash !== (index === 0 ? null : histories[index - 1].effectHash)) || head !== undefined && hashObject(head.value) !== hashObject(histories.at(-1)))
            circleBlocked("cleanup86_history_changed");
        if (this.ownedSnapshot !== undefined && hashObject(this.ownedSnapshot) !== hashObject(s))
            circleBlocked("cleanup86_snapshot_drift");
        const after = await new Cleanup86SnapshotStore(this.root).capture(op.operationId);
        if (hashObject(s) !== hashObject(after))
            circleBlocked("cleanup86_snapshot_drift");
    }
    async startReprepared(state, op, recovery, envelope, certificate, snapshot) {
        if (state.root !== this.root || hashObject(await this.unsignedOrphan(op, recovery)) !== hashObject(snapshot))
            circleBlocked("cleanup86_snapshot_drift");
        const purpose = verifiedCleanup86CurrentPurpose(certificate, state, op, recovery, envelope), legacy = snapshot.entries[`${op.operationId}-cleanup86-intent.json`];
        const body = { version: "apn.circle-cleanup86-intent.v4", recoveryBinding: recovery.recoveryBinding, cancellationProofHash: purpose.cancellationProofHash, envelope, policies: purpose.policies, capturedAt: purpose.capturedAt, windowEndsAt: purpose.windowEndsAt, currentPurpose: purpose, unsignedPredecessor: { intentHash: legacy.value.intentHash, file: legacy.identity, rootIdentity: snapshot.rootIdentity, directoryIdentity: snapshot.directoryIdentity } };
        const intent = validateCleanup86Intent({ ...body, intentHash: hashObject(body) }, recovery, undefined, { root: this.root, op });
        claimCleanup86CurrentStart(certificate, state, op, recovery, envelope);
        this.pendingPublication = { op, recovery, snapshot };
        try {
            await this.writeJson(this.generationPath(op), intent, true);
        }
        finally {
            this.pendingPublication = undefined;
        }
        await this.assertGeneration(op, intent);
        this.ownedSnapshot = await new Cleanup86SnapshotStore(this.root).capture(op.operationId);
        return intent;
    }
    pendingPublication;
    ownedSnapshot;
    async beforeCreateOnlyPublication(relativePath, _value) {
        const p = this.pendingPublication;
        if (p === undefined && this.ownedSnapshot !== undefined) {
            const opId = relativePath.slice("circle-cleanup85-recovery/".length, "circle-cleanup85-recovery/".length + 64);
            const current = await new Cleanup86SnapshotStore(this.root).capture(opId);
            if (hashObject(current) !== hashObject(this.ownedSnapshot))
                circleBlocked("cleanup86_snapshot_drift");
        }
        if (p !== undefined && relativePath === this.generationPath(p.op) && hashObject(await this.unsignedOrphan(p.op, p.recovery)) !== hashObject(p.snapshot))
            circleBlocked("cleanup86_snapshot_drift");
    }
    async rememberOwn(op, i, patches) {
        if (i.version !== "apn.circle-cleanup86-intent.v4" || this.ownedSnapshot === undefined)
            return;
        const next = await new Cleanup86SnapshotStore(this.root).capture(op.operationId), entries = { ...this.ownedSnapshot.entries };
        for (const [kind, value] of Object.entries(patches)) {
            const name = `${op.operationId}-cleanup86-${kind}.json`, found = next.entries[name];
            if (found === undefined || hashObject(found.value) !== hashObject(value))
                circleBlocked("cleanup86_snapshot_drift");
            entries[name] = found;
        }
        if (hashObject({ ...this.ownedSnapshot, entries }) !== hashObject(next))
            circleBlocked("cleanup86_snapshot_drift");
        this.ownedSnapshot = next;
    }
    async acceptSealedMaterial(op, i, material) {
        if (i.version !== "apn.circle-cleanup86-intent.v4")
            return;
        const header = await this.readJson(this.path(op, "material"));
        if (!isPlainRecord(header) || header.intentHash !== material.intentHash || header.envelopeHash !== material.envelopeHash || header.materialHash !== material.materialHash || header.transactionHash !== material.transactionHash)
            circleBlocked("cleanup86_material_metadata_changed");
        await this.rememberOwn(op, i, { material: header });
        await this.assertGeneration(op, i);
    }
    async start(op, recovery, body) {
        const old = await this.intent(op, recovery);
        if (old !== null)
            return old;
        const context = await this.context(op, recovery), successor = context !== undefined && context.retirementProofHash !== null;
        const frame = { version: successor ? "apn.circle-cleanup86-intent.v2" : "apn.circle-cleanup86-intent.v1", recoveryBinding: recovery.recoveryBinding, ...body, ...(successor ? { retirementProofHash: context.retirementProofHash, freshReadmissionHash: context.readmissionHash } : {}) }, i = validateCleanup86Intent({ ...frame, intentHash: hashObject(frame) }, recovery, context);
        await this.initialize();
        await this.ensureDirectory("circle-cleanup85-recovery");
        await this.writeJson(this.path(op, "intent"), i, true);
        return i;
    }
    async startCurrent(state, op, recovery, envelope, certificate) {
        if (state.root !== this.root)
            circleBlocked("cleanup86_current_root_changed");
        const purpose = verifiedCleanup86CurrentPurpose(certificate, state, op, recovery, envelope);
        for (const kind of ["intent", "effect", "sign", "send", "material", "first-failure"])
            if (await this.readJson(this.path(op, kind)) !== null)
                circleBlocked("cleanup86_existing_observe_only");
        // A journal can survive without its effect head or earlier sequence entries.
        // Any exact-parent history name, including an unsafe/corrupt entry, fences retry.
        for (const entry of await this.readDirectory("circle-cleanup85-recovery"))
            if (entry.name.startsWith(`${op.operationId}-cleanup86-history-`))
                circleBlocked("cleanup86_existing_observe_only");
        const body = { version: "apn.circle-cleanup86-intent.v3", recoveryBinding: recovery.recoveryBinding, cancellationProofHash: purpose.cancellationProofHash, envelope, policies: purpose.policies, capturedAt: purpose.capturedAt, windowEndsAt: purpose.windowEndsAt, currentPurpose: purpose };
        const intent = validateCleanup86Intent({ ...body, intentHash: hashObject(body) }, recovery, undefined, { root: this.root, op });
        verifiedCleanup86CurrentPurpose(certificate, state, op, recovery, envelope);
        claimCleanup86CurrentStart(certificate, state, op, recovery, envelope);
        await this.initialize();
        await this.ensureDirectory("circle-cleanup85-recovery");
        await this.writeJson(this.path(op, "intent"), intent, true);
        return intent;
    }
    async effect(op, i) { const v = await this.readJson(this.path(op, "effect")); return v === null ? null : validateCleanup86Effect(v, i); }
    async saveEffect(op, i, previous, patch) {
        await this.assertGeneration(op, i);
        const current = await this.effect(op, i);
        if (hashObject(current) !== hashObject(previous))
            circleBlocked("cleanup86_effect_concurrent_change");
        const body = { version: "apn.circle-cleanup86-effect.v1", intentHash: i.intentHash, phase: patch.phase, transactionHash: patch.transactionHash, materialHash: patch.materialHash, sequence: (previous?.sequence ?? -1) + 1, previousHash: previous?.effectHash ?? null }, e = validateCleanup86Effect({ ...body, effectHash: hashObject(body) }, i);
        await this.writeJson(this.path(op, `history-${e.sequence}`), e, true);
        await this.rememberOwn(op, i, { [`history-${e.sequence}`]: e });
        await this.writeJson(this.path(op, "effect"), e, previous === null);
        await this.rememberOwn(op, i, { effect: e });
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
        await this.assertGeneration(op, i);
        const { intentHash: _hash, ...body } = i;
        validateCircleEnvelope(i.envelope, "cleanup", 1329, null, "evm-live-seller");
        if (i.intentHash !== hashObject(body) || i.envelope.nonceAtomic !== "86" || BigInt(i.envelope.gasLimitAtomic) * BigInt(i.envelope.maxFeePerGasAtomic) > 15000000000000n || hashObject(await this.readJson(i.version === "apn.circle-cleanup86-intent.v4" ? this.generationPath(op) : this.path(op, "intent"))) !== hashObject(i))
            circleBlocked("cleanup86_claim_immutable_intent_changed");
        if (await this.claimed(op, i, boundary))
            circleBlocked("cleanup86_already_claimed_observe_only");
        if (boundary === "sign" && e.phase !== "signing_started" || boundary === "send" && (e.phase !== "submission_started" || e.transactionHash === null || !await this.claimed(op, i, "sign")))
            circleBlocked("cleanup86_claim_boundary");
        const claim = { version: "apn.circle-cleanup86-claim.v1", boundary, intentHash: i.intentHash, recoveryBinding: i.recoveryBinding, cancellationProofHash: i.cancellationProofHash, ...(boundary === "send" ? { transactionHash: e.transactionHash, materialHash: e.materialHash } : {}) };
        await this.writeJson(this.path(op, boundary), claim, true);
        await this.rememberOwn(op, i, { [boundary]: claim });
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
        const failure = { ...body, failureHash: hashObject(body) };
        await this.writeJson(this.path(op, "first-failure"), failure, true);
        await this.rememberOwn(op, i, { "first-failure": failure });
    }
}
//# sourceMappingURL=cleanup86-store.js.map