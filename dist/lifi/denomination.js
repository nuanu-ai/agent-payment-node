import { bridgeAssetRow, bridgeLegScale } from "./asset-registry.js";
export function bridgeRequestScale(request) {
    const scale = bridgeLegScale(bridgeAssetRow(request.fromChainId, request.fromToken), bridgeAssetRow(request.toChainId, request.toToken));
    return { ...scale, scaled: scale.source !== scale.destination };
}
/** A destination amount at the source asset's precision, rounded down. */
export function bridgeOutputAsSource(outputAtomic, scale) {
    return outputAtomic * scale.destination / scale.source;
}
/** Source principal minus a destination amount, at the source asset's precision, rounded up. */
export function bridgeLossAsSource(amountAtomic, outputAtomic, scale) {
    const loss = amountAtomic * scale.source - outputAtomic * scale.destination;
    return loss > 0n ? (loss + scale.source - 1n) / scale.source : loss / scale.source;
}
/** True when the destination amount is worth more than the source amount: no admitted route may gain value. */
export function bridgeOutputExceedsSource(amountAtomic, outputAtomic, scale) {
    return outputAtomic * scale.destination > amountAtomic * scale.source;
}
//# sourceMappingURL=denomination.js.map