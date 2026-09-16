import { type CircleV2PreflightInput, type CircleV2PreflightTransport } from "./circle-v2-preflight.js";
export interface CircleV2DraftInput extends CircleV2PreflightInput {
    readonly executable?: false;
}
export interface CircleV2PreflightedDraft {
    readonly kind: "circle_v2_preflighted_draft";
    readonly state: "preflighted_unsubmitted";
    readonly executionAdmitted: false;
    readonly sourceChainId: 8453;
    readonly sourcePayer: string;
    readonly sourceTransaction: {
        readonly to: string;
        readonly data: string;
        readonly valueAtomic: "0";
        readonly refundAddress: string;
    };
    readonly quoteEndpoint: string;
    readonly quoteRequest: unknown;
    readonly quoteResponse: unknown;
    readonly recipientWallet: string;
    readonly recipientAta: string;
    readonly recipientSetup: "existing_ata" | "create_ata";
    readonly amountAtomic: string;
    readonly quotedFeeAtomic: string;
    readonly maxSourceFeeAtomic: string;
    readonly preflight: {
        readonly blockNumber: string;
        readonly blockHash: string;
        readonly abiSignature: string;
    };
    /** SHA-256 over canonical JSON of all other draft fields, excluding integrityDigest. */
    readonly integrityDigest: string;
    readonly blockers: readonly string[];
}
/** The returned data is an unsubmitted inspection record; callers must re-preflight before any later submission. */
export declare function inspectCircleV2PreflightedDraft(input: CircleV2DraftInput, transport: CircleV2PreflightTransport): Promise<CircleV2PreflightedDraft>;
