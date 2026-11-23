import { bridgeAssetRow, bridgeLegScale } from "./asset-registry.js";
import type { BridgeRouteRequest } from "./model.js";

type BridgePair = Pick<BridgeRouteRequest, "fromChainId" | "toChainId" | "fromToken" | "toToken">;
/**
 * How the two legs of one request compare. `source` and `destination` bring each leg's atomic amount to the finer of the
 * two precisions; `scaled` is true only for the reviewed Binance-Peg pair (18 decimals against 6). Every bound between
 * the legs is checked exactly at that finer precision. Only a value stated in the source asset's own atomic units is
 * rounded, and always against the owner: an output down, a loss up.
 */
export interface BridgeAmountScale { readonly source: bigint; readonly destination: bigint; readonly scaled: boolean }

export function bridgeRequestScale(request: BridgePair): BridgeAmountScale {
  const scale = bridgeLegScale(bridgeAssetRow(request.fromChainId, request.fromToken), bridgeAssetRow(request.toChainId, request.toToken));
  return { ...scale, scaled: scale.source !== scale.destination };
}
/** A destination amount at the source asset's precision, rounded down. */
export function bridgeOutputAsSource(outputAtomic: bigint, scale: BridgeAmountScale): bigint {
  return outputAtomic * scale.destination / scale.source;
}
/** Source principal minus a destination amount, at the source asset's precision, rounded up. */
export function bridgeLossAsSource(amountAtomic: bigint, outputAtomic: bigint, scale: BridgeAmountScale): bigint {
  const loss = amountAtomic * scale.source - outputAtomic * scale.destination;
  return loss > 0n ? (loss + scale.source - 1n) / scale.source : loss / scale.source;
}
/** True when the destination amount is worth more than the source amount: no admitted route may gain value. */
export function bridgeOutputExceedsSource(amountAtomic: bigint, outputAtomic: bigint, scale: BridgeAmountScale): boolean {
  return outputAtomic * scale.destination > amountAtomic * scale.source;
}
