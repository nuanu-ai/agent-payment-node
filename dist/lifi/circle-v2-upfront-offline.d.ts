export interface CircleV2UpfrontInput {
    /** Saved POST /v2/quote/burn/usdc/6/5 request and response. No request is made here. */
    readonly quoteEndpoint: string;
    readonly quoteRequest: unknown;
    readonly quoteResponse: unknown;
    readonly transaction: unknown;
    readonly recipientWallet: string;
    readonly amountAtomic: string;
    readonly maxSourceFeeAtomic: string;
    /** Independently observed Base block, required for BLOCK_NUMBER expiry. */
    readonly sourceBlockNumber?: string;
    /** Explicit local intent: existing ATA or creation via Circle Forwarding Service. */
    readonly recipientSetup: "existing_ata" | "create_ata";
}
export interface CircleV2UpfrontEvidence {
    readonly kind: "offline_circle_v2_upfront_quote_inspection";
    readonly executionAdmitted: false;
    readonly sourceDomain: 6;
    readonly destinationDomain: 5;
    readonly wrapper: string;
    readonly recipientAta: string;
    readonly amountAtomic: string;
    readonly quotedFeeAtomic: string;
    readonly expiry: "future_on_supplied_block" | "future_on_local_clock";
    readonly recipientSetup: "existing_ata" | "create_ata";
    readonly blockers: readonly string[];
}
export declare function inspectCircleV2UpfrontOffline(input: CircleV2UpfrontInput): Promise<CircleV2UpfrontEvidence>;
