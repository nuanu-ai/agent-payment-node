import { SWAP_MECHANISM_PIN_SCHEMA, validateSwapMechanismPin } from "../pin.js";
import { compileSwapProtocolRegistry } from "../protocol-registry.js";
import { SUNSWAP_TRON_CHAIN, SUNSWAP_V2_FACTORY, SUNSWAP_V2_ROUTER, SUNSWAP_V2_WTRX_USDT_PAIR, SUNSWAP_WTRX } from "./catalog.js";
/**
 * The keyless SunSwap V2 mechanism: quotes come from the pinned router and pair by constant calls, the single
 * swapExactETHForTokens call is encoded by APN's local ABI builder, and only the owner's local TRON key signs it.
 * Owners admit native TRX and canonical USDT for the swap rail with exactly this pin.
 */
export const SUNSWAP_V2_KEYLESS_MECHANISM_PIN = validateSwapMechanismPin({
    schemaVersion: SWAP_MECHANISM_PIN_SCHEMA, protocolFamily: "sunswap_tron", networkFamily: "tron", chain: SUNSWAP_TRON_CHAIN,
    protocolVersion: "2.0.0", constructorKind: "sdk", constructorIdentity: "apn.sunswap-v2.local-abi-builder",
    constructorVersion: "1.0.0", routerProgramIdentity: SUNSWAP_V2_ROUTER,
    auxiliaryContractProgramIdentities: [SUNSWAP_V2_FACTORY, SUNSWAP_V2_WTRX_USDT_PAIR, SUNSWAP_WTRX],
    quoteSchemaVersion: "v2-router-getamountsout-pair-getreserves.1",
    transactionSchemaVersion: "v2-router-swapexactethfortokens-owner-recipient.1",
    validationPolicyIdentity: "apn.sunswap.tron-native-v2-keyless", validationPolicyVersion: "1.0.0",
});
/** Official identity only. Owners must still admit TRX and USDT with this exact pin under a sealed active policy. */
export const SUNSWAP_V2_KEYLESS_PROTOCOL_REGISTRY = compileSwapProtocolRegistry({
    registryVersion: "sunswap-v2-keyless.2026-09-18", pins: [SUNSWAP_V2_KEYLESS_MECHANISM_PIN],
});
//# sourceMappingURL=mechanism.js.map