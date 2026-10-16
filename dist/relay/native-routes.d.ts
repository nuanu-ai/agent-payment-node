export declare const RELAY_NATIVE_CURRENCY = "0x0000000000000000000000000000000000000000";
export declare const POLYGON_USDC = "0x3c499c542cef5e3811e1192ce70d8cc03d5c3359";
export declare const RELAY_MEGA_USDM = "0xfafddbb3fc7688494971a79cc65dca3ef82079e7";
export declare const RELAY_BNB_POLYGON_ROUTE_REFERENCE = "bnb-native-polygon-native-v1";
export declare const RELAY_BNB_MONAD_ROUTE_REFERENCE = "bnb-native-monad-native-v1";
export declare const RELAY_BASE_MEGA_ROUTE_REFERENCE = "base-native-megaeth-usdm-v1";
export declare const RELAY_BASE_POLYGON_ROUTE_REFERENCE = "base-native-polygon-native-v1";
/** Owner-named references written by 0.5.43 and earlier (OWNR 5.3). Their operations still load, execute, observe and
 * retire under the policy pin they were prepared with; no new prepare names them. */
export declare const RELAY_LEGACY_BNB_MONAD_DEFAULT_REFERENCE = "bnb-native-monad-native-default-v1";
export declare const RELAY_LEGACY_BASE_MEGA_REFERENCE = "base-native-mega-usdm-default-v1";
export declare const RELAY_LEGACY_BASE_POLYGON_REFERENCE = "base-native-polygon-native-buyer-v1";
export type RelayNativeSourceChainId = 56 | 8453;
export type RelayNativeDestinationChainId = 137 | 143 | 4326;
export interface RelayNativeRoute {
    readonly sourceChainId: RelayNativeSourceChainId;
    readonly sourceChain: "bnb" | "base";
    readonly chainId: RelayNativeDestinationChainId;
    readonly chain: "polygon" | "monad" | "megaeth";
    /** Destination output currency; the zero address is the destination's native coin. */
    readonly currency: string;
    /** Destination refund currency Relay names in its signed order (source refunds are always the native input). */
    readonly refundCurrency: string;
}
/** The route a new prepare uses for (source chain, destination chain), or null when Relay native has none. */
export declare function relayNativeRouteFor(sourceChainId: number, destinationChainId: number): RelayNativeRoute & {
    readonly reference: string;
} | null;
/** The route a saved quote names: a current route, or a frozen legacy one for operations that already name it. */
export declare function relayNativeRouteByReference(reference: string): RelayNativeRoute & {
    readonly reference: string;
    readonly legacy: boolean;
} | null;
