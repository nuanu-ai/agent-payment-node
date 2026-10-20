import { getCompiledTransactionMessageDecoder } from "@solana/kit";
/** Everything the signed message binds besides its lifetime; frozen at prepare. */
export interface X402SolanaMessageTerms {
    readonly payer: string;
    readonly feePayer: string;
    readonly mint: string;
    readonly decimals: number;
    readonly sourceTokenAccount: string;
    readonly destinationTokenAccount: string;
    readonly amountAtomic: string;
    readonly computeUnitLimit: number;
    readonly computeUnitPriceMicroLamports: string;
}
export interface X402SolanaLifetime {
    readonly blockhash: string;
    readonly lastValidBlockHeight: string;
}
/** The one v0 message this payment may sign: the facilitator pays the fee, the payer only authorizes the transfer. */
export declare function x402SolanaMessage(terms: X402SolanaMessageTerms, lifetime: X402SolanaLifetime): {
    transaction: Readonly<import("@solana/kit").TransactionWithBlockhashLifetime & Readonly<{
        messageBytes: import("@solana/kit").TransactionMessageBytes;
        signatures: import("@solana/kit").SignaturesMap;
    }>>;
    messageBase64: string;
    messageHash: string;
    unsignedPayload: import("@solana/kit").Base64EncodedWireTransaction;
};
/**
 * Checked before anything is signed, independently of how the bytes were built: a v0 message without lookup tables, the
 * fee payer first and the payer second as the only signers, exactly SetComputeUnitLimit, SetComputeUnitPrice and one
 * classic SPL TransferChecked of the frozen amount and decimals from the payer's account to the payee's, and the fee
 * payer in no instruction at all.
 */
export declare function assertExactMessage(messageBytes: Parameters<ReturnType<typeof getCompiledTransactionMessageDecoder>["decode"]>[0], terms: X402SolanaMessageTerms, lifetime: X402SolanaLifetime): void;
/** The partially signed wire bytes: this message, the payer's verified signature, and an empty fee payer slot. */
export declare function assertPayerSigned(rawPayload: string, messageBase64: string, payer: string, feePayer: string): Promise<string>;
