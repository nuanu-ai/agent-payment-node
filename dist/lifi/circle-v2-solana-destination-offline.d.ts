import { SOLANA_USDC } from "../chain-policy.js";
export declare const CIRCLE_V2_MESSAGE_TRANSMITTER = "CCTPV2Sm4AdWt5296sk4P66VBZ7bEhcARwFaaS9YPbeC";
export declare const CIRCLE_V2_TOKEN_MESSENGER = "CCTPV2vPZJS2u2BBsUoscuikbYjnpFmbFsvVuJdgUMQe";
export interface CircleV2SolanaDestinationInput {
    readonly signature: string;
    readonly recipient: string;
    readonly minimumOutputAtomic: string;
    readonly signatureStatuses: unknown;
    readonly transaction: unknown;
    /** Caller-authenticated Circle-attested message; this parser does not verify attester signatures. */
    readonly attestedMessageHex: string;
    readonly nonceHex: string;
}
/** A matched receive instruction and ATA delta are a candidate, not an event-backed mint receipt. */
export declare function inspectCircleV2SolanaDestinationOffline(input: CircleV2SolanaDestinationInput): Promise<{
    proofClass: "circle_v2_solana_receive_candidate";
    nonceHex: string;
    usedNoncePda: import("@solana/kit").Address<string>;
    sourceMessageCorrelation: "receive_instruction_matched";
    executionAdmitted: false;
    bridgeCompletion: false;
    blockers: string[];
    signature: string;
    slotAtomic: string;
    recipient: string;
    tokenAccount: string;
    mint: typeof SOLANA_USDC;
    receivedAtomic: string;
    minimumOutputAtomic: string;
}>;
/** Require the deployed Circle V2 handler, both CPI events, and its SPL transfer in one receive invocation. */
export declare function inspectCircleV2SolanaMintEventOffline(input: CircleV2SolanaDestinationInput): Promise<{
    proofClass: "circle_v2_solana_mint_event_candidate";
    sourceMessageCorrelation: "receive_cpi_mint_transfer_events_matched";
    executionAdmitted: false;
    bridgeCompletion: false;
    blockers: string[];
    nonceHex: string;
    usedNoncePda: import("@solana/kit").Address<string>;
    signature: string;
    slotAtomic: string;
    recipient: string;
    tokenAccount: string;
    mint: typeof SOLANA_USDC;
    receivedAtomic: string;
    minimumOutputAtomic: string;
}>;
