export interface CircleV2ExpectedBurn {
    /** Independently known successful Base source transaction. */
    readonly sourceTransactionHash: string;
    /** Solana USDC associated token account, as the exact 32-byte account key. */
    readonly mintRecipient: string;
    readonly amountAtomic: string;
    readonly messageSender: string;
    /** BurnMessageV2 sender when it differs from the CCTP header sender. */
    readonly burnMessageSender?: string;
    /** Expected CCTP TokenMessengerV2 recipient on Solana, as bytes32. */
    readonly messageRecipient: string;
    readonly maxFeeAtomic: string;
    readonly hookData: string;
    readonly minFinalityThreshold: 1000 | 2000;
    readonly finalityThresholdExecuted: 1000 | 2000;
}
export interface CircleV2IrisHint {
    readonly kind: "offline_circle_cctp_v2_iris_hint";
    readonly sourceTransactionHash: string;
    readonly message: string;
    readonly attestation: string;
    readonly nonce: string;
    /** Shape-checked Iris API metadata; not an onchain-verified V2 message nonce. */
    readonly eventNonce: string;
    readonly sender: string;
    readonly recipient: string;
    readonly mintRecipient: string;
    readonly amountAtomic: string;
    readonly maxFeeAtomic: string;
    readonly feeExecutedAtomic: string;
    readonly expirationBlock: string;
    readonly hookData: string;
    readonly minFinalityThreshold: 1000 | 2000;
    readonly finalityThresholdExecuted: 1000 | 2000;
    readonly providerStatus: "complete";
    readonly attestationAuthenticated: false;
    readonly bridgeCompletion: false;
}
/** Accepts the raw JSON body of GET /v2/messages/6?transactionHash=<expected hash>. */
export declare function inspectCircleV2IrisOffline(response: unknown, expected: CircleV2ExpectedBurn): CircleV2IrisHint;
