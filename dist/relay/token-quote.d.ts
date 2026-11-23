import { type RelayStatusLocator } from "./quote.js";
import { type RelayTokenChainId, type RelayTokenRoute } from "./token-routes.js";
export interface RelayTokenQuoteIntent {
    readonly routeReference: string;
    readonly payer: string;
    readonly recipient: string;
    /** Source token atomic units (its own decimals). */
    readonly amountAtomic: string;
    /** Destination token atomic units (its own decimals). */
    readonly minimumOutputAtomic: string;
    readonly nowSeconds: number;
}
export interface RelayTokenTransaction {
    readonly from: string;
    readonly to: string;
    readonly data: string;
    readonly value: "0";
    readonly chainId: RelayTokenChainId;
    readonly gas: string;
    readonly maxFeePerGas: string;
    readonly maxPriorityFeePerGas: string;
    readonly maximumNetworkFeeWei: string;
}
type Refund = Readonly<{
    chainId: string;
    recipient: string;
    currency: string;
    minimumAmount: "0";
    deadline: number;
    extraData: string;
}>;
export interface ValidatedRelayTokenQuote {
    readonly schemaVersion: "apn.relay-token-quote.v1";
    readonly routeReference: string;
    readonly quoteDigest: string;
    readonly statusLocator: RelayStatusLocator;
    readonly orderId: string;
    readonly orderSignature: string;
    readonly solver: string;
    readonly payer: string;
    readonly recipient: string;
    readonly sourceRefundRecipient: string;
    readonly sourceToken: string;
    readonly sourceDecimals: number;
    readonly destinationToken: string;
    readonly destinationDecimals: number;
    readonly principalAtomic: string;
    readonly orderData: Readonly<{
        version: "v1";
        solverChainId: "base";
        solver: string;
        salt: string;
        inputs: readonly Readonly<{
            payment: Readonly<{
                chainId: string;
                currency: string;
                amount: string;
                weight: "1";
            }>;
            refunds: readonly Refund[];
        }>[];
        output: Readonly<{
            chainId: string;
            payments: readonly Readonly<{
                recipient: string;
                currency: string;
                minimumAmount: string;
                expectedAmount: string;
            }>[];
            calls: readonly [];
            deadline: number;
            extraData: string;
        }>;
        fees: readonly [];
    }>;
    readonly paymentDetails: Readonly<{
        chainId: string;
        depository: string;
        currency: string;
        amount: string;
    }>;
    readonly minimumOutputAtomic: string;
    readonly deadline: number;
    readonly approval: RelayTokenTransaction;
    readonly deposit: RelayTokenTransaction;
}
/** The protocol row a quote names; an unknown reference is an invalid quote. */
export declare function relayTokenQuoteRoute(reference: string): RelayTokenRoute;
export declare function relayTokenQuoteRequest(intent: RelayTokenQuoteIntent): Record<string, unknown>;
export declare function validateRelayTokenQuote(value: unknown, intent: RelayTokenQuoteIntent): Promise<ValidatedRelayTokenQuote>;
/** The saved quote is the exact projection of its route: digest, identities, order id, solver signature and calldata. */
export declare function verifySavedRelayTokenQuote(quote: ValidatedRelayTokenQuote): Promise<RelayTokenRoute>;
/** Synchronous binding of a saved quote to its route row (no signature recovery). */
export declare function assertSavedRelayTokenQuote(quote: ValidatedRelayTokenQuote, route: RelayTokenRoute): void;
/** The read and the one revoke that clear an existing depository allowance; the same prepare then quotes both steps. */
export declare function withRelayTokenAllowanceActions(error: unknown, profile: string): unknown;
/** One keyless POST, no API key or retry; a declined, unanswered or unreadable quote is classified by `postRelayQuote`. */
export declare function requestRelayTokenQuote(intent: RelayTokenQuoteIntent, fetcher?: typeof fetch, now?: () => number): Promise<ValidatedRelayTokenQuote>;
export {};
