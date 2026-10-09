import { canonicalJson, hashObject } from "../../canonical.js";
import { approvalCode } from "../../approval-code.js";
import { exactChainConsent } from "../../tty-approval.js";
import { SwapOperationRepository } from "../repository.js";
import { SOLANA_MAINNET_GENESIS } from "./catalog.js";
import { jupiterV1AccountBindingHash } from "./v1-admission.js";
import { verifySignedJupiterV1Transaction } from "./v1-effects.js";
import { guardJupiterV1WhirlpoolMaterial } from "./v1-guard.js";
import { assertHistoricalOrdinaryRecentBlockhash } from "./historical-wire.js";
import { routeConfigForMaterial } from "./v1-route-config.js";
import { HistoricalReadState, HistoricalDirectoryGuard, HistoricalBindingReader, HistoricalCustodyReader, HistoricalMaterialReader, historicalAuthenticationRefused as refuse } from "./historical-authentication-readers.js";
import { HISTORICAL_JUPITER_IDS } from "./historical-pins.js";
/** Plain cryptographic projection only: no private authority, expiry verdict, ledger or sending permission. */
export class JupiterHistoricalProjectionReader {
    #state;
    #wrapping;
    constructor(root, wrapping, guard) { this.#state = new HistoricalReadState(root, guard); this.#wrapping = wrapping; }
    async read(operationId) {
        if (!HISTORICAL_JUPITER_IDS.some(id => id === operationId))
            refuse();
        await this.#state.initialize();
        const operations = new SwapOperationRepository(this.#state.root), original = await operations.loadAny(operationId);
        if (original === null || original.quote.profile !== "solana-local" || !["unknown_finality", "submitted"].includes(original.state) || original.submissionMarker === null || original.receiptProof !== null)
            refuse();
        return await this.#state.withLocks([`profile:${original.ownerProfileHash}`, `profile:${this.#state.profileHash("solana-local")}`, `operation:${operationId}`, `chain-wallet-effects:solana:${this.#state.profileHash("solana-local")}`], async () => {
            const assertUnchanged = async () => { const current = await operations.loadAny(operationId); if (canonicalJson(current) !== canonicalJson(original))
                refuse(); };
            await assertUnchanged();
            const materials = new HistoricalMaterialReader(this.#state.root, this.#state.directoryGuard()), bindings = new HistoricalBindingReader(this.#state.root, this.#state.directoryGuard());
            const material = await materials.load(original.quote.quoteHash);
            if (material === null)
                refuse();
            if (routeConfigForMaterial(material.execution).routeId !== "whirlpool-v1-83-sol-usdc" || canonicalJson(material.quote) !== canonicalJson(original.quote) || material.execution.genesis !== SOLANA_MAINNET_GENESIS || original.quote.inputAmountAtomic !== "1000000")
                refuse();
            const binding = await bindings.load(original, material);
            if (binding === null)
                refuse();
            const { fresh } = await bindings.loadFresh(original, binding);
            // Historical semantic validation uses its retained snapshot, never refreshes or signs a new message.
            await guardJupiterV1WhirlpoolMaterial(material.execution);
            await guardJupiterV1WhirlpoolMaterial(fresh);
            if (fresh.maximumNativeExpenseLamports !== material.execution.maximumNativeExpenseLamports || fresh.lifetime.blockhash !== material.execution.lifetime.blockhash || fresh.networkFeeLamports !== material.execution.networkFeeLamports || fresh.tokenAccountRentLamports !== material.execution.tokenAccountRentLamports)
                refuse();
            assertHistoricalOrdinaryRecentBlockhash(material.execution.transactionBase64, material.execution.rawInstructions);
            assertHistoricalOrdinaryRecentBlockhash(fresh.transactionBase64, fresh.rawInstructions);
            let live = false, expires = 0;
            let assertPublicFrame = assertUnchanged;
            const guard = async () => { if (!live || Date.now() >= expires)
                refuse(); await assertPublicFrame(); if (!live || Date.now() >= expires)
                refuse(); };
            const custody = new HistoricalCustodyReader(this.#state.root, { load: async () => { await guard(); const key = await this.#wrapping.load(); try {
                    await guard();
                    return key;
                }
                catch (error) {
                    key?.fill(0);
                    throw error;
                } }, create: async () => refuse() }, this.#state.directoryGuard());
            const owner = await custody.account("solana-local", "solana"), envelopeOwner = await custody.ownerBinding("solana-local", "solana");
            if (owner === null || canonicalJson(owner) !== canonicalJson(envelopeOwner) || owner.provider !== "local" || owner.custody !== "local_software" || owner.network !== "mainnet" || owner.address !== original.quote.account || jupiterV1AccountBindingHash(owner) !== binding.accountBindingHash)
                refuse();
            const admission = { account: owner, accountBindingHash: binding.accountBindingHash, policyDigest: binding.policyDigest, activationDigest: binding.activationDigest, admissionHash: binding.ownerAdmissionHash };
            await bindings.assertPrepared(original, admission, material);
            const publicSignature = await bindings.loadSignature(original, binding), claim = await bindings.loadClaim(original);
            if (publicSignature === null || claim === null || claim.signature !== publicSignature || claim.bindingHash !== binding.bindingHash)
                refuse();
            const initialFrame = canonicalJson({ material, binding, fresh, owner, claim, publicSignature });
            assertPublicFrame = async () => {
                await assertUnchanged();
                const currentMaterial = await materials.load(original.quote.quoteHash);
                if (currentMaterial === null)
                    refuse();
                const currentBinding = await bindings.load(original, currentMaterial);
                if (currentBinding === null)
                    refuse();
                const currentFresh = await bindings.loadFresh(original, currentBinding);
                const currentOwner = await custody.ownerBinding("solana-local", "solana");
                await bindings.assertPrepared(original, admission, currentMaterial);
                if (canonicalJson({ material: currentMaterial, binding: currentBinding, fresh: currentFresh.fresh, owner: currentOwner, claim: await bindings.loadClaim(original), publicSignature: await bindings.loadSignature(original, currentBinding) }) !== initialFrame)
                    refuse();
            };
            const deadline = new Date(Date.now() + 60_000).toISOString();
            await exactChainConsent(["Authenticate retained historical Jupiter material only", `Operation ${operationId}; owner ${owner.address}`, "Decrypt the existing seed-containing wallet container without deriving a signer, signing or sending.", "No ledger retirement, charge, expiry verdict or past absence is authorized."], approvalCode("swap", operationId, binding.bindingHash), deadline, {});
            expires = Date.parse(deadline);
            live = true;
            try {
                await guard();
                const effect = await custody.effect(owner, operationId, binding.bindingHash);
                if (effect === null)
                    refuse();
                await guard();
                await verifySignedJupiterV1Transaction(effect, binding);
                assertHistoricalOrdinaryRecentBlockhash(effect.rawPayload, material.execution.rawInstructions);
                if (effect.transactionId !== publicSignature || claim.rawPayloadHash !== effect.rawPayloadHash)
                    refuse();
                const currentOwner = await custody.ownerBinding("solana-local", "solana");
                if (canonicalJson(currentOwner) !== canonicalJson(owner))
                    refuse();
                await guard();
                const projection = Object.freeze({ schemaVersion: "apn.jupiter-historical-authentication.v1", operationId, operationIntegrityHash: original.integrityHash, rootBinding: hashObject({ root: this.#state.root }), ownerProfileHash: original.ownerProfileHash, accountBindingHash: binding.accountBindingHash, payer: owner.address, policyDigest: binding.policyDigest, activationDigest: binding.activationDigest, originalBindingHash: binding.bindingHash, originalMaterialDigest: material.execution.materialDigest, freshMaterialDigest: fresh.materialDigest, markerHash: original.submissionMarker.markerHash, principalLamports: original.quote.inputAmountAtomic, maximumNativeExpenseLamports: material.execution.maximumNativeExpenseLamports, freshMaximumNativeExpenseLamports: fresh.maximumNativeExpenseLamports, networkFeeLamports: material.execution.networkFeeLamports, tokenAccountRentLamports: material.execution.tokenAccountRentLamports, genesis: SOLANA_MAINNET_GENESIS, blockhash: material.execution.lifetime.blockhash, lastValidBlockHeight: material.execution.lifetime.lastValidBlockHeight, freshBlockhash: fresh.lifetime.blockhash, freshLastValidBlockHeight: fresh.lifetime.lastValidBlockHeight, heightBinding: "authenticated_material_not_signed_message", originalQuoteRpcLifetime: material.execution.quoteRpcLifetime === undefined ? null : Object.freeze(structuredClone(material.execution.quoteRpcLifetime)), signature: effect.transactionId, rawPayloadHash: effect.rawPayloadHash, messageHash: binding.messageHash, lifetimeProvenance: material.execution.quoteRpcLifetime === undefined ? "original_provider_build" : "configured_mainnet_rpc_before_quote_freeze", ordinaryRecentBlockhash: true, authenticationExpiresAt: deadline, authenticatedAt: new Date().toISOString() });
                return { projection: Object.freeze(structuredClone(projection)) };
            }
            finally {
                live = false;
            }
        });
    }
}
//# sourceMappingURL=historical-projection-reader.js.map