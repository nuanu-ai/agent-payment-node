import { canonicalJson } from "../../canonical.js";
import { validateChainAccount } from "../../chain-account-store.js";
import { ApnError } from "../../errors.js";
import { GuardedSwapService } from "../service.js";
import { OrcaStableExecutionBindingStore } from "./stable-execution-journal.js";
import { SavedOrcaStableMaterialStore } from "./stable-material.js";
import { ORCA_STABLE_GUARDED_MECHANISM_DIGEST } from "./stable-mechanism.js";
import { orcaStableNoSendProof, OrcaStableNoSendProofStore } from "./stable-no-send-proof.js";
import { ORCA_SOLANA_CHAIN, USDC_MINT } from "./pins.js";
import { hasOrcaStableSendClaim } from "./stable-effect-runtime.js";
/**
 * Internal, local-only recovery. The operation lock is shared with the marker writer and must also guard any future
 * sender. A sender may proceed only for a nonterminal operation with a previously persisted and verified signed effect;
 * it must never sign, save an effect or send after this no-send proof exists.
 */
export async function recoverOrcaStableNoSend(service, materials, bindings, proofs, custody, localAccount, operationId, now) {
    return await service.operations.withLocks([`orca-stable-operation:${operationId}`], async () => {
        const operation = await service.operations.loadAny(operationId);
        if (operation === null)
            throw new ApnError("APN_OPERATION_NOT_FOUND", "Stable Orca operation was not found.");
        if (operation.mechanismDigest !== ORCA_STABLE_GUARDED_MECHANISM_DIGEST)
            blocked("Wrong stable mechanism.", "orca_stable_mechanism_mismatch");
        if (!((operation.state === "submitting" || operation.state === "failed_before_effect") &&
            operation.submissionMarker !== null && operation.receiptProof === null && operation.usageLease !== null))
            blocked("Stable operation has no recoverable marked no-send boundary.", "orca_stable_effect_boundary");
        if (!(now instanceof Date) || !Number.isFinite(now.getTime()) || now.toISOString() < operation.updatedAt)
            throw new ApnError("APN_INVALID_INPUT", "Stable recovery time is invalid.");
        const material = await materials.loadStaged(operationId);
        if (material === null || material.operationId !== operationId ||
            canonicalJson(material.quote) !== canonicalJson(operation.quote) ||
            material.policyDigest !== operation.policyDigest)
            corrupt("Stable recovery material changed.");
        const binding = await bindings.load(operation, material);
        if (await hasOrcaStableSendClaim(service.operations.root, operation))
            blocked("Stable send was already claimed; no-send cannot be proved.", "orca_stable_send_claim_exists");
        const accountRaw = await localAccount(operation.quote.profile);
        if (accountRaw === null)
            corrupt("Stable custody owner is missing.");
        const account = validateChainAccount(accountRaw);
        if (account.profile !== operation.quote.profile || account.address !== operation.quote.account ||
            account.provider !== "local" || account.custody !== "local_software" ||
            account.rail !== "solana" || account.network !== "mainnet")
            corrupt("Stable custody owner changed.");
        // This read must search by operation ID even if the marker-to-binding write was interrupted.
        if (custody.effectByOperationId === undefined)
            corrupt("Operation-ID custody lookup is unavailable.");
        const effect = await custody.effectByOperationId(account, operationId);
        if (effect !== null)
            blocked("Stable signed effect exists; no-send cannot be proved.", "orca_stable_signed_effect_exists");
        const identity = { account: operation.quote.account, chain: ORCA_SOLANA_CHAIN,
            asset: { kind: "token", identifier: USDC_MINT } };
        const reserved = operation.usageLease;
        const live = await service.usage.load(identity, reserved.reservationId);
        if (live === null || live.reservationId !== reserved.reservationId ||
            live.account !== reserved.account || live.chain !== reserved.chain ||
            canonicalJson(live.asset) !== canonicalJson(reserved.asset) || live.rail !== "swap" ||
            live.idempotencyHash !== reserved.idempotencyHash || live.amountAtomic !== reserved.amountAtomic ||
            live.policyDigest !== reserved.policyDigest || live.registryVersion !== reserved.registryVersion ||
            live.reservedAt !== reserved.reservedAt)
            corrupt("Stable principal lease changed.");
        const savedProof = await proofs.load(operation);
        if (operation.state === "failed_before_effect") {
            if (savedProof === null || live.state !== "failed_before_effect" ||
                canonicalJson(live) !== canonicalJson(reserved) || savedProof.proofHash !== operation.failureProofHash ||
                savedProof.operationId !== operationId || savedProof.ownerProfileHash !== operation.ownerProfileHash ||
                savedProof.quoteHash !== operation.quote.quoteHash ||
                savedProof.markerHash !== operation.submissionMarker.markerHash ||
                savedProof.markerOperationIntegrityHash !== operation.submissionMarker.operationIntegrityHash ||
                savedProof.materialDigest !== material.materialDigest || savedProof.bindingHash !== (binding?.bindingHash ?? null) ||
                savedProof.custodyAccountIdentityHash !== account.identityHash || savedProof.reservationId !== reserved.reservationId ||
                reserved.outcomeDigest !== savedProof.proofHash)
                corrupt("Stable terminal no-send proof changed.");
            return operation;
        }
        const proof = orcaStableNoSendProof(operation, material, binding, account);
        if (savedProof !== null && canonicalJson(savedProof) !== canonicalJson(proof))
            corrupt("Stable no-send proof changed.");
        if (live.state === "reserved") {
            if (canonicalJson(live) !== canonicalJson(reserved))
                corrupt("Stable reserved lease changed.");
        }
        else if (live.state !== "failed_before_effect" || live.outcomeDigest !== proof.proofHash || savedProof === null)
            corrupt("Stable lease progressed without the exact prior no-send proof.");
        await proofs.save(proof);
        const released = await service.usage.transition({ ...identity, reservationId: reserved.reservationId,
            policyDigest: operation.policyDigest, state: "failed_before_effect", expectedCurrentStates: ["reserved", "failed_before_effect"],
            now, outcomeDigest: proof.proofHash });
        return await service.operations.transition(operation.ownerProfileHash, operationId, operation.integrityHash, "failed_before_effect", { usageLease: released, failureProofHash: proof.proofHash,
            orcaStableNoSendProof: proof }, now);
    });
}
function blocked(message, reason) { throw new ApnError("APN_OPERATION_BLOCKED", message, { reason }); }
function corrupt(message) { throw new ApnError("APN_STATE_CORRUPT", message); }
//# sourceMappingURL=stable-no-send-recovery.js.map