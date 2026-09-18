import { type SwapMechanismPin } from "../pin.js";
import { type SwapProtocolRegistry } from "../protocol-registry.js";
/**
 * The keyless SunSwap V2 mechanism: quotes come from the pinned router and pair by constant calls, the single
 * swapExactETHForTokens call is encoded by APN's local ABI builder, and only the owner's local TRON key signs it.
 * Owners admit native TRX and canonical USDT for the swap rail with exactly this pin.
 */
export declare const SUNSWAP_V2_KEYLESS_MECHANISM_PIN: SwapMechanismPin;
/** Official identity only. Owners must still admit TRX and USDT with this exact pin under a sealed active policy. */
export declare const SUNSWAP_V2_KEYLESS_PROTOCOL_REGISTRY: SwapProtocolRegistry;
