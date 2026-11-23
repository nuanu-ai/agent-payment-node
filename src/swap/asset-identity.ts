import { loadAllowlistInventory, resolveAllowlistAsset, type CandidateAsset } from "../allowlist-inventory.js";
import { binancePegPolicyAsset } from "../binance-peg-policy-assets.js";
import type { SwapAssetIdentity } from "./quote.js";

/**
 * A swap asset's reviewed identity: the reviewed Binance-Peg USDT or USDC of BNB Smart Chain (exact checksummed spelling),
 * otherwise the frozen 2026-09-17 inventory, which is never rewritten. Refuses exactly as the frozen resolver refuses.
 * The WBTC supplement keeps its own narrower rule beside each caller (native ETH to WBTC on Ethereum only).
 */
export function resolveSwapAsset(value: SwapAssetIdentity): CandidateAsset {
  return binancePegPolicyAsset(value.chain, value.kind, value.identifier) ?? resolveAllowlistAsset({ chain: value.chain, kind: value.kind,
    ...(value.identifier === null ? {} : { identifier: value.identifier }) }, loadAllowlistInventory());
}
