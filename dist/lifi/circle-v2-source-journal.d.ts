import type { CircleV2SourcePreparation } from "./circle-v2-source-preparation.js";
import type { NonEvmSourceBinding } from "./non-evm-source-journal.js";
declare const route: "base_usdc_to_solana_usdc_circle_cctp_v2";
export interface CircleV2SourceJournalInput {
    readonly preparation: CircleV2SourcePreparation;
    readonly route: typeof route;
    readonly payer: string;
    readonly draftIntegrityDigest: string;
    readonly preparationDigest: string;
    readonly profileHash: string;
    readonly operationId: string;
    readonly createdAt: string;
    /** Caller-controlled context remains synthetic; no validation or execution authority is conferred. */
    readonly admission: Readonly<{
        claimedValidationHash: string;
        note: string;
        minFinalityThreshold: 1000 | 2000;
    }>;
}
/** protocolInputHash is returned separately; journal v1 does not persist this field. */
export interface CircleV2SourceJournalBinding {
    readonly binding: NonEvmSourceBinding;
    readonly protocolInputHash: string;
    readonly executionAdmitted: false;
    readonly provenance: "synthetic_untrusted";
}
export declare function bindCircleV2SourcePreparationToJournal(input: CircleV2SourceJournalInput): CircleV2SourceJournalBinding;
export {};
