import { canonicalJson, hashObject } from "../../canonical.js";
import { StateStore } from "../../state.js";
import { SwapOperationRepository } from "../repository.js";
import { jupiterV1AccountBindingHash } from "./v1-admission.js";
import { existingHistoricalRoot, HistoricalBindingReader, HistoricalCustodyReader, HistoricalMaterialReader, historicalAuthenticationRefused as refuse } from "./historical-authentication-readers.js";
import { JupiterHistoricalProjectionReader } from "./historical-projection-reader.js";
import { HISTORICAL_JUPITER_IDS, HISTORICAL_JUPITER_PAYER, HISTORICAL_JUPITER_ACCOUNT_BINDING, HISTORICAL_JUPITER_OWNER_PROFILE } from "./historical-pins.js";
export { HISTORICAL_JUPITER_IDS } from "./historical-pins.js";
const brand = Symbol("HistoricalJupiterMaterialAuthority");
/** Finite historical owner issuer. Neither a public DTO nor a caller-supplied reader can issue authority. */
export class JupiterHistoricalAuthenticator {
    #state;
    #reader;
    #tokens = new WeakMap();
    constructor(root, wrapping) { this.#state = new StateStore(root); this.#reader = new JupiterHistoricalProjectionReader(this.#state.root, wrapping); }
    async #fixedOwner(operationId) {
        if (!HISTORICAL_JUPITER_IDS.some(id => id === operationId))
            refuse();
        await existingHistoricalRoot(this.#state.root);
        const original = await new SwapOperationRepository(this.#state.root).loadAny(operationId);
        if (original === null || original.ownerProfileHash !== HISTORICAL_JUPITER_OWNER_PROFILE || original.quote.profile !== "solana-local" || original.quote.account !== HISTORICAL_JUPITER_PAYER)
            refuse();
        const material = await new HistoricalMaterialReader(this.#state.root).load(original.quote.quoteHash);
        if (material === null || material.execution.payer !== HISTORICAL_JUPITER_PAYER)
            refuse();
        const bindings = new HistoricalBindingReader(this.#state.root), binding = await bindings.load(original, material);
        if (binding === null || binding.accountBindingHash !== HISTORICAL_JUPITER_ACCOUNT_BINDING)
            refuse();
        await bindings.loadFresh(original, binding);
        const custody = new HistoricalCustodyReader(this.#state.root, { load: async () => refuse(), create: async () => refuse() });
        const owner = await custody.account("solana-local", "solana"), envelope = await custody.ownerBinding("solana-local", "solana");
        if (owner === null || canonicalJson(owner) !== canonicalJson(envelope) || owner.address !== HISTORICAL_JUPITER_PAYER || jupiterV1AccountBindingHash(owner) !== HISTORICAL_JUPITER_ACCOUNT_BINDING)
            refuse();
        return { integrityHash: original.integrityHash, materialDigest: material.execution.materialDigest, bindingHash: binding.bindingHash, freshMaterialDigest: binding.freshMaterialDigest, markerHash: binding.markerHash };
    }
    async authenticate(operationId) {
        // Counterfeit independently-owned wallets fail before any wrapping-key load or terminal grant.
        await this.#fixedOwner(operationId);
        const { projection } = await this.#reader.read(operationId);
        return await this.#state.withLocks([`profile:${HISTORICAL_JUPITER_OWNER_PROFILE}`, `profile:${this.#state.profileHash("solana-local")}`, `operation:${operationId}`, `chain-wallet-effects:solana:${this.#state.profileHash("solana-local")}`], async () => {
            const frame = await this.#fixedOwner(operationId);
            if (frame.integrityHash !== projection.operationIntegrityHash || frame.materialDigest !== projection.originalMaterialDigest || frame.bindingHash !== projection.originalBindingHash || frame.freshMaterialDigest !== projection.freshMaterialDigest || frame.markerHash !== projection.markerHash)
                refuse();
            const current = await new SwapOperationRepository(this.#state.root).loadAny(operationId), expires = Date.parse(projection.authenticationExpiresAt);
            if (projection.operationId !== operationId || projection.rootBinding !== hashObject({ root: this.#state.root }) || projection.payer !== HISTORICAL_JUPITER_PAYER || projection.accountBindingHash !== HISTORICAL_JUPITER_ACCOUNT_BINDING || projection.ownerProfileHash !== HISTORICAL_JUPITER_OWNER_PROFILE || current?.integrityHash !== projection.operationIntegrityHash || !Number.isFinite(expires) || Date.now() >= expires)
                refuse();
            const authority = Object.freeze({});
            this.#tokens.set(authority, { projection: Object.freeze(structuredClone(projection)), expires });
            return { projection: Object.freeze(structuredClone(projection)), authority };
        });
    }
    async consume(authority, operationId) {
        const value = this.#tokens.get(authority);
        this.#tokens.delete(authority);
        if (value === undefined || value.projection.operationId !== operationId || Date.now() >= value.expires)
            refuse();
        const frame = await this.#fixedOwner(operationId);
        if (frame.integrityHash !== value.projection.operationIntegrityHash || frame.materialDigest !== value.projection.originalMaterialDigest || frame.bindingHash !== value.projection.originalBindingHash || frame.freshMaterialDigest !== value.projection.freshMaterialDigest || frame.markerHash !== value.projection.markerHash)
            refuse();
        const current = await new SwapOperationRepository(this.#state.root).loadAny(operationId);
        if (current?.integrityHash !== value.projection.operationIntegrityHash || Date.now() >= value.expires)
            refuse();
        return Object.freeze(structuredClone(value.projection));
    }
}
//# sourceMappingURL=historical-authenticator.js.map