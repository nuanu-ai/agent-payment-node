import { createKeyPairSignerFromPrivateKeyBytes, getBase64EncodedWireTransaction, getSignatureFromTransaction, getTransactionDecoder, signTransaction } from "@solana/kit";
import { canonicalJson, sha256 } from "../../canonical.js";
import { ApnError } from "../../errors.js";
import { SolanaRpc, solanaSignature } from "../../solana/rpc.js";
import { GuardedSwapService } from "../service.js";
import { beginOrcaStableExecutionAndSend, OrcaStableExecutionBindingStore, verifyOrcaStableSignedEffect } from "./stable-execution-journal.js";
import { freshOrcaStableExecutionPreflight } from "./stable-fresh-preflight.js";
import { SavedOrcaStableMaterialStore } from "./stable-material.js";
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
/** This port may be called only in the marker writer's lock, immediately after sealed effect persistence. */
export class OrcaStableSingleSender {
    rpc;
    custody;
    clock;
    constructor(rpc, custody, clock = () => new Date()) {
        this.rpc = rpc;
        this.custody = custody;
        this.clock = clock;
    }
    async sendOnce(operation, binding, account, effect) {
        if (operation.state !== "submitting" || operation.submissionMarker?.markerHash !== binding.submissionMarkerHash ||
            operation.operationId !== binding.operationId || account.address !== operation.quote.account ||
            account.provider !== "local" || account.custody !== "local_software")
            blocked("Stable send boundary changed.");
        if (this.custody.effectByOperationId === undefined)
            corrupt("Stable operation custody lookup is unavailable.");
        const saved = await this.custody.effectByOperationId(account, operation.operationId);
        if (saved === null || canonicalJson(saved) !== canonicalJson(effect))
            corrupt("Stable signed effect is not sealed in custody.");
        await verifyOrcaStableSignedEffect(saved, binding);
        if (this.rpc.budget === undefined || this.rpc.budget.maxPhysicalRequests !== 24 ||
            this.rpc.budget.physicalRequests !== binding.physicalPostCount ||
            this.rpc.budget.physicalRequests > 23 || this.rpc.budget.minimumIntervalMs < 750 || !this.rpc.hasPersistentPacer)
            blocked("Stable send lacks its reserved physical POST.");
        const now = this.clock();
        if (!(now instanceof Date) || !Number.isFinite(now.getTime()) || now.toISOString() >= operation.quote.expiresAt ||
            now.toISOString() < binding.checkedAt || now.getTime() - Date.parse(binding.checkedAt) > 30_000)
            blocked("Stable send lifetime expired.");
        try {
            const returned = await this.rpc.call("sendTransaction", [saved.rawPayload,
                { encoding: "base64", skipPreflight: false, preflightCommitment: "confirmed", maxRetries: 0 }]);
            return solanaSignature(returned) === saved.transactionId ? "submitted" : "possible_send";
        }
        catch {
            // A transport or provider failure after send is always ambiguous. The signed effect is never sent again.
            return "possible_send";
        }
    }
}
/** Internal wiring for the first attempt. The public command remains closed pending the observation route. */
export async function executeOrcaStableFirstAttempt(input) {
    const clock = input.clock ?? (() => new Date());
    const signer = new OrcaStableLocalSigner(input.custody);
    const sender = new OrcaStableSingleSender(input.rpc, input.custody, clock);
    return await beginOrcaStableExecutionAndSend(input.service, input.materials, input.bindings, {
        admission: input.admission,
        preflight: (operation, material) => freshOrcaStableExecutionPreflight(input.rpc, input.admission, input.service.usage, operation, material, clock),
        sign: (operation, binding, account) => signer.sign(operation, binding, account),
        effects: input.custody,
        send: (operation, binding, account, effect) => sender.sendOnce(operation, binding, account, effect),
    }, input.operationId, clock);
}
function blocked(message) { throw new ApnError("APN_OPERATION_BLOCKED", message, { reason: "orca_stable_effect_boundary" }); }
function corrupt(message) { throw new ApnError("APN_STATE_CORRUPT", message); }
//# sourceMappingURL=stable-effect-runtime.js.map