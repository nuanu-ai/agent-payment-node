import { type RelayStatusLocator } from "./quote.js";
export { POLYGON_USDC, RELAY_BNB_POLYGON_ROUTE_REFERENCE, RELAY_BNB_MONAD_ROUTE_REFERENCE, RELAY_BASE_MEGA_ROUTE_REFERENCE, RELAY_BASE_POLYGON_ROUTE_REFERENCE, RELAY_LEGACY_BNB_MONAD_DEFAULT_REFERENCE, RELAY_LEGACY_BASE_MEGA_REFERENCE, RELAY_LEGACY_BASE_POLYGON_REFERENCE, RELAY_MEGA_USDM } from "./native-routes.js";
export interface RelayNativeQuoteIntent {
    readonly payer: string;
    readonly recipient: string;
    readonly amountAtomic: string;
    readonly minimumOutputWei: string;
    readonly nowSeconds: number;
    /** A route of the native route table; prepare picks it from (source chain, destination chain). */
    readonly routeReference: string;
    /** The caller's deposit network fee ceiling. On Base it is the full OP Stack budget (L2 + L1 + operator fee). */
    readonly maximumNetworkFeeWei: string;
}
/** The protocol row of a quote's route, current or legacy; owner identity never selects a route. */
export declare function relayNativeQuoteRoute(reference: string): import("./native-routes.js").RelayNativeRoute & {
    readonly reference: string;
    readonly legacy: boolean;
};
export declare function relayNativeQuoteRequest(intent: RelayNativeQuoteIntent): Record<string, unknown>;
export interface ValidatedRelayNativeQuote {
    readonly schemaVersion: "apn.relay-native-quote.v1";
    readonly routeReference: string;
    readonly quoteDigest: string;
    readonly statusLocator?: RelayStatusLocator;
    readonly orderId: string;
    readonly orderSignature: string;
    readonly solver: string;
    readonly payer: string;
    readonly recipient: string;
    readonly principalAtomic: string;
    readonly orderData: Readonly<Record<string, unknown>>;
    readonly paymentDetails: Readonly<{
        chainId: "bnb" | "base";
        depository: string;
        currency: string;
        amount: string;
    }>;
    readonly minimumOutputWei: string;
    readonly deadline: number;
    readonly deposit: Readonly<{
        from: string;
        to: string;
        data: string;
        value: string;
        chainId: 56 | 8453;
        gas: string;
        maxFeePerGas: string;
        maxPriorityFeePerGas: string;
        maximumNetworkFeeWei: string;
    }>;
}
export declare function validateRelayNativeQuote(value: unknown, intent: RelayNativeQuoteIntent): Promise<ValidatedRelayNativeQuote>;
/** Recheck the saved quote's solver authority and native deposit at the execution boundary. */
export declare function verifySavedRelayNativeQuote(quote: ValidatedRelayNativeQuote): Promise<void>;
/** One public quote POST, no API key or retry. */
export declare function requestRelayNativeQuote(intent: RelayNativeQuoteIntent, fetcher?: typeof fetch, now?: () => number): Promise<ValidatedRelayNativeQuote>;
