import { canonicalJson, domainHash, exactKeys, isPlainRecord } from "../canonical.js";
import { evaluateAssetPolicy, validateAssetPolicyRegistry } from "../asset-policy-registry.js";
import { ApnError } from "../errors.js";
import { SecureStateStore, stateIdentifier } from "../secure-state-store.js";
import { validateSwapOperation } from "./model.js";
import { requireSwapProtocol, validateSwapProtocolRegistry } from "./protocol-registry.js";
import { swapMechanismDigest } from "./pin.js";
import { validateSwapQuote } from "./quote.js";
import { SwapOperationRepository } from "./repository.js";
import { GuardedSwapService } from "./service.js";
export const GUARDED_SWAP_APPROVAL_SCHEMA = "apn.guarded-swap-approval.v1";
export class GuardedSwapApprovalRepository extends SecureStateStore {
    initialized;
    async store(operationValue, artifactValue) {
        const operation = validateSwapOperation(operationValue), artifact = validateGuardedSwapApprovalArtifact(artifactValue, operation);
        await this.ready();
        return await this.withLocks([`swap-approval:${operation.operationId}`], async () => {
            const existing = await this.readJson(this.path(operation));
            if (existing !== null) {
                const prior = validateGuardedSwapApprovalArtifact(existing, operation);
                if (prior.artifactHash !== artifact.artifactHash)
                    blocked("A different guarded swap approval already exists.", "swap_approval_replay");
                return prior;
            }
            await this.ensureDirectory(`swap-approvals/${operation.ownerProfileHash}`);
            await this.writeJson(this.path(operation), artifact, true);
            return artifact;
        });
    }
    async load(operationValue) {
        const operation = validateSwapOperation(operationValue);
        await this.ready();
        const value = await this.readJson(this.path(operation));
        return value === null ? null : validateGuardedSwapApprovalArtifact(value, operation);
    }
    path(operation) {
        stateIdentifier(operation.ownerProfileHash, "swap approval profile");
        stateIdentifier(operation.operationId, "swap approval operation");
        return `swap-approvals/${operation.ownerProfileHash}/${operation.operationId}.json`;
    }
    async ready() {
        this.initialized ??= (async () => { await super.initialize(); await this.ensureDirectory("swap-approvals"); })();
        await this.initialized;
    }
}
/** Explicitly injected command runtime. Installed builds do not construct this class by default. */
export class GuardedSwapRuntime {
    dependencies;
    service;
    constructor(dependencies) {
        this.dependencies = dependencies;
        assertDependencyObject(dependencies);
        this.service = new GuardedSwapService(dependencies.operations, dependencies.usage);
    }
    async quote(request, now) { instant(now); return await this.dependencies.builder.quote({ ...request, now }); }
    async prepare(request, now) {
        request = immutableSnapshot(request);
        const material = await this.material(request.quoteHash);
        const quote = validateSwapQuote(material.quote, "input");
        if (quote.profile !== request.profile || quote.quoteHash !== request.quoteHash || quote.sourceAsset.chain !== this.dependencies.chain ||
            quote.destinationAsset.chain !== this.dependencies.chain)
            blocked("Prepared quote does not match the exact profile, hash, or chain.", "swap_quote_binding");
        const assetPolicy = await this.activePolicy(request.profile);
        // The core re-derives the identical quote hash from the unsealed input; bindMaterial later proves equality.
        const { schemaVersion: _schema, profileHash: _profile, quoteHash: _hash, ...input } = quote;
        return await this.service.prepare({ quote: input, assetPolicy,
            protocolRegistry: this.dependencies.protocolRegistry, idempotencyKey: request.idempotencyKey,
            approvalCapAtomic: material.approvalCapAtomic, now });
    }
    async approve(operationId, now) {
        const caps = immutableSnapshot(this.dependencies.caps);
        const operation = await this.required(operationId);
        if (operation.state !== "awaiting_approval")
            blocked("Guarded swap is not awaiting foreground approval.", "swap_approval_state");
        instant(now);
        const material = await this.material(operation.quote.quoteHash);
        bindMaterial(operation, material);
        await this.assertCurrentPolicy(operation);
        await this.dependencies.ownerAdmission.assert(operation, material);
        const intent = immutableSnapshot(approvalIntent(operation, material));
        const binding = domainHash("apn.guarded-swap-consent-binding.v1", canonicalJson({ operation, material, intent, caps }));
        const answer = await this.dependencies.foregroundApproval.approve(intent);
        // The human may type for a while: validate against a fresh clock, and reserve at the sealed consent instant.
        const artifact = immutableSnapshot(validateGuardedSwapApprovalArtifact(immutableSnapshot(answer), operation, intent, this.now()));
        await this.dependencies.ownerAdmission.assert(operation, material);
        const current = await this.required(operationId), currentMaterial = await this.material(operation.quote.quoteHash);
        bindMaterial(current, currentMaterial);
        if (binding !== domainHash("apn.guarded-swap-consent-binding.v1", canonicalJson({ operation: current, material: currentMaterial, intent: approvalIntent(current, currentMaterial),
            caps: immutableSnapshot(this.dependencies.caps) })))
            blocked("Prepared swap approval binding changed during consent.", "swap_material_drift");
        const policy = await this.assertCurrentPolicy(operation);
        validateGuardedSwapApprovalArtifact(artifact, operation, intent, this.now());
        const reserved = await this.service.reserve(operation, policy, new Date(artifact.approvedAt));
        await this.dependencies.approvals.store(reserved, artifact);
        return reserved;
    }
    /** The foreground CLI folds consent and the single send into one command. MCP never reaches this method. */
    async approveAndExecute(operationId, now) {
        const reserved = await this.approve(operationId, now);
        return await this.execute(reserved.operationId, this.now());
    }
    async execute(operationId, now) {
        const operation = await this.required(operationId);
        instant(now);
        if (operation.submissionMarker !== null)
            return await this.observe(operation);
        if (operation.state !== "reserved" || operation.usageLease?.state !== "reserved") {
            blocked("Guarded swap execution requires the exact approved reservation.", "swap_execution_lease");
        }
        const loadedArtifact = await this.dependencies.approvals.load(operation), at = this.now();
        const artifact = loadedArtifact === null ? null : immutableSnapshot(loadedArtifact);
        if (artifact === null || at.toISOString() >= operation.quote.expiresAt) {
            // Nothing was signed: without surviving consent, or past the deadline, the reservation is released, never kept.
            return await this.service.failBeforeEffect(operation, at, domainHash("apn.guarded-swap-unsent-release.v1", canonicalJson({
                operationId: operation.operationId, integrityHash: operation.integrityHash, reason: artifact === null ? "approval_missing" : "quote_expired"
            })));
        }
        validateGuardedSwapApprovalArtifact(artifact, operation, undefined, at);
        const material = await this.material(operation.quote.quoteHash);
        bindMaterial(operation, material);
        const dependencies = effectDependencies(this.dependencies);
        await this.dependencies.ownerAdmission.assert(operation, material);
        const current = await this.required(operationId), currentMaterial = await this.material(operation.quote.quoteHash);
        if (canonicalJson(current) !== canonicalJson(operation) || canonicalJson(currentMaterial) !== canonicalJson(material) ||
            canonicalJson(dependencies.caps) !== canonicalJson(this.dependencies.caps))
            blocked("Prepared swap execution binding changed.", "swap_material_drift");
        await this.assertCurrentPolicy(operation);
        validateGuardedSwapApprovalArtifact(artifact, operation, approvalIntent(operation, material), this.now());
        const result = validateSwapOperation(await this.dependencies.execution.execute({ operation, material, approval: artifact,
            dependencies, now: this.now() }));
        if (result.operationId !== operation.operationId || result.submissionMarker === null) {
            throw new ApnError("APN_STATE_CORRUPT", "Guarded swap execution returned without its durable submission marker.");
        }
        return result;
    }
    async status(operationId, now) {
        const operation = await this.required(operationId);
        instant(now);
        return operation.submissionMarker === null ? operation : await this.observe(operation);
    }
    async observe(operation) {
        const material = await this.material(operation.quote.quoteHash);
        bindMaterial(operation, material);
        const result = validateSwapOperation(await this.dependencies.execution.observe({ operation, material,
            dependencies: effectDependencies(this.dependencies), now: this.now() }));
        if (result.operationId !== operation.operationId || result.submissionMarker === null) {
            throw new ApnError("APN_STATE_CORRUPT", "Guarded swap observation lost its durable submission marker.");
        }
        return result;
    }
    now() { const value = this.dependencies.clock.now(); instant(value); return value; }
    async activePolicy(profile) {
        const policy = await this.dependencies.policy(profile);
        if (policy === null)
            blocked("No active owner swap admission is installed for this profile.", "swap_owner_admission_required");
        return immutableSnapshot(validateAssetPolicyRegistry(immutableSnapshot(policy)));
    }
    async assertCurrentPolicy(operation) {
        const policy = await this.activePolicy(operation.quote.profile), at = this.now().toISOString();
        if (policy.policyDigest !== operation.policyDigest || policy.registryVersion !== operation.policyVersion)
            blocked("Swap asset policy no longer matches the prepared operation.", "swap_policy_drift");
        for (const [asset, amount] of [[operation.quote.sourceAsset, operation.quote.inputAmountAtomic],
            [operation.quote.destinationAsset, operation.quote.minimumOutputAtomic]]) {
            const admission = evaluateAssetPolicy(policy, { chain: asset.chain, asset: asset.kind === "native" ?
                    { kind: "native", identifier: null } : { kind: "token", identifier: asset.identifier }, rail: "swap",
                amountAtomic: amount, dailyUsageAtomic: "0", asOfDate: at.slice(0, 10), asOf: at });
            const pin = admission.asset.mechanismPins?.swap;
            if (pin === undefined || swapMechanismDigest(pin) !== operation.mechanismDigest)
                blocked("Swap mechanism admission changed.", "swap_policy_drift");
        }
        const registry = validateSwapProtocolRegistry(immutableSnapshot(this.dependencies.protocolRegistry));
        if (registry.registryDigest !== operation.protocolRegistryDigest || registry.registryVersion !== operation.protocolRegistryVersion)
            blocked("Swap protocol registry changed.", "swap_policy_drift");
        requireSwapProtocol(registry, operation.mechanismDigest);
        return policy;
    }
    async required(operationId) {
        const loaded = await this.dependencies.operations.loadAny(operationId);
        if (loaded === null)
            throw new ApnError("APN_OPERATION_NOT_FOUND", "Swap operation was not found.");
        const operation = validateSwapOperation(immutableSnapshot(loaded));
        if (operation.quote.sourceAsset.chain !== this.dependencies.chain)
            blocked("Swap operation belongs to another runtime.", "swap_runtime_chain");
        return operation;
    }
    async material(hash) {
        const material = await this.dependencies.builder.load(hash);
        if (material === null)
            throw new ApnError("APN_OPERATION_NOT_FOUND", "Prepared swap quote was not found.");
        const snapshot = immutableSnapshot(material);
        validateSwapQuote(snapshot.quote, "input");
        validateGasOrEnergy(snapshot.gasOrEnergy);
        return snapshot;
    }
}
export function sealGuardedSwapApproval(intent, approvedAt, verifierProofHash) {
    const at = instant(approvedAt);
    hash(verifierProofHash);
    const body = { schemaVersion: GUARDED_SWAP_APPROVAL_SCHEMA, ...intent,
        approvedAt: at, expiresAt: intent.deadline, verifierProofHash };
    return { ...body, artifactHash: domainHash(GUARDED_SWAP_APPROVAL_SCHEMA, canonicalJson(body)) };
}
export function validateGuardedSwapApprovalArtifact(value, operation, expected, now) {
    if (!isPlainRecord(value) || !exactKeys(value, ["schemaVersion", "operationId", "profile", "account", "recipient",
        "inputAmountAtomic", "expectedOutputAtomic", "minimumOutputAtomic", "slippageBps", "gasOrEnergy", "deadline", "quoteHash",
        "policyDigest", "mechanismDigest", "protocolRegistryDigest", "approvedAt", "expiresAt", "verifierProofHash", "artifactHash"]) ||
        value.schemaVersion !== GUARDED_SWAP_APPROVAL_SCHEMA)
        blocked("Guarded swap approval artifact is invalid.", "swap_approval_tamper");
    const artifact = value, { artifactHash, ...body } = artifact;
    hash(artifact.verifierProofHash);
    hash(artifact.artifactHash);
    validateGasOrEnergy(artifact.gasOrEnergy);
    if (artifactHash !== domainHash(GUARDED_SWAP_APPROVAL_SCHEMA, canonicalJson(body)) ||
        canonicalJson(approvalIntent(operation, { gasOrEnergy: artifact.gasOrEnergy })) !== canonicalJson(stripArtifact(artifact)) ||
        (expected !== undefined && canonicalJson(expected) !== canonicalJson(stripArtifact(artifact))) ||
        artifact.expiresAt !== artifact.deadline || artifact.approvedAt < operation.updatedAt || artifact.approvedAt >= artifact.expiresAt ||
        (now !== undefined && (artifact.approvedAt > instant(now) || instant(now) >= artifact.expiresAt))) {
        blocked("Guarded swap approval artifact was changed, replayed, or expired.", "swap_approval_tamper");
    }
    return artifact;
}
function approvalIntent(operation, material) {
    return { operationId: operation.operationId, profile: operation.quote.profile, account: operation.quote.account,
        recipient: operation.quote.recipient, inputAmountAtomic: operation.quote.inputAmountAtomic,
        expectedOutputAtomic: operation.quote.expectedOutputAtomic, minimumOutputAtomic: operation.quote.minimumOutputAtomic,
        slippageBps: operation.quote.slippageBps, gasOrEnergy: material.gasOrEnergy, deadline: operation.quote.expiresAt,
        quoteHash: operation.quote.quoteHash, policyDigest: operation.policyDigest, mechanismDigest: operation.mechanismDigest,
        protocolRegistryDigest: operation.protocolRegistryDigest };
}
function stripArtifact(value) {
    const { schemaVersion: _schema, approvedAt: _approved, expiresAt: _expires, verifierProofHash: _proof, artifactHash: _hash, ...intent } = value;
    return intent;
}
function bindMaterial(operation, material) {
    const quote = validateSwapQuote(material.quote, "input");
    if (quote.quoteHash !== operation.quote.quoteHash || canonicalJson(quote) !== canonicalJson(operation.quote) ||
        material.approvalCapAtomic !== operation.approvalCapAtomic)
        blocked("Prepared swap material changed after preparation.", "swap_material_drift");
}
function validateGasOrEnergy(value) {
    if (!isPlainRecord(value) || Object.keys(value).length === 0 || Object.keys(value).length > 16 ||
        Object.entries(value).some(([key, entry]) => !/^[a-z][a-zA-Z0-9]{0,63}$/u.test(key) || typeof entry !== "string" || !/^(?:0|[1-9][0-9]{0,77})$/u.test(entry))) {
        throw new ApnError("APN_INVALID_INPUT", "Guarded swap gas or energy display is invalid.");
    }
}
function effectDependencies(value) {
    return { rpc: value.rpc, effectStore: value.effectStore, signer: value.signer, sender: value.sender,
        observer: value.observer, caps: immutableSnapshot(value.caps) };
}
function assertDependencyObject(value) {
    for (const [name, dependency] of Object.entries({ builder: value.builder, policy: value.policy, clock: value.clock,
        protocolRegistry: value.protocolRegistry, usage: value.usage, operations: value.operations, ownerAdmission: value.ownerAdmission,
        foregroundApproval: value.foregroundApproval, execution: value.execution, approvals: value.approvals, rpc: value.rpc,
        effectStore: value.effectStore, signer: value.signer, sender: value.sender, observer: value.observer, caps: value.caps })) {
        if (dependency === null || dependency === undefined || (typeof dependency !== "object" && typeof dependency !== "function")) {
            throw new ApnError("APN_INVALID_INPUT", `Guarded swap runtime dependency ${name} is required.`);
        }
    }
    if (typeof value.chain !== "string" || value.chain.length < 3)
        throw new ApnError("APN_INVALID_INPUT", "Guarded swap runtime chain is required.");
}
function hash(value) { if (typeof value !== "string" || !/^[a-f0-9]{64}$/u.test(value))
    blocked("Guarded swap approval hash is invalid.", "swap_approval_tamper"); return value; }
function instant(value) { if (!(value instanceof Date) || !Number.isFinite(value.getTime()))
    throw new ApnError("APN_INVALID_INPUT", "Guarded swap time is invalid."); return value.toISOString(); }
function blocked(message, reason) { throw new ApnError("APN_OPERATION_BLOCKED", message, { reason }); }
/** Copy data descriptors synchronously; never evaluate accessors or discard non-JSON fields. */
function immutableSnapshot(value) {
    const ancestors = new Set();
    function invalid() { throw new ApnError("APN_INVALID_INPUT", "Swap snapshot contains unsupported non-JSON data."); }
    function copy(input) {
        if (input === null || typeof input === "string" || typeof input === "boolean")
            return input;
        if (typeof input === "number" && Number.isFinite(input) && Math.abs(input) <= Number.MAX_SAFE_INTEGER)
            return input;
        if (typeof input !== "object" || input === null || ancestors.has(input))
            invalid();
        const array = Array.isArray(input);
        if (array ? Object.getPrototypeOf(input) !== Array.prototype : !isPlainRecord(input))
            invalid();
        const keys = Reflect.ownKeys(input), descriptors = Object.getOwnPropertyDescriptors(input);
        if (keys.some(key => typeof key !== "string"))
            invalid();
        ancestors.add(input);
        try {
            if (array) {
                const length = descriptors.length;
                if (length === undefined || !("value" in length) || length.enumerable ||
                    !Number.isSafeInteger(length.value) || length.value < 0 || keys.length !== length.value + 1)
                    invalid();
                const result = [];
                for (let index = 0; index < length.value; index++) {
                    const descriptor = descriptors[String(index)];
                    if (descriptor === undefined || !("value" in descriptor) || !descriptor.enumerable)
                        invalid();
                    result.push(copy(descriptor.value));
                }
                return Object.freeze(result);
            }
            const result = {};
            for (const key of keys) {
                const descriptor = descriptors[key];
                if (!("value" in descriptor) || !descriptor.enumerable)
                    invalid();
                Object.defineProperty(result, key, { value: copy(descriptor.value), enumerable: true });
            }
            return Object.freeze(result);
        }
        finally {
            ancestors.delete(input);
        }
    }
    return copy(value);
}
//# sourceMappingURL=runtime.js.map