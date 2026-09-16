import { TRON_USDT } from "../tron/codec.js";
/** A solidified token receipt alone cannot establish which bridge source delivered it. */
export interface TronDestinationCandidate {
    readonly proofClass: "tron_solidified_usdt_destination_candidate";
    readonly transactionId: string;
    readonly recipient: string;
    readonly token: typeof TRON_USDT;
    readonly receivedAtomic: string;
    readonly minimumOutputAtomic: string;
    readonly sourceMessageCorrelation: "unverified";
    readonly bridgeCompletion: false;
}
export interface TronDestinationCandidateInput {
    readonly transactionId: string;
    readonly recipient: string;
    readonly minimumOutputAtomic: string;
    readonly providerOutcome: "pending" | "completed" | "partial" | "refunded" | "failed" | "unknown";
    /** Responses obtained from the two walletsolidity transaction endpoints. No RPC is performed here. */
    readonly transaction: unknown;
    readonly transactionInfo: unknown;
}
/** Parse a frozen pair of solidified TRON responses; this never completes a bridge operation. */
export declare function parseTronDestinationCandidate(input: TronDestinationCandidateInput): TronDestinationCandidate;
