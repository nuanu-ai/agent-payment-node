import { createKeyPairSignerFromPrivateKeyBytes, getBase64EncodedWireTransaction, getSignatureFromTransaction, getTransactionDecoder, signTransaction } from "@solana/kit";
import { canonicalJson, domainHash, sha256 } from "../../canonical.js";
import { ApnError } from "../../errors.js";
import { SecureStateStore, stateIdentifier } from "../../secure-state-store.js";
import { SolanaRpc, solanaSignature } from "../../solana/rpc.js";
import { GuardedSwapService } from "../service.js";
import { beginOrcaStableExecutionAndSend, OrcaStableExecutionBindingStore, verifyOrcaStableSignedEffect } from "./stable-execution-journal.js";
import { freshOrcaStableExecutionPreflight } from "./stable-fresh-preflight.js";
import { SavedOrcaStableMaterialStore } from "./stable-material.js";
import { ORCA_STABLE_GUARDED_MECHANISM_DIGEST } from "./stable-mechanism.js";
/** Signs the exact preflight message once. The caller owns the operation lock and persists the result before sending. */
export class OrcaStableLocalSigner {
    custody;
    constructor(custody) {
        this.custody = custody;
    }
    async sign(operation, binding, account) {
        if (operation.state !== "submitting" || operation.submissionMarker?.markerHash !== binding.submissionMarkerHash ||
            operation.operationId !== binding.operationId || account.profile !== operation.quote.profile ||
            account.address !== binding.preview.owner || account.rail !== "solana" || account.network !== "mainnet" ||
            account.provider !== "local" || account.custody !== "local_software")
            blocked("Stable signing custody changed.");
        const effect = await this.custody.withSeed(account, async (seed) => {
            const signer = await createKeyPairSignerFromPrivateKeyBytes(seed);
            if (signer.address !== account.address)
                blocked("Stable signing key changed.");
            const unsigned = getTransactionDecoder().decode(Buffer.from(binding.preview.unsignedPayload, "base64"));
            const signed = await signTransaction([signer.keyPair], unsigned);
            const rawPayload = getBase64EncodedWireTransaction(signed);
            return { operationId: operation.operationId, fingerprint: binding.bindingHash,
                transactionId: getSignatureFromTransaction(signed), rawPayload, rawPayloadHash: sha256(rawPayload) };
        });
        await verifyOrcaStableSignedEffect(effect, binding);
        return effect;
    }
}
const SEND_CLAIM_VERSION = "apn.orca-stable-send-claim.v1";
/** A write before transport permanently consumes the first send right, including after a process crash. */
class OrcaStableSendClaimStore extends SecureStateStore {
    initialized;
    async exists(operation) {
        await this.ready();
        return await this.readJson(this.path(operation)) !== null;
    }
    async assertUnclaimed(operation) {
        if (await this.exists(operation))
            blocked("Stable send was already claimed.");
    }
    async claim(operation, binding, account, effect, claimedAt) {
        await this.assertUnclaimed(operation);
        const path = this.path(operation);
        const body = { schemaVersion: SEND_CLAIM_VERSION, operationId: operation.operationId,
            markerHash: operation.submissionMarker.markerHash, bindingHash: binding.bindingHash,
            accountIdentityHash: account.identityHash, signature: effect.transactionId,
            rawPayloadHash: effect.rawPayloadHash, claimedAt: claimedAt.toISOString() };
        const claim = { ...body, claimHash: domainHash(SEND_CLAIM_VERSION, canonicalJson(body)) };
        await this.ensureDirectory(`orca-stable-send-claims/${operation.ownerProfileHash}`);
        await this.writeJson(path, claim, true);
    }
    path(operation) {
        stateIdentifier(operation.ownerProfileHash, "stable send profile");
        stateIdentifier(operation.operationId, "stable send operation");
        return `orca-stable-send-claims/${operation.ownerProfileHash}/${operation.operationId}.json`;
    }
    async ready() {
        this.initialized ??= (async () => { await super.initialize(); await this.ensureDirectory("orca-stable-send-claims"); })();
        await this.initialized;
    }
}
/** Recovery cannot release principal after a send right was consumed, even if custody is later unreadable. */
export async function hasOrcaStableSendClaim(root, operation) {
    return await new OrcaStableSendClaimStore(root).exists(operation);
}
/** Publicly importable sender: it reloads durable state and acquires the shared operation lock itself. */
export class OrcaStableSingleSender {
    service;
    materials;
    bindings;
    custody;
    rpc;
    clock;
    claims;
    constructor(service, materials, bindings, custody, rpc, clock = () => new Date()) {
        this.service = service;
        this.materials = materials;
        this.bindings = bindings;
        this.custody = custody;
        this.rpc = rpc;
        this.clock = clock;
        this.claims = new OrcaStableSendClaimStore(service.operations.root);
    }
    async sendOnce(operationId) {
        return await this.service.operations.withLocks([`orca-stable-operation:${operationId}`], async () => {
            const operation = await this.service.operations.loadAny(operationId);
            if (operation === null)
                throw new ApnError("APN_OPERATION_NOT_FOUND", "Stable operation was not found.");
            if (operation.mechanismDigest !== ORCA_STABLE_GUARDED_MECHANISM_DIGEST || operation.state !== "submitting" ||
                operation.submissionMarker === null || operation.receiptProof !== null)
                blocked("Stable operation is no longer at its first-send boundary.");
            await this.claims.assertUnclaimed(operation);
            const material = await this.materials.loadStaged(operationId);
            if (material === null)
                corrupt("Stable material is missing.");
            const binding = await this.bindings.load(operation, material);
            if (binding === null || binding.submissionMarkerHash !== operation.submissionMarker.markerHash)
                corrupt("Stable execution binding is missing or changed.");
            const account = await this.custody.account(operation.quote.profile, "solana");
            if (account === null || account.address !== operation.quote.account || account.profile !== operation.quote.profile ||
                account.rail !== "solana" || account.network !== "mainnet" || account.provider !== "local" ||
                account.custody !== "local_software")
                blocked("Stable custody owner changed.");
            if (this.custody.effectByOperationId === undefined)
                corrupt("Stable operation custody lookup is unavailable.");
            const effect = await this.custody.effectByOperationId(account, operationId);
            if (effect === null)
                corrupt("Stable signed effect is absent.");
            await verifyOrcaStableSignedEffect(effect, binding);
            if (this.rpc.budget === undefined || this.rpc.budget.maxPhysicalRequests !== 24 ||
                this.rpc.budget.physicalRequests !== binding.physicalPostCount ||
                this.rpc.budget.physicalRequests > 23 || this.rpc.budget.minimumIntervalMs < 750 || !this.rpc.hasPersistentPacer)
                blocked("Stable send lacks its reserved physical POST.");
            const now = this.clock();
            if (!(now instanceof Date) || !Number.isFinite(now.getTime()) || now.toISOString() >= operation.quote.expiresAt ||
                now.toISOString() < binding.checkedAt || now.getTime() - Date.parse(binding.checkedAt) > 30_000)
                blocked("Stable send lifetime expired.");
            // A competing process cannot pass this point while this lock is held. A crash after this durable write
            // leaves the operation observe-only even when no transport began.
            await this.claims.claim(operation, binding, account, effect, now);
            let result = "possible_send";
            try {
                const returned = await this.rpc.sendTransactionAtStart([effect.rawPayload,
                    { encoding: "base64", skipPreflight: false, preflightCommitment: "confirmed", maxRetries: 0 }], () => {
                    const start = this.clock();
                    if (!(start instanceof Date) || !Number.isFinite(start.getTime()) ||
                        start.toISOString() >= operation.quote.expiresAt || start.getTime() - Date.parse(binding.checkedAt) > 30_000)
                        blocked("Stable send expired before physical transport.");
                });
                if (solanaSignature(returned) === effect.transactionId)
                    result = "submitted";
            }
            catch { /* The claim prevents retry regardless of whether transport started. */ }
            return await this.service.recordPossibleSend(operation, result === "submitted" ? "submitted" : "unknown_finality", this.clock());
        });
    }
}
/** Internal wiring for the first attempt. The public command remains closed pending the observation route. */
export async function executeOrcaStableFirstAttempt(input) {
    const clock = input.clock ?? (() => new Date());
    const signer = new OrcaStableLocalSigner(input.custody);
    const sender = new OrcaStableSingleSender(input.service, input.materials, input.bindings, input.custody, input.rpc, clock);
    return await beginOrcaStableExecutionAndSend(input.service, input.materials, input.bindings, {
        admission: input.admission,
        preflight: (operation, material) => freshOrcaStableExecutionPreflight(input.rpc, input.admission, input.service.usage, operation, material, clock),
        sign: (operation, binding, account) => signer.sign(operation, binding, account),
        effects: input.custody,
        send: operationId => sender.sendOnce(operationId),
    }, input.operationId, clock);
}
function blocked(message) { throw new ApnError("APN_OPERATION_BLOCKED", message, { reason: "orca_stable_effect_boundary" }); }
function corrupt(message) { throw new ApnError("APN_STATE_CORRUPT", message); }
//# sourceMappingURL=stable-effect-runtime.js.map