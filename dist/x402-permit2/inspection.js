import { selectPermit2Offer } from "./offer.js";
/**
 * Inspect the first listed exact Permit2 offer without reading state or preparing authorization.
 * Unsupported offers and invalid payer input retain the canonical ApnError emitted by the selector.
 */
export function inspectPermit2Offer(input) {
    const selection = selectPermit2Offer(input.accepts, input.payer);
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