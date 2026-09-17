import type { SolanaProofReaderPort } from "./ports.js";
import type { JupiterV0Envelope } from "./transaction.js";
export interface JupiterSimulationProof {
    readonly requestHash: string;
    readonly resultHash: string;
    readonly unitsConsumed: string;
    readonly success: true;
}
export declare function proveJupiterSimulation(reader: SolanaProofReaderPort, envelope: JupiterV0Envelope, minimumContextSlot: number): Promise<JupiterSimulationProof>;
export interface JupiterReceiptExpectation {
    readonly signature: string;
    readonly taker: string;
    readonly recipient: string;
    readonly recipientTokenAccount: string;
    readonly minimumOutputAtomic: string;
    readonly maximumTotalNativeSpendLamports: string;
    readonly maximumNetworkFeeLamports: string;
}
export interface JupiterFinalizedReceipt {
    readonly signature: string;
    readonly slot: string;
    readonly feeLamports: string;
    readonly nativeSpendLamports: string;
    readonly recipientOutputAtomic: string;
    readonly receiptHash: string;
}
export declare function validateFinalizedJupiterReceipt(reader: SolanaProofReaderPort, envelope: JupiterV0Envelope, expected: JupiterReceiptExpectation): Promise<JupiterFinalizedReceipt>;
