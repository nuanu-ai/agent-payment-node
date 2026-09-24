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
    readonly orderId: string;
    readonly minimumOutputWei: string;
    readonly deadline: number;
    readonly approval: Readonly<{
        from: string;
        to: string;
        data: string;
        value: "0";
        chainId: 1;
    }>;
    readonly deposit: Readonly<{
        from: string;
        to: string;
        data: string;
        value: "0";
        chainId: 1;
    }>;
}
export declare function validateRelayQuote(value: unknown, intent: RelayQuoteIntent): Promise<ValidatedRelayQuote>;
/** One POST, no API key, no retry. The caller receives a validated unsigned envelope only. */
export declare function requestRelayQuote(intent: RelayQuoteIntent, fetcher?: typeof fetch, now?: () => number): Promise<ValidatedRelayQuote>;
