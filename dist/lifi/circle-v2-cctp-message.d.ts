import type { NonEvmSourceJournal } from "./non-evm-source-journal.js";
export declare const CCTP_BASE_DOMAIN = 6, CCTP_SOLANA_DOMAIN = 5;
export interface CctpBurnMessage {
    readonly bytes: Buffer;
    readonly sha256: string;
    readonly nonce: string;
    readonly sourceDomain: number;
    readonly destinationDomain: number;
    readonly burnToken: string;
    readonly mintRecipient: string;
    readonly amount: bigint;
    readonly messageSender: string;
    readonly maxFee: bigint;
    readonly feeExecuted: bigint;
}
/** What the journal's own burn fixes: the principal, the Solana token account (as bytes32) and the Base messenger. */
export interface CircleBurnTerms {
    readonly amount: bigint;
    readonly mintRecipient: string;
    readonly messageSender: string;
    readonly recipientOwner: string;
    readonly recipientAta: string;
}
/** The burn's terms from the journal's calldata and admission; null when they disagree (the calldata is the signed truth). */
export declare function circleBurnTerms(journal: NonEvmSourceJournal): CircleBurnTerms | null;
/** A version 1 burn message of exactly one body and hook data; null for any other layout. */
export declare function decodeCctpBurnMessage(bytes: Buffer): CctpBurnMessage | null;
/** Whether an attested message is this burn's: Base to Solana, Base USDC, the journal's messenger, account and principal. */
export declare function messageBindsBurn(message: CctpBurnMessage, terms: CircleBurnTerms): boolean;
/** The message bytes of a MessageTransmitterV2 `receive_message` instruction (Anchor: discriminator, two borsh vectors). */
export declare function receiveMessageBytes(data: unknown): Buffer | null;
