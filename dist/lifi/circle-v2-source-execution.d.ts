/** Explicit Circle V2 Base source submission. Source success never implies Solana delivery. */
import { type Hex } from "viem";
import { type CircleV2DraftInput } from "./circle-v2-draft.js";
import { type CircleV2BaseStateReader, type CircleV2SourcePreparation, type CircleV2SourcePreparationLimits } from "./circle-v2-source-preparation.js";
import { type CircleV2PreflightTransport } from "./circle-v2-preflight.js";
import { NonEvmSourceJournalRepository, type NonEvmSourceJournal } from "./non-evm-source-journal.js";
export interface CircleV2SourceExecutionPorts {
    /** Fetch and assemble a new Circle quote and matching calldata for this invocation. */
    readonly freshDraft: () => Promise<CircleV2DraftInput>;
    readonly preflight: CircleV2PreflightTransport;
    readonly readBase: CircleV2BaseStateReader;
    /** Imported local EVM signer; never a generated or delegated account. */
    readonly signer: Readonly<{
        kind: "imported_evm_signer";
        address: string;
        signTransaction: (tx: Readonly<{
            type: "eip1559";
            chainId: 8453;
            to: Hex;
            data: Hex;
            value: bigint;
            nonce: number;
            gas: bigint;
            maxFeePerGas: bigint;
            maxPriorityFeePerGas: bigint;
            accessList: readonly [];
        }>) => Promise<Hex>;
    }>;
    readonly sendRawTransaction: (raw: Hex) => Promise<Hex>;
    readonly approve: (preparation: CircleV2SourcePreparation) => Promise<void>;
    readonly journal: NonEvmSourceJournalRepository;
    readonly now?: () => number;
}
export interface CircleV2SourceExecutionIntent {
    readonly payer: string;
    readonly solanaWalletOwner: string;
    readonly solanaRecipientAta: string;
    readonly recipientSetup: "existing_ata" | "create_ata";
    readonly profileHash: string;
    readonly operationId: string;
    readonly limits: CircleV2SourcePreparationLimits;
    readonly claimedValidationHash: string;
    readonly minFinalityThreshold: 1000 | 2000;
}
export interface CircleV2SourceSubmission {
    readonly journal: NonEvmSourceJournal;
    readonly sourceTransactionHash: Hex;
    readonly sourceState: "submitted_pending" | "unknown_finality";
    readonly circleAttestationObserved: false;
    readonly solanaDestinationFinalized: false;
    readonly bridgeCompletion: false;
}
/** Requires an exact imported signer and fresh quote, validation, pinned simulation, allowance, nonce and gas reads. */
export declare function submitCircleV2BaseSourceBurn(intent: CircleV2SourceExecutionIntent, ports: CircleV2SourceExecutionPorts): Promise<CircleV2SourceSubmission>;
