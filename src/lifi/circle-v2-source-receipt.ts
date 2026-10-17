/** Circle CCTP V2 Base source constants and the live FORWARD quote terms. */
import { getAddress } from "viem";
import { bridgeFailure, bridgeRecord, bridgeUint } from "./validation.js";

// Circle mainnet deployments: https://developers.circle.com/cctp/references/contract-addresses
export const BASE_CCTP_V2_TOKEN_MESSENGER_WITH_FEES = getAddress("0x71f54F818671cD0D7ea140Da213e5C8b5C92a408");

/** This live path admits only a FORWARD quote. The wrapper then selects Standard CCTP with zero burn maxFee. */
export function circleV2BurnTermsFromQuote(responseValue: unknown): { maxFeeAtomic: string; minFinalityThreshold: 1000 | 2000 } {
  const response = bridgeRecord(responseValue, "APN_PROVIDER_PROTOCOL");
  if (!Array.isArray(response.items) || response.items.length !== 1) fail("quote_items");
  const forward = bridgeRecord(response.items[0], "APN_PROVIDER_PROTOCOL");
  if (forward.type !== "FORWARD") fail("quote_items");
  const forwardFee = bridgeUint(forward.amount, false, "APN_PROVIDER_PROTOCOL");
  if (forwardFee !== bridgeUint(response.feeTotalAmount, false, "APN_PROVIDER_PROTOCOL")) fail("quote_fee_sum");
  return { maxFeeAtomic: "0", minFinalityThreshold: 2000 };
}
function fail(reason: string): never { return bridgeFailure("APN_RPC_PROTOCOL", `circle_v2_source_${reason}`); }
