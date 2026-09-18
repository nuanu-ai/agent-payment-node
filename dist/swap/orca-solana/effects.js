import { address, createKeyPairSignerFromPrivateKeyBytes, getBase64EncodedWireTransaction, getPublicKeyFromAddress, getSignatureFromTransaction, getTransactionDecoder, signTransaction, verifySignature, } from "@solana/kit";
import { canonicalJson, domainHash, exactKeys, isPlainRecord, sha256 } from "../../canonical.js";
import { ApnError } from "../../errors.js";
import { SecureStateStore, stateIdentifier } from "../../secure-state-store.js";
import { solanaSignature } from "../../solana/rpc.js";
import { validateSwapOperation } from "../model.js";
import { orcaAccountBindingHash } from "./admission.js";
import { compileOrcaSwap } from "./instructions.js";
import { validateOrcaKeylessMaterial } from "./material.js";
import { sha256Hex } from "./pins.js";
const BINDING_VERSION = "apn.orca-whirlpool-execution-binding.v1";
const HASH = /^[a-f0-9]{64}$/u;
export function createOrcaExecutionBinding(input) {
    const operation = validateSwapOperation(input.operation);
    if (operation.state !== "submitting" || operation.submissionMarker === null)
        blocked("Orca execution requires a durable submission marker.", "orca_marker_missing");
    const body = { schemaVersion: BINDING_VERSION, operationId: operation.operationId,
        operationIntegrityHash: operation.submissionMarker.operationIntegrityHash, profileHash: operation.ownerProfileHash,
        account: operation.quote.account, accountBindingHash: input.admission.accountBindingHash, ownerAdmissionHash: input.admission.admissionHash,
        quoteHash: operation.quote.quoteHash, submissionMarkerHash: operation.submissionMarker.markerHash, policyDigest: operation.policyDigest,
        mechanismDigest: operation.mechanismDigest, protocolRegistryDigest: operation.protocolRegistryDigest, ...freshnessOf(input.freshness) };
    return validateOrcaExecutionBinding({ ...body, bindingHash: domainHash(BINDING_VERSION, canonicalJson(body)) }, operation, input.material);
}
/** Re-derives the exact signed-to-be bytes from the stored plan and the recorded lifetime; any drift is corruption. */
export function validateOrcaExecutionBinding(value, operationValue, materialValue) {
    const operation = validateSwapOperation(operationValue), material = validateOrcaKeylessMaterial(materialValue);
    if (!isPlainRecord(value) || !exactKeys(value, ["schemaVersion", "operationId", "operationIntegrityHash", "profileHash", "account",
        "accountBindingHash", "ownerAdmissionHash", "quoteHash", "submissionMarkerHash", "policyDigest", "mechanismDigest", "protocolRegistryDigest",
        "lifetime", "unsignedPayload", "messageHash", "networkFeeLamports", "simulation", "blockHeight", "checkedAt", "bindingHash"]) ||
        value.schemaVersion !== BINDING_VERSION || !isPlainRecord(value.lifetime) || !isPlainRecord(value.simulation))
        corrupt("Orca execution binding schema is invalid.");
    const binding = value, { bindingHash, ...body } = binding;
    let compiled;
    try {
        compiled = compileOrcaSwap(material.execution.plan, binding.lifetime);
    }
    catch {
        return corrupt("Orca execution bytes do not rebuild from the plan.");
    }
    if (typeof bindingHash !== "string" || bindingHash !== domainHash(BINDING_VERSION, canonicalJson(body)) || operation.submissionMarker === null ||
        binding.operationId !== operation.operationId || binding.operationIntegrityHash !== operation.submissionMarker.operationIntegrityHash ||
        binding.profileHash !== operation.ownerProfileHash || binding.account !== operation.quote.account || binding.quoteHash !== operation.quote.quoteHash ||
        binding.submissionMarkerHash !== operation.submissionMarker.markerHash || binding.policyDigest !== operation.policyDigest ||
        binding.mechanismDigest !== operation.mechanismDigest || binding.protocolRegistryDigest !== operation.protocolRegistryDigest ||
        !HASH.test(binding.accountBindingHash) || !HASH.test(binding.ownerAdmissionHash) || compiled.unsignedPayload !== binding.unsignedPayload ||
        compiled.messageHash !== binding.messageHash || binding.simulation.replaceRecentBlockhash !== false ||
        BigInt(binding.networkFeeLamports) > BigInt(material.execution.networkFeeLamports) ||
        BigInt(binding.simulation.usdcReceivedAtomic) < BigInt(operation.quote.minimumOutputAtomic) ||
        BigInt(binding.simulation.solSpentLamports) > BigInt(material.execution.maximumSolSpendLamports) ||
        !/^[1-9][0-9]{0,19}$/u.test(binding.blockHeight) || BigInt(binding.blockHeight) > BigInt(binding.lifetime.lastValidBlockHeight) ||
        !canonicalInstant(binding.checkedAt) || binding.checkedAt < operation.submissionMarker.markedAt || binding.checkedAt >= operation.quote.expiresAt) {
        corrupt("Orca execution binding integrity failed.");
    }
    return binding;
}
/** Durable binding written after the submission marker and before signing. It holds no secret. */
export class OrcaExecutionBindingStore extends SecureStateStore {
    initialized;
    async save(operation, value, material) {
        const binding = validateOrcaExecutionBinding(value, operation, material);
        await this.ready();
        return await this.withLocks([`orca-binding:${operation.operationId}`], async () => {
            const existing = await this.readJson(this.path(operation));
            if (existing !== null) {
                const prior = validateOrcaExecutionBinding(existing, operation, material);
                if (canonicalJson(prior) !== canonicalJson(binding))
                    corrupt("A different Orca execution binding already exists.");
                return prior;
            }
            await this.ensureDirectory(`orca-execution-bindings/${operation.ownerProfileHash}`);
            await this.writeJson(this.path(operation), binding, true);
            return binding;
        });
    }
    async load(operation, material) {
        await this.ready();
        const value = await this.readJson(this.path(operation));
        return value === null ? null : validateOrcaExecutionBinding(value, operation, material);
    }
    path(operation) {
        stateIdentifier(operation.ownerProfileHash, "Orca binding profile");
        stateIdentifier(operation.operationId, "Orca binding operation");
        return `orca-execution-bindings/${operation.ownerProfileHash}/${operation.operationId}.json`;
    }
    async ready() {
        this.initialized ??= (async () => { await super.initialize(); await this.ensureDirectory("orca-execution-bindings"); })();
        await this.initialized;
    }
}
/** Opens the local Solana seed only inside the signing call and seals the signed bytes in the encrypted wallet state. */
export class OrcaLocalSigner {
    accounts;
    constructor(accounts) {
        this.accounts = accounts;
    }
    async sign(operation, binding, material, account) {
        validateOrcaExecutionBinding(binding, operation, material);
        if (account.address !== binding.account || orcaAccountBindingHash(account) !== binding.accountBindingHash) {
            blocked("The Solana signing account changed after the execution binding.", "orca_signing_gate");
        }
        const existing = await this.accounts.effect(account, operation.operationId, binding.bindingHash);
        if (existing !== null) {
            await verifySignedOrcaTransaction(existing, binding);
            return existing;
        }
        const compiled = compileOrcaSwap(material.execution.plan, binding.lifetime);
        if (compiled.unsignedPayload !== binding.unsignedPayload)
            corrupt("Orca signing bytes differ from the execution binding.");
        const effect = await this.accounts.withSeed(account, async (seed) => {
            const signer = await createKeyPairSignerFromPrivateKeyBytes(seed);
            if (signer.address !== account.address)
                throw new ApnError("APN_WALLET_MISMATCH", "The Solana signer changed.");
            const signed = await signTransaction([signer.keyPair], compiled.transaction), rawPayload = getBase64EncodedWireTransaction(signed);
            return { operationId: operation.operationId, fingerprint: binding.bindingHash, transactionId: getSignatureFromTransaction(signed),
                rawPayload, rawPayloadHash: sha256(rawPayload) };
        });
        await verifySignedOrcaTransaction(effect, binding);
        // Persisted before the single send: resume can only observe this exact signature.
        await this.accounts.saveEffect(account, effect);
        return effect;
    }
}
export async function verifySignedOrcaTransaction(effect, binding) {
    try {
        const bytes = Buffer.from(effect.rawPayload, "base64"), transaction = getTransactionDecoder().decode(bytes);
        const signature = transaction.signatures[address(binding.account)];
        if (bytes.toString("base64") !== effect.rawPayload || sha256(effect.rawPayload) !== effect.rawPayloadHash ||
            effect.fingerprint !== binding.bindingHash || effect.operationId !== binding.operationId ||
            Object.keys(transaction.signatures).length !== 1 || signature === undefined || signature === null ||
            sha256Hex(new Uint8Array(transaction.messageBytes)) !== binding.messageHash || getBase64EncodedWireTransaction(transaction) !== effect.rawPayload ||
            getSignatureFromTransaction(transaction) !== solanaSignature(effect.transactionId) ||
            !await verifySignature(await getPublicKeyFromAddress(address(binding.account)), signature, transaction.messageBytes))
            throw new Error();
        return effect.transactionId;
    }
    catch {
        return corrupt("The signed Orca transaction does not match the exact bound message and owner.");
    }
}
/** One sendTransaction call. It never throws: any failure is an ambiguous possible send that only status may resolve. */
export class OrcaSingleSender {
    rpc;
    constructor(rpc) {
        this.rpc = rpc;
    }
    async sendOnce(effect) {
        try {
            const result = await this.rpc.call("sendTransaction", [effect.rawPayload,
                { encoding: "base64", skipPreflight: false, preflightCommitment: "confirmed", maxRetries: 0 }]);
            return solanaSignature(result) === effect.transactionId ? "submitted" : "possible_send";
        }
        catch {
            return "possible_send";
        }
    }
}
function freshnessOf(value) {
    return { lifetime: value.lifetime, unsignedPayload: value.unsignedPayload, messageHash: value.messageHash,
        networkFeeLamports: value.networkFeeLamports, simulation: value.simulation, blockHeight: value.blockHeight, checkedAt: value.checkedAt };
}
function canonicalInstant(value) { return typeof value === "string" && Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value; }
function corrupt(message) { throw new ApnError("APN_STATE_CORRUPT", message); }
function blocked(message, reason) { throw new ApnError("APN_OPERATION_BLOCKED", message, { reason }); }
//# sourceMappingURL=effects.js.map