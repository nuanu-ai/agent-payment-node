export declare const ETHEREUM_USDC = "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48";
export declare const BNB_NATIVE = "0x0000000000000000000000000000000000000000";
export declare const ETHEREUM_DEPOSITORY = "0x4cd00e387622c35bddb9b4c962c136462338bc31";
export declare const RELAY_SOLVER = "0xf70da97812cb96acdf810712aa562db8dfa3dbef";
export interface RelayQuoteIntent {
    readonly payer: string;
    readonly recipient: string;
    readonly amountAtomic: string;
    readonly minimumOutputWei: string;
    readonly nowSeconds: number;
}
export declare function relayQuoteRequest(intent: RelayQuoteIntent): Record<string, unknown>;
export interface ValidatedRelayQuote {
    readonly schemaVersion: "apn.relay-quote.v1";
    readonly quoteDigest: string;
    readonly orderId: string;
    readonly orderSignature: string;
    readonly solver: string;
    readonly payer: string;
    readonly recipient: string;
    readonly sourceRefundRecipient: string;
    readonly principalAtomic: string;
    readonly orderData: Readonly<{
        version: "v1";
        solverChainId: "base";
        solver: string;
        salt: string;
        inputs: readonly Readonly<{
            payment: Readonly<{
                chainId: "ethereum";
                currency: string;
                amount: string;
                weight: "1";
            }>;
            refunds: readonly Readonly<{
                chainId: "ethereum" | "bnb";
                recipient: string;
                currency: string;
                minimumAmount: "0";
                deadline: number;
                extraData: string;
            }>[];
        }>[];
        output: Readonly<{
            chainId: "bnb";
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
        chainId: "ethereum";
        depository: string;
        currency: string;
        amount: string;
    }>;
    readonly minimumOutputWei: string;
    readonly deadline: number;
    readonly approval: RelayQuoteTransaction;
    readonly deposit: RelayQuoteTransaction;
}
export interface RelayQuoteTransaction {
    readonly from: string;
    readonly to: string;
    readonly data: string;
    readonly value: "0";
    readonly chainId: 1;
    readonly gas: string;
    readonly maxFeePerGas: string;
    readonly maxPriorityFeePerGas: string;
    readonly maximumNetworkFeeWei: string;
}
export declare function validateRelayQuote(value: unknown, intent: RelayQuoteIntent): Promise<ValidatedRelayQuote>;
/** One POST, no API key, no retry. The caller receives a validated unsigned envelope only. */
export declare function requestRelayQuote(intent: RelayQuoteIntent, fetcher?: typeof fetch, now?: () => number): Promise<ValidatedRelayQuote>;
