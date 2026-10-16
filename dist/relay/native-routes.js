/** Relay native-source routes (OWNR R2): protocol data only, keyed by the policy mechanism reference. No payer,
 * recipient, profile or amount lives here; those are per-operation inputs bound into the signed order. */
import { protocolRow } from "../stored-record-binding.js";
export const RELAY_NATIVE_CURRENCY = "0x0000000000000000000000000000000000000000";
export const POLYGON_USDC = "0x3c499c542cef5e3811e1192ce70d8cc03d5c3359";
export const RELAY_MEGA_USDM = "0xfafddbb3fc7688494971a79cc65dca3ef82079e7";
export const RELAY_BNB_POLYGON_ROUTE_REFERENCE = "bnb-native-polygon-native-v1";
export const RELAY_BNB_MONAD_ROUTE_REFERENCE = "bnb-native-monad-native-v1";
export const RELAY_BASE_MEGA_ROUTE_REFERENCE = "base-native-megaeth-usdm-v1";
export const RELAY_BASE_POLYGON_ROUTE_REFERENCE = "base-native-polygon-native-v1";
/** Owner-named references written by 0.5.43 and earlier (OWNR 5.3). Their operations still load, execute, observe and
 * retire under the policy pin they were prepared with; no new prepare names them. */
export const RELAY_LEGACY_BNB_MONAD_DEFAULT_REFERENCE = "bnb-native-monad-native-default-v1";
export const RELAY_LEGACY_BASE_MEGA_REFERENCE = "base-native-mega-usdm-default-v1";
export const RELAY_LEGACY_BASE_POLYGON_REFERENCE = "base-native-polygon-native-buyer-v1";
const BNB_POLYGON = { sourceChainId: 56, sourceChain: "bnb", chainId: 137, chain: "polygon",
    currency: RELAY_NATIVE_CURRENCY, refundCurrency: POLYGON_USDC };
const BNB_MONAD = { sourceChainId: 56, sourceChain: "bnb", chainId: 143, chain: "monad",
    currency: RELAY_NATIVE_CURRENCY, refundCurrency: RELAY_NATIVE_CURRENCY };
const BASE_MEGA = { sourceChainId: 8453, sourceChain: "base", chainId: 4326, chain: "megaeth",
    currency: RELAY_MEGA_USDM, refundCurrency: RELAY_MEGA_USDM };
const BASE_POLYGON = { sourceChainId: 8453, sourceChain: "base", chainId: 137, chain: "polygon",
    currency: RELAY_NATIVE_CURRENCY, refundCurrency: POLYGON_USDC };
/** The four physical routes new prepares use, one per (source chain, destination chain). */
const ROUTES = {
    [RELAY_BNB_POLYGON_ROUTE_REFERENCE]: BNB_POLYGON, [RELAY_BNB_MONAD_ROUTE_REFERENCE]: BNB_MONAD,
    [RELAY_BASE_MEGA_ROUTE_REFERENCE]: BASE_MEGA, [RELAY_BASE_POLYGON_ROUTE_REFERENCE]: BASE_POLYGON,
};
/** Frozen decoders for owner-named references: the same physical routes. */
const LEGACY_ROUTES = {
    [RELAY_LEGACY_BNB_MONAD_DEFAULT_REFERENCE]: BNB_MONAD, [RELAY_LEGACY_BASE_MEGA_REFERENCE]: BASE_MEGA,
    [RELAY_LEGACY_BASE_POLYGON_REFERENCE]: BASE_POLYGON,
};
/** The route a new prepare uses for (source chain, destination chain), or null when Relay native has none. */
export function relayNativeRouteFor(sourceChainId, destinationChainId) {
    const entry = Object.entries(ROUTES).find(([, row]) => row.sourceChainId === sourceChainId && row.chainId === destinationChainId);
    return entry === undefined ? null : { ...entry[1], reference: entry[0] };
}
/** The route a saved quote names: a current route, or a frozen legacy one for operations that already name it. */
export function relayNativeRouteByReference(reference) {
    const found = protocolRow(reference, ROUTES, LEGACY_ROUTES);
    return found === null ? null : { ...found.row, reference, legacy: found.legacy };
}
//# sourceMappingURL=native-routes.js.map