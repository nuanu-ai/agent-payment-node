import { type SolanaRpcPort } from "../solana/rpc.js";
export interface X402SolanaObservationInput {
    readonly payer: string;
    readonly payee: string;
    readonly feePayer: string;
    readonly mint: string;
    readonly sourceTokenAccount: string;
    readonly destinationTokenAccount: string;
    readonly amountAtomic: string;
    readonly messageBase64: string;
    /** Base64 of the payer's signature over the message, as signed. */
    readonly payerSignature: string;
    readonly lastValidBlockHeight: string;
    readonly floorSlot: string;
    /** The seller's PAYMENT-RESPONSE transaction, a hint only: it counts once the chain shows these exact bytes. */
    readonly hint?: string;
    readonly now: Date;
}
export interface X402SolanaSettlementEvidence {
    readonly signature: string;
    readonly slot: string;
    readonly success: boolean;
    readonly errorCanonicalJson: string | null;
    readonly source: "payment_response" | "signature_index";
    readonly observedAt: string;
    readonly rpcOriginHash: string;
}
export interface X402SolanaUnlandedEvidence {
    readonly finalizedBlockHeight: string;
    readonly lastValidBlockHeight: string;
    readonly floorSlot: string;
    readonly coverageSlot: string;
    readonly openedSignatures: number;
    readonly observedAt: string;
    readonly rpcOriginHash: string;
}
export type X402SolanaObservation = {
    readonly outcome: "landed";
    readonly settlement: X402SolanaSettlementEvidence;
} | {
    readonly outcome: "expired_unlanded";
    readonly unlanded: X402SolanaUnlandedEvidence;
} | {
    readonly outcome: "pending";
    readonly reason: string;
};
/**
 * The facilitator signs as fee payer, so the transaction id is not known before it lands. The finalized height is read
 * first; then the seller's hint (if any) and every finalized signature on the payer's token account newer than the
 * binding's floor slot are opened and compared byte for byte with the frozen message. A match settles the payment (or
 * proves it failed on chain). No match proves it never landed only when the finalized height is past the blockhash's
 * lastValidBlockHeight and the same signature page reaches back to the floor slot, so the index covers the whole window.
 */
export declare function observeX402SolanaPayment(rpc: SolanaRpcPort, input: X402SolanaObservationInput): Promise<X402SolanaObservation>;
