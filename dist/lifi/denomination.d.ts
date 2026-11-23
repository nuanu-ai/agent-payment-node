import type { BridgeRouteRequest } from "./model.js";
type BridgePair = Pick<BridgeRouteRequest, "fromChainId" | "toChainId" | "fromToken" | "toToken">;
/**
 * How the two legs of one request compare. `source` and `destination` bring each leg's atomic amount to the finer of the
 * two precisions; `scaled` is true only for the reviewed Binance-Peg pair (18 decimals against 6). Every bound between
 * the legs is checked exactly at that finer precision. Only a value stated in the source asset's own atomic units is
 * rounded, and always against the owner: an output down, a loss up.
 */
export interface BridgeAmountScale {
    readonly source: bigint;
    readonly destination: bigint;
    readonly scaled: boolean;
}
export declare function bridgeRequestScale(request: BridgePair): BridgeAmountScale;
/** A destination amount at the source asset's precision, rounded down. */
export declare function bridgeOutputAsSource(outputAtomic: bigint, scale: BridgeAmountScale): bigint;
/** Source principal minus a destination amount, at the source asset's precision, rounded up. */
export declare function bridgeLossAsSource(amountAtomic: bigint, outputAtomic: bigint, scale: BridgeAmountScale): bigint;
/** True when the destination amount is worth more than the source amount: no admitted route may gain value. */
export declare function bridgeOutputExceedsSource(amountAtomic: bigint, outputAtomic: bigint, scale: BridgeAmountScale): boolean;
export {};
