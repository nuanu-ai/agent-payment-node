import { selectPermit2Offer } from "./offer.js";
import { wirePermit2Asset } from "./registry.js";
/**
 * Inspect the first exact Permit2 offer without reading state or preparing authorization.
 * Unsupported offers and invalid payer input retain the canonical ApnError emitted by the selector.
 */
export function inspectPermit2Offer(input) {
    // Inspect has no profile: it shows the lowest-index well-formed Permit2 offer on any EVM network; approve admits it.
    const selection = selectPermit2Offer(input.accepts, input.payer, wirePermit2Asset);
    return Object.freeze({
        index: selection.index,
        requirement: freezeRequirement(selection.requirement),
        network: selection.listAsset.chain,
        asset: selection.listAsset.token,
        amountAtomic: selection.amountAtomic,
        payTo: selection.payTo,
        maxTimeoutSeconds: selection.maxTimeoutSeconds,
        offerHash: selection.offerHash,
    });
}
function freezeRequirement(value) {
    return Object.freeze({ ...value, extra: Object.freeze({ ...value.extra }) });
}
//# sourceMappingURL=inspection.js.map