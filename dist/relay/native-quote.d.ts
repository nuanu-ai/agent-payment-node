import { type RelayStatusLocator } from "./quote.js";
export declare const RELAY_BNB_POLYGON_ROUTE_REFERENCE = "bnb-native-polygon-native-v1";
export declare const POLYGON_USDC = "0x3c499c542cef5e3811e1192ce70d8cc03d5c3359";
export declare const RELAY_BNB_SOURCE = "0x823A3a5BaB1186141b32fC65F8E25Ca24c679Ce7";
export declare const RELAY_POLYGON_RECIPIENT = "0x0B4Dd0C3dA001Fa146EEd3f80B01860BEF6B8a14";
export interface RelayNativeQuoteIntent {
    readonly payer: string;
    readonly recipient: string;
    readonly amountAtomic: string;
    readonly minimumOutputWei: string;
    readonly nowSeconds: number;
}
export declare function relayNativeQuoteRequest(intent: RelayNativeQuoteIntent): Record<string, unknown>;
export interface ValidatedRelayNativeQuote {
    readonly schemaVersion: "apn.relay-native-quote.v1";
    readonly routeReference: typeof RELAY_BNB_POLYGON_ROUTE_REFERENCE;
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
        chainId: "bnb";
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
        chainId: 56;
        gas: string;
        maxFeePerGas: string;
        maxPriorityFeePerGas: string;
        maximumNetworkFeeWei: string;
    }>;
}
export declare function validateRelayNativeQuote(value: unknown, intent: RelayNativeQuoteIntent): Promise<ValidatedRelayNativeQuote>;
/** One public quote POST, no API key or retry. */
export declare function requestRelayNativeQuote(intent: RelayNativeQuoteIntent, fetcher?: typeof fetch, now?: () => number): Promise<ValidatedRelayNativeQuote>;
