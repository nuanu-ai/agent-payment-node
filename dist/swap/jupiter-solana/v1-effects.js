import { createKeyPairSignerFromPrivateKeyBytes, signTransaction, address, getTransactionDecoder, getSignatureFromTransaction, getBase64EncodedWireTransaction, getPublicKeyFromAddress, verifySignature } from "@solana/kit";
import { canonicalJson, domainHash, exactKeys, isPlainRecord, sha256 } from "../../canonical.js";
import { ApnError } from "../../errors.js";
import { SecureStateStore, stateIdentifier } from "../../secure-state-store.js";
import { validateSwapOperation } from "../model.js";
import { validateJupiterV1PreparedMaterial, validateJupiterV1Material } from "./v1-material.js";
import { detached, jupiterV1AccountBindingHash } from "./v1-admission.js";
import { SwapOperationRepository } from "../repository.js";
import { loadActiveAssetPolicyRegistry } from "../../allowlist-active-policy.js";
import { guardJupiterV1WhirlpoolMaterial } from "./v1-guard.js";
import { ChainAccountStore } from "../../chain-account-store.js";
import { sealGuardedSwapApproval } from "../runtime.js";
import { exactChainConsent } from "../../tty-approval.js";
import { jupiterV1ApprovalScreen } from "./v1-tty.js";
import { approvalCode } from "../../approval-code.js";
const SCHEMA = "apn.jupiter-v1-execution-binding.v1";
export function createJupiterV1ExecutionBinding(operation, material, admission, simulation, checkedAt, fresh) {
    const body = { schemaVersion: SCHEMA, operationId: operation.operationId, markerHash: operation.submissionMarker.markerHash,
        quoteHash: operation.quote.quoteHash, materialDigest: material.execution.materialDigest, messageHash: material.execution.messageHash,
        unsignedPayload: material.execution.transactionBase64, accountBindingHash: admission.accountBindingHash, policyDigest: operation.policyDigest,
        activationDigest: admission.activationDigest, ownerAdmissionHash: admission.admissionHash, checkedAt: checkedAt.toISOString(), freshMaterialDigest: fresh.materialDigest, freshAdmissionDigest: simulation.admissionDigest, proofDigest: domainHash("apn.jupiter-v1-simulation-proof.v1", canonicalJson(simulation)), simulation };
    return validateJupiterV1ExecutionBinding({ ...body, bindingHash: domainHash(SCHEMA, canonicalJson(body)) }, operation, material);
}
export function validateJupiterV1ExecutionBinding(value, operationValue, materialValue) {
    const operation = validateSwapOperation(operationValue), material = validateJupiterV1PreparedMaterial(materialValue);
    if (!isPlainRecord(value) || !exactKeys(value, ["schemaVersion", "operationId", "markerHash", "quoteHash", "materialDigest", "messageHash", "unsignedPayload", "accountBindingHash", "policyDigest", "activationDigest", "ownerAdmissionHash", "checkedAt", "freshMaterialDigest", "freshAdmissionDigest", "proofDigest", "simulation", "bindingHash"]))
        corrupt();
    const b = value, { bindingHash, ...body } = b;
    if (b.schemaVersion !== SCHEMA || bindingHash !== domainHash(SCHEMA, canonicalJson(body)) || operation.submissionMarker === null ||
        b.operationId !== operation.operationId || b.markerHash !== operation.submissionMarker.markerHash || b.quoteHash !== operation.quote.quoteHash ||
        b.materialDigest !== material.execution.materialDigest || b.messageHash !== material.execution.messageHash || b.unsignedPayload !== material.execution.transactionBase64 ||
        b.policyDigest !== operation.policyDigest || ![b.accountBindingHash, b.activationDigest, b.ownerAdmissionHash].every(h => /^[a-f0-9]{64}$/u.test(h)) ||
        b.checkedAt < operation.submissionMarker.markedAt || b.checkedAt >= operation.quote.expiresAt || !Number.isFinite(Date.parse(b.checkedAt)) ||
        new Date(b.checkedAt).toISOString() !== b.checkedAt || b.freshAdmissionDigest !== b.simulation.admissionDigest || b.proofDigest !== domainHash("apn.jupiter-v1-simulation-proof.v1", canonicalJson(b.simulation)) || b.simulation.success !== true || b.simulation.messageHash !== b.messageHash ||
        BigInt(b.simulation.recipientOutputAtomic) < BigInt(operation.quote.minimumOutputAtomic) || BigInt(b.simulation.nativeSpendLamports) > BigInt(material.execution.maximumNativeExpenseLamports))
        corrupt();
    return detached(b);
}
/** Public hashes and signature only. Exact signed bytes stay in encrypted custody. Every create is fsynced. */
export class JupiterV1ExecutionBindingStore extends SecureStateStore {
    initialized;
    async save(op, value, m) {
        const checked = validateJupiterV1ExecutionBinding(value, op, m);
        await this.ready();
        return await this.withLocks([`jupiter-v1-binding:${op.operationId}`], async () => {
            const old = await this.readJson(this.path(op, "bindings"));
            if (old !== null) {
                const prior = validateJupiterV1ExecutionBinding(old, op, m);
                if (canonicalJson(prior) !== canonicalJson(checked))
                    corrupt();
                return prior;
            }
            await this.ensureDirectory(`jupiter-v1-bindings/${op.ownerProfileHash}`);
            await this.writeJson(this.path(op, "bindings"), checked, true);
            return checked;
        });
    }
    async load(op, m) { await this.ready(); const value = await this.readJson(this.path(op, "bindings")); return value === null ? null : validateJupiterV1ExecutionBinding(value, op, m); }
    async loadClaim(op) {
        await this.ready();
        const directory = `jupiter-v1-claims/${op.ownerProfileHash}`, name = `${op.operationId}.json`;
        if (!(await this.readDirectory(directory)).some(e => e.name === name))
            return null;
        const value = await this.readJson(this.path(op, "claims"));
        if (!isPlainRecord(value) || !exactKeys(value, ["schemaVersion", "operationId", "markerHash", "bindingHash", "signature", "rawPayloadHash", "claimedAt", "claimHash"]))
            corrupt();
        const claim = value, { claimHash, ...body } = claim;
        if (claim.schemaVersion !== "apn.jupiter-v1-send-claim.v1" || claim.operationId !== op.operationId || claim.markerHash !== op.submissionMarker?.markerHash ||
            claimHash !== domainHash(claim.schemaVersion, canonicalJson(body)) || !/^([1-9A-HJ-NP-Za-km-z]{64,88})$/u.test(claim.signature) ||
            ![claim.bindingHash, claim.rawPayloadHash].every(h => /^[a-f0-9]{64}$/u.test(h)) || !Number.isFinite(Date.parse(claim.claimedAt)) ||
            new Date(claim.claimedAt).toISOString() !== claim.claimedAt)
            corrupt();
        return detached(claim);
    }
    /** Caller holds the common Jupiter operation lock. Occupied invalid claims fail closed permanently. */
    async claim(op, b, effect, now) {
        if (await this.loadClaim(op) !== null)
            throw new ApnError("APN_OPERATION_BLOCKED", "Jupiter's first send was already claimed.");
        await verifySignedJupiterV1Transaction(effect, b);
        const body = { schemaVersion: "apn.jupiter-v1-send-claim.v1", operationId: op.operationId,
            markerHash: op.submissionMarker.markerHash, bindingHash: b.bindingHash, signature: effect.transactionId, rawPayloadHash: effect.rawPayloadHash, claimedAt: now.toISOString() };
        await this.ensureDirectory(`jupiter-v1-claims/${op.ownerProfileHash}`);
        await this.writeJson(this.path(op, "claims"), { ...body, claimHash: domainHash(body.schemaVersion, canonicalJson(body)) }, true);
    }
    async saveSignature(op, b, effect) {
        await this.ready();
        await verifySignedJupiterV1Transaction(effect, b);
        const body = { schemaVersion: "apn.jupiter-v1-signed-marker.v1", operationId: op.operationId, markerHash: op.submissionMarker.markerHash, bindingHash: b.bindingHash, signature: effect.transactionId, rawPayloadHash: effect.rawPayloadHash }, record = { ...body, recordHash: domainHash(body.schemaVersion, canonicalJson(body)) };
        await this.ensureDirectory(`jupiter-v1-signatures/${op.ownerProfileHash}`);
        const path = `jupiter-v1-signatures/${op.ownerProfileHash}/${op.operationId}.json`, old = await this.readJson(path);
        if (old !== null) {
            if (canonicalJson(old) !== canonicalJson(record))
                corrupt();
            return;
        }
        await this.writeJson(path, record, true);
    }
    async loadSignature(op, b) {
        await this.ready();
        const raw = await this.readJson(`jupiter-v1-signatures/${op.ownerProfileHash}/${op.operationId}.json`);
        if (raw === null)
            return null;
        if (!isPlainRecord(raw) || !exactKeys(raw, ["schemaVersion", "operationId", "markerHash", "bindingHash", "signature", "rawPayloadHash", "recordHash"]) || typeof raw.rawPayloadHash !== "string" || !/^[a-f0-9]{64}$/u.test(raw.rawPayloadHash) || raw.schemaVersion !== "apn.jupiter-v1-signed-marker.v1" || raw.operationId !== op.operationId || raw.markerHash !== op.submissionMarker.markerHash || raw.bindingHash !== b.bindingHash || typeof raw.signature !== "string" || !/^[1-9A-HJ-NP-Za-km-z]{64,88}$/u.test(raw.signature))
            corrupt();
        const { recordHash, ...body } = raw;
        if (recordHash !== domainHash(raw.schemaVersion, canonicalJson(body)))
            corrupt();
        return raw.signature;
    }
    async saveFresh(op, fresh, proof) {
        validateJupiterV1Material(fresh);
        await this.ready();
        const bytes = Buffer.from(canonicalJson({ fresh, proof })), chunks = [];
        if (bytes.length > 33554432)
            corrupt();
        await this.ensureDirectory("jupiter-v1-fresh/chunks");
        for (let offset = 0; offset < bytes.length; offset += 262144) {
            const chunk = bytes.subarray(offset, offset + 262144), hash = sha256(chunk), path = `jupiter-v1-fresh/chunks/${hash}.json`, content = { hash, dataBase64: chunk.toString("base64") };
            const old = await this.readJson(path);
            if (old === null)
                await this.writeJson(path, content, true);
            else if (canonicalJson(old) !== canonicalJson(content))
                corrupt();
            chunks.push({ hash, length: chunk.length });
        }
        await this.ensureDirectory(`jupiter-v1-fresh/${op.ownerProfileHash}`);
        const path = `jupiter-v1-fresh/${op.ownerProfileHash}/${op.operationId}.json`, manifest = { schemaVersion: "apn.jupiter-v1-fresh-evidence.v1", operationId: op.operationId, freshMaterialDigest: fresh.materialDigest, proofDigest: domainHash("apn.jupiter-v1-simulation-proof.v1", canonicalJson(proof)), length: bytes.length, serializedHash: sha256(bytes), chunks };
        const existing = await this.readJson(path);
        if (existing !== null) {
            if (canonicalJson(existing) !== canonicalJson(manifest))
                corrupt();
            return;
        }
        await this.writeJson(path, manifest, true);
    }
    async loadFresh(op, b) {
        await this.ready();
        const m = await this.readJson(`jupiter-v1-fresh/${op.ownerProfileHash}/${op.operationId}.json`);
        if (!isPlainRecord(m) || !exactKeys(m, ["schemaVersion", "operationId", "freshMaterialDigest", "proofDigest", "length", "serializedHash", "chunks"]) || typeof m.length !== "number" || !Number.isSafeInteger(m.length) || m.length < 1 || m.length > 33554432 || m.schemaVersion !== "apn.jupiter-v1-fresh-evidence.v1" || m.operationId !== op.operationId || m.freshMaterialDigest !== b.freshMaterialDigest || m.proofDigest !== b.proofDigest || !Array.isArray(m.chunks) || m.chunks.length > 128)
            corrupt();
        const chunks = [];
        for (const row of m.chunks) {
            if (!isPlainRecord(row) || !exactKeys(row, ["hash", "length"]) || typeof row.length !== "number" || !Number.isSafeInteger(row.length) || row.length < 1 || row.length > 262144 || typeof row.hash !== "string" || !/^[a-f0-9]{64}$/u.test(row.hash))
                corrupt();
            const raw = await this.readJson(`jupiter-v1-fresh/chunks/${row.hash}.json`);
            if (!isPlainRecord(raw) || !exactKeys(raw, ["hash", "dataBase64"]) || raw.hash !== row.hash || typeof raw.dataBase64 !== "string")
                corrupt();
            const bytes = Buffer.from(raw.dataBase64, "base64");
            if (bytes.toString("base64") !== raw.dataBase64 || bytes.length !== row.length || sha256(bytes) !== row.hash)
                corrupt();
            chunks.push(bytes);
        }
        const bytes = Buffer.concat(chunks);
        if (bytes.length !== m.length || sha256(bytes) !== m.serializedHash)
            corrupt();
        const value = JSON.parse(bytes.toString("utf8"));
        validateJupiterV1Material(value.fresh);
        if (value.fresh.materialDigest !== b.freshMaterialDigest || value.fresh.messageHash !== b.messageHash || value.fresh.transactionBase64 !== b.unsignedPayload ||
            domainHash("apn.jupiter-v1-simulation-proof.v1", canonicalJson(value.proof)) !== b.proofDigest)
            corrupt();
        return detached(value);
    }
    async bindPrepared(op, admission, material) {
        await this.ready();
        const body = { schemaVersion: "apn.jupiter-v1-prepared-owner.v1", operationId: op.operationId, quoteHash: op.quote.quoteHash,
            materialDigest: material.execution.materialDigest, accountBindingHash: admission.accountBindingHash, policyDigest: op.policyDigest,
            activationDigest: admission.activationDigest, runtimeCap: { authority: "runtime_cap", logicalPerStage: 64, cumulative: 192 }, maximumNativeExpenseLamports: material.execution.maximumNativeExpenseLamports };
        const record = { ...body, preparedHash: domainHash("apn.jupiter-v1-prepared-owner.v1", canonicalJson(body)) };
        await this.ensureDirectory(`jupiter-v1-prepared/${op.ownerProfileHash}`);
        const path = `jupiter-v1-prepared/${op.ownerProfileHash}/${op.operationId}.json`;
        await this.withLocks([`jupiter-v1-prepared:${op.operationId}`], async () => { const prior = await this.readJson(path); if (prior !== null) {
            if (canonicalJson(prior) !== canonicalJson(record))
                corrupt();
            return;
        } await this.writeJson(path, record, true); });
    }
    async assertPrepared(op, admission, material) {
        await this.ready();
        const value = await this.readJson(`jupiter-v1-prepared/${op.ownerProfileHash}/${op.operationId}.json`);
        if (!isPlainRecord(value) || value.operationId !== op.operationId || value.quoteHash !== op.quote.quoteHash || value.materialDigest !== material.execution.materialDigest ||
            value.accountBindingHash !== admission.accountBindingHash || value.policyDigest !== op.policyDigest || value.activationDigest !== admission.activationDigest ||
            value.maximumNativeExpenseLamports !== material.execution.maximumNativeExpenseLamports || canonicalJson(value.runtimeCap) !== canonicalJson({ authority: "runtime_cap", logicalPerStage: 64, cumulative: 192 }))
            corrupt();
        const { preparedHash, ...body } = value;
        if (preparedHash !== domainHash("apn.jupiter-v1-prepared-owner.v1", canonicalJson(body)))
            corrupt();
    }
    path(op, kind) { stateIdentifier(op.ownerProfileHash, "Jupiter profile"); stateIdentifier(op.operationId, "Jupiter operation"); return `jupiter-v1-${kind}/${op.ownerProfileHash}/${op.operationId}.json`; }
    async ready() { this.initialized ??= (async () => { await super.initialize(); await this.ensureDirectory("jupiter-v1-bindings"); await this.ensureDirectory("jupiter-v1-claims"); await this.ensureDirectory("jupiter-v1-prepared"); await this.ensureDirectory("jupiter-v1-fresh"); await this.ensureDirectory("jupiter-v1-signatures"); })(); await this.initialized; }
}
export async function verifySignedJupiterV1Transaction(effect, binding) {
    try {
        const bytes = Buffer.from(effect.rawPayload, "base64"), tx = getTransactionDecoder().decode(bytes), sig = tx.signatures[address(Object.keys(tx.signatures)[0])];
        const unsigned = getTransactionDecoder().decode(Buffer.from(binding.unsignedPayload, "base64")), owner = Object.keys(unsigned.signatures)[0];
        if (bytes.toString("base64") !== effect.rawPayload || sha256(effect.rawPayload) !== effect.rawPayloadHash || effect.fingerprint !== binding.bindingHash ||
            effect.operationId !== binding.operationId || Object.keys(tx.signatures).length !== 1 || Object.keys(tx.signatures)[0] !== owner || sig === null || sig === undefined ||
            sha256(new Uint8Array(tx.messageBytes)) !== binding.messageHash || getBase64EncodedWireTransaction(tx) !== effect.rawPayload ||
            getSignatureFromTransaction(tx) !== effect.transactionId || !await verifySignature(await getPublicKeyFromAddress(address(owner)), sig, tx.messageBytes))
            corrupt();
    }
    catch {
        corrupt();
    }
}
function corrupt() { throw new ApnError("APN_STATE_CORRUPT", "Jupiter V1 durable execution binding or signed message changed."); }
/** The finite local Jupiter signer owns the canonical software custody instance and its one-shot TTY grants. */
export class JupiterV1LocalSigner {
    static #instances = new WeakMap();
    static assertGenuine(value, root) { if (Object.getPrototypeOf(value) !== JupiterV1LocalSigner.prototype || this.#instances.get(value) !== root)
        corrupt(); }
    #custody;
    #grants = new WeakMap();
    #fence = null;
    #operationGrants = new Map();
    #approvedScreens = new Map();
    #sealedEffects = new Map();
    #root;
    constructor(root, wrappingSecret) {
        this.#root = root;
        JupiterV1LocalSigner.#instances.set(this, root);
        this.#custody = new ChainAccountStore(root, { load: async () => {
                await this.assertWrappingFence();
                const secret = await wrappingSecret.load();
                try {
                    await this.assertWrappingFence();
                    return secret;
                }
                catch (error) {
                    secret?.fill(0);
                    throw error;
                }
            }, create: async () => { throw new ApnError("APN_OPERATION_BLOCKED", "The finite Jupiter Native signer cannot create custody."); } });
        this.#bindings = new JupiterV1ExecutionBindingStore(root);
        this.#operations = new SwapOperationRepository(root);
    }
    #bindings;
    #operations;
    async publicOwner(profile, expected) {
        if (Object.getPrototypeOf(this.#custody) !== ChainAccountStore.prototype)
            corrupt();
        const account = await this.#custody.account(profile, "solana"), envelope = await this.#custody.ownerBinding(profile, "solana");
        if (account === null || envelope === null || canonicalJson(account) !== canonicalJson(envelope) || account.profile !== profile || account.rail !== "solana" ||
            account.network !== "mainnet" || account.provider !== "local" || account.custody !== "local_software" || expected !== undefined && account.address !== expected)
            corrupt();
        return detached(account);
    }
    /** The intent is detached synchronously before the first await. No returned artifact alone authorizes signing. */
    async approve(operationValue, materialValue, admissionValue) {
        const operation = detached(validateSwapOperation(operationValue)), material = detached(validateJupiterV1PreparedMaterial(materialValue)), admission = detached(admissionValue);
        const intent = detached({ operationId: operation.operationId, profile: operation.quote.profile, account: operation.quote.account, recipient: operation.quote.recipient,
            inputAmountAtomic: operation.quote.inputAmountAtomic, expectedOutputAtomic: operation.quote.expectedOutputAtomic, minimumOutputAtomic: operation.quote.minimumOutputAtomic,
            slippageBps: operation.quote.slippageBps, gasOrEnergy: material.gasOrEnergy, deadline: operation.quote.expiresAt, quoteHash: operation.quote.quoteHash,
            policyDigest: operation.policyDigest, mechanismDigest: operation.mechanismDigest, protocolRegistryDigest: operation.protocolRegistryDigest });
        if (!["awaiting_approval", "reserved"].includes(operation.state) || operation.operationId !== intent.operationId || operation.quote.quoteHash !== intent.quoteHash ||
            operation.quote.profile !== intent.profile || operation.quote.account !== intent.account || operation.policyDigest !== intent.policyDigest ||
            canonicalJson(operation.quote) !== canonicalJson(material.quote) || operation.mechanismDigest !== intent.mechanismDigest ||
            canonicalJson(material.gasOrEnergy) !== canonicalJson(intent.gasOrEnergy))
            corrupt();
        const authoritative = await this.#operations.loadAny(operation.operationId);
        if (authoritative === null || canonicalJson(authoritative) !== canonicalJson(operation))
            corrupt();
        await this.#bindings.assertPrepared(authoritative, admission, material);
        await this.assertPolicy(intent.profile, intent.account, operation.policyDigest, admission.activationDigest);
        const owner = await this.publicOwner(intent.profile, intent.account);
        if (jupiterV1AccountBindingHash(owner) !== admission.accountBindingHash)
            corrupt();
        const lines = detached(await jupiterV1ApprovalScreen(material, intent));
        const screenHash = domainHash("apn.jupiter-v1-native-tty.v1", canonicalJson({ operationId: operation.operationId, quote: operation.quote, owner,
            admission, materialDigest: material.execution.materialDigest, intent, lines, runtimeCap: { logicalPerStage: 64, cumulative: 192, authority: "runtime_cap" } }));
        await exactChainConsent(lines, approvalCode("swap", operation.operationId, screenHash), intent.deadline, {});
        const after = await this.#operations.loadAny(operation.operationId);
        if (after === null || canonicalJson(after) !== canonicalJson(operation))
            corrupt();
        const current = await this.publicOwner(intent.profile, intent.account);
        if (jupiterV1AccountBindingHash(current) !== admission.accountBindingHash)
            corrupt();
        await this.assertPolicy(intent.profile, intent.account, operation.policyDigest, admission.activationDigest);
        const artifact = sealGuardedSwapApproval(intent, new Date(), screenHash);
        const grant = Object.freeze({ kind: "jupiter-v1-foreground-grant" });
        this.#operationGrants.set(operation.operationId, grant);
        this.#grants.set(grant, Object.freeze({ ownerHash: admission.accountBindingHash, quoteHash: operation.quote.quoteHash, policyDigest: operation.policyDigest, activationDigest: admission.activationDigest, screenHash }));
        this.#approvedScreens.set(operation.operationId, screenHash);
        return artifact;
    }
    async sign(operationValue, bindingValue, materialValue, admissionValue) {
        const operation = detached(validateSwapOperation(operationValue)), material = detached(validateJupiterV1PreparedMaterial(materialValue)), binding = detached(validateJupiterV1ExecutionBinding(bindingValue, operation, material)), admission = detached(admissionValue);
        validateJupiterV1ExecutionBinding(binding, operation, material);
        const authoritative = await this.#operations.loadAny(operation.operationId);
        if (authoritative === null || canonicalJson(authoritative) !== canonicalJson(operation))
            corrupt();
        const stored = await this.#bindings.load(authoritative, material);
        if (stored === null || canonicalJson(stored) !== canonicalJson(binding))
            corrupt();
        const { fresh, proof } = await this.#bindings.loadFresh(authoritative, binding);
        const guard = await guardJupiterV1WhirlpoolMaterial(fresh, { deadline: operation.quote.expiresAt });
        if (guard.admissionDigest !== binding.freshAdmissionDigest || proof.messageHash !== binding.messageHash || fresh.maximumNativeExpenseLamports !== material.execution.maximumNativeExpenseLamports)
            corrupt();
        await this.assertActive(operation, binding);
        const token = this.#operationGrants.get(operation.operationId), grant = token === undefined ? undefined : this.#grants.get(token);
        this.#operationGrants.delete(operation.operationId);
        if (token !== undefined)
            this.#grants.delete(token);
        if (grant === undefined || grant.ownerHash !== binding.accountBindingHash || grant.quoteHash !== binding.quoteHash || grant.policyDigest !== binding.policyDigest ||
            grant.activationDigest !== admission.activationDigest || grant.screenHash !== this.#approvedScreens.get(operation.operationId) || admission.accountBindingHash !== binding.accountBindingHash)
            throw new ApnError("APN_FOREGROUND_APPROVAL_REQUIRED", "The exact first Jupiter signature requires this genuine foreground TTY session.");
        const account = await this.publicOwner(operation.quote.profile, operation.quote.account);
        if (jupiterV1AccountBindingHash(account) !== binding.accountBindingHash)
            corrupt();
        await this.assertActive(operation, binding);
        this.#fence = { operation, binding };
        // requiredSecret rechecks the public file and envelope header before loading Keychain and decrypting.
        const effect = await this.#custody.withSeed(account, async (seed) => {
            const current = await this.publicOwner(operation.quote.profile, operation.quote.account);
            if (jupiterV1AccountBindingHash(current) !== binding.accountBindingHash)
                corrupt();
            await this.assertActive(operation, binding);
            const signer = await createKeyPairSignerFromPrivateKeyBytes(seed);
            if (signer.address !== account.address)
                corrupt();
            const unsigned = getTransactionDecoder().decode(Buffer.from(binding.unsignedPayload, "base64"));
            const signed = await signTransaction([signer.keyPair], unsigned), rawPayload = getBase64EncodedWireTransaction(signed);
            return { operationId: operation.operationId, fingerprint: binding.bindingHash, transactionId: getSignatureFromTransaction(signed), rawPayload, rawPayloadHash: sha256(rawPayload) };
        });
        await verifySignedJupiterV1Transaction(effect, binding);
        await this.#bindings.saveSignature(operation, binding, effect);
        await this.#custody.saveEffect(account, effect);
        this.#sealedEffects.set(operation.operationId, { bindingHash: binding.bindingHash, screenHash: grant.screenHash, effect: detached(effect) });
        return effect;
    }
    async assertWrappingFence() {
        const fence = this.#fence;
        if (fence === null)
            corrupt();
        const op = await this.#operations.loadAny(fence.operation.operationId);
        if (op === null || canonicalJson(op) !== canonicalJson(fence.operation) || op.submissionMarker === null)
            corrupt();
        const owner = await this.publicOwner(op.quote.profile, op.quote.account);
        if (jupiterV1AccountBindingHash(owner) !== fence.binding.accountBindingHash)
            corrupt();
        await this.assertActive(op, fence.binding);
        if (new Date().toISOString() >= op.quote.expiresAt)
            corrupt();
    }
    async assertDispatchAdmission(operation, binding) {
        const op = detached(operation), b = detached(binding), current = await this.#operations.loadAny(op.operationId);
        if (current === null || current.integrityHash !== op.integrityHash || current.state !== "submitting")
            corrupt();
        const owner = await this.publicOwner(op.quote.profile, op.quote.account);
        if (jupiterV1AccountBindingHash(owner) !== b.accountBindingHash)
            corrupt();
        await this.assertActive(op, b);
    }
    async assertPolicy(profile, owner, policyDigest, activationDigest) {
        const active = await loadActiveAssetPolicyRegistry(this.#root, profile, new Date());
        if (active === null || active.digest !== policyDigest || active.activationDigest !== activationDigest || active.accounts.solana !== owner)
            corrupt();
    }
    async assertActive(op, b) { await this.assertPolicy(op.quote.profile, op.quote.account, b.policyDigest, b.activationDigest); }
    hasForegroundGrant(operation) { const token = this.#operationGrants.get(operation.operationId), g = token === undefined ? undefined : this.#grants.get(token); return g !== undefined && g.quoteHash === operation.quote.quoteHash && g.policyDigest === operation.policyDigest; }
    async savedEffect(operation, binding) {
        const sealed = this.#sealedEffects.get(operation.operationId);
        if (sealed === undefined || sealed.bindingHash !== binding.bindingHash || sealed.screenHash !== this.#approvedScreens.get(operation.operationId))
            return null;
        const authoritative = await this.#operations.loadAny(operation.operationId);
        if (authoritative === null || canonicalJson(authoritative) !== canonicalJson(operation) || operation.state !== "submitting")
            corrupt();
        const signature = await this.#bindings.loadSignature(authoritative, binding);
        if (signature !== sealed.effect.transactionId)
            corrupt();
        const account = await this.publicOwner(operation.quote.profile, operation.quote.account);
        if (jupiterV1AccountBindingHash(account) !== binding.accountBindingHash)
            corrupt();
        await verifySignedJupiterV1Transaction(sealed.effect, binding);
        return detached(sealed.effect);
    }
}
//# sourceMappingURL=v1-effects.js.map