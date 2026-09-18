import { ApnError } from "../errors.js";

/** A swap request whose slippage tolerance exceeds the owner's cap: refused before any quote, with both values named. */
export function slippageAboveCap(protocol: string, slippageBps: number, ownerSlippageCapBps: number): never {
  throw new ApnError("APN_INVALID_INPUT", `${protocol} slippage ${slippageBps} bps exceeds the owner cap of ${ownerSlippageCapBps} bps.`,
    { reason: "swap_slippage_above_owner_cap", slippage_bps: String(slippageBps), owner_slippage_cap_bps: String(ownerSlippageCapBps) });
}
