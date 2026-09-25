export declare const RELAY_ARBITRUM_USDC = "0xaf88d065e77c8cC2239327C5EDb3A432268e5831";
export declare const RELAY_ETHEREUM_USDC_RECIPIENT = "0x991e254B5C8e0AAf6c244eaa2706BAd059809b04";
export interface RelayArbitrumQuoteIntent {
    readonly payer: string;
    readonly amountAtomic: string;
    readonly minimumOutputAtomic: string;
    readonly nowSeconds: number;
}
export declare function relayArbitrumUsdcEthereumUsdcQuoteRequest(intent: RelayArbitrumQuoteIntent): Record<string, unknown>;
/** Strictly projects the captured onchain V2 shape; never authorizes signing or sending. */
export declare function validateRelayArbitrumUsdcEthereumUsdcQuote(value: unknown, intent: RelayArbitrumQuoteIntent): Promise<{
    quoteDigest: string;
    schemaVersion: "apn.relay-arbitrum-usdc-ethereum-usdc-quote.v1";
    routeReference: "arbitrum-usdc-ethereum-usdc-observation-v1";
    statusLocator: import("./quote.js").RelayStatusLocator;
    orderId: string;
    orderSignature: string;
    solver: string;
    payer: string;
    recipient: string;
    sourceRefundRecipient: string;
    principalAtomic: string;
    minimumOutputAtomic: string;
    deadline: unknown;
    providerFeeAtomic: string;
    quotedDepositNetworkFeeWei: string;
    orderData: {
        version: string;
        solverChainId: string;
        solver: string;
        salt: string;
        inputs: {
            payment: {
                chainId: string;
                currency: string;
                amount: string;
                weight: string;
            };
            refunds: {
                chainId: string;
                recipient: string;
                currency: string;
                minimumAmount: string;
                deadline: unknown;
                extraData: string;
            }[];
        }[];
        output: {
            chainId: string;
            payments: {
                recipient: string;
                currency: string;
                minimumAmount: string;
                expectedAmount: string;
            }[];
            calls: never[];
            deadline: unknown;
            extraData: string;
        };
        fees: never[];
    };
    paymentDetails: {
        chainId: "arbitrum";
        depository: string;
        currency: string;
        amount: string;
    };
    approval: {
        from: string;
        to: string;
        data: string;
        value: "0";
        chainId: 42161;
        gas: string;
        maxFeePerGas: string;
        maxPriorityFeePerGas: string;
        maximumNetworkFeeWei: string;
    };
    deposit: {
        from: string;
        to: string;
        data: string;
        value: "0";
        chainId: 42161;
        gas: string;
        maxFeePerGas: string;
        maxPriorityFeePerGas: string;
        maximumNetworkFeeWei: string;
    };
}>;
