import { type Instruction } from "@solana/kit";
import type { RailPreparedTransfer, RailSignedEffect } from "../direct-rail-ports.js";
export declare function solanaMessage(input: Pick<RailPreparedTransfer, "sender" | "recipient" | "asset" | "amountAtomic" | "blockReference" | "lastValidBlockHeight" | "createsRecipientAccount" | "sourceTokenAccount" | "destinationTokenAccount">): Promise<{
    transaction: Readonly<import("@solana/kit").TransactionWithBlockhashLifetime & Readonly<{
        messageBytes: import("@solana/kit").TransactionMessageBytes;
        signatures: import("@solana/kit").SignaturesMap;
    }>>;
    unsignedPayload: import("@solana/kit").Base64EncodedWireTransaction;
    messageBase64: string;
}>;
export declare function solanaTransferInstructions(input: Pick<RailPreparedTransfer, "sender" | "recipient" | "asset" | "amountAtomic" | "createsRecipientAccount" | "sourceTokenAccount" | "destinationTokenAccount">, rentPayer?: string): Promise<readonly Instruction[]>;
export declare function validateSolanaMessage(prepared: RailPreparedTransfer): Promise<{
    transaction: Readonly<import("@solana/kit").TransactionWithBlockhashLifetime & Readonly<{
        messageBytes: import("@solana/kit").TransactionMessageBytes;
        signatures: import("@solana/kit").SignaturesMap;
    }>>;
    unsignedPayload: import("@solana/kit").Base64EncodedWireTransaction;
    messageBase64: string;
}>;
export declare function validateSolanaEffect(prepared: RailPreparedTransfer, effect: RailSignedEffect): Promise<void>;
