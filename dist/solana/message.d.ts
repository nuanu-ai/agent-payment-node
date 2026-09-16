import { type Instruction } from "@solana/kit";
import type { RailPreparedTransfer, RailSendBinding, RailSignedEffect } from "../direct-rail-ports.js";
/** Only the two lifetime fields are needed to compile bytes, so the guard can compile before it simulates. */
export type RailSendLifetime = Pick<RailSendBinding, "blockReference" | "lastValidBlockHeight">;
/** `send` supersedes the preparation-time lifetime once the send guard has re-acquired one. */
export declare function solanaMessage(input: Pick<RailPreparedTransfer, "sender" | "recipient" | "asset" | "amountAtomic" | "blockReference" | "lastValidBlockHeight" | "createsRecipientAccount" | "sourceTokenAccount" | "destinationTokenAccount">, send?: RailSendLifetime | null): Promise<{
    transaction: Readonly<import("@solana/kit").TransactionWithBlockhashLifetime & Readonly<{
        messageBytes: import("@solana/kit").TransactionMessageBytes;
        signatures: import("@solana/kit").SignaturesMap;
    }>>;
    unsignedPayload: import("@solana/kit").Base64EncodedWireTransaction;
    messageBase64: string;
}>;
export declare function solanaTransferInstructions(input: Pick<RailPreparedTransfer, "sender" | "recipient" | "asset" | "amountAtomic" | "createsRecipientAccount" | "sourceTokenAccount" | "destinationTokenAccount">, rentPayer?: string): Promise<readonly Instruction[]>;
/**
 * Without a send binding the bytes must equal the frozen payload exactly. With one, every field but
 * the re-acquired lifetime must still equal it, which is proven by rebuilding from the same frozen
 * record and only substituting the lifetime the send guard recorded.
 */
export declare function validateSolanaMessage(prepared: RailPreparedTransfer, send?: RailSendBinding | null): Promise<{
    transaction: Readonly<import("@solana/kit").TransactionWithBlockhashLifetime & Readonly<{
        messageBytes: import("@solana/kit").TransactionMessageBytes;
        signatures: import("@solana/kit").SignaturesMap;
    }>>;
    unsignedPayload: import("@solana/kit").Base64EncodedWireTransaction;
    messageBase64: string;
}>;
export declare function validateSolanaEffect(prepared: RailPreparedTransfer, effect: RailSignedEffect, send?: RailSendBinding | null): Promise<void>;
