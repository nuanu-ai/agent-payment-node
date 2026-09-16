import type { NonEvmSourceBinding } from "./non-evm-source-journal.js";
import type { NearTronSourcePreparation } from "./near-tron-source-preparation.js";
export interface NearTronSourceJournalInput {
    readonly preparation: NearTronSourcePreparation;
    readonly draft: unknown;
    readonly quote: unknown;
    readonly profileHash: string;
    readonly operationId: string;
    readonly createdAt: string;
    /** Synthetic claims are recorded as untrusted. The signer and facet must be independently established. */
    readonly syntheticAdmission: Readonly<{
        backendSigner: string;
        facetAddress: string;
        facetCodeHash: string;
        claimedValidationHash: string;
        note: string;
    }>;
}
export interface NearTronSourceJournalProjection {
    readonly executionAdmitted: false;
    readonly evidenceTrust: "untrusted_quote_and_rpc";
    /** Not stored in journal v1; a future versioned journal must bind this before execution. */
    readonly protocolInputHash: string;
    readonly binding: NonEvmSourceBinding;
}
export declare function bindNearTronSourcePreparationToJournal(input: NearTronSourceJournalInput): NearTronSourceJournalProjection;
