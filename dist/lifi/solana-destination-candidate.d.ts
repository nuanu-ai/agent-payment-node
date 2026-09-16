import { SOLANA_USDC } from "../chain-policy.js";
/** A destination observation is never a bridge receipt. Source CCTP message correlation is not implemented. */
export interface SolanaDestinationCandidate {
    readonly proofClass: "solana_finalized_usdc_destination_candidate";
    readonly signature: string;
    readonly slotAtomic: string;
    readonly recipient: string;
    readonly tokenAccount: string;
    readonly mint: typeof SOLANA_USDC;
    readonly receivedAtomic: string;
    readonly minimumOutputAtomic: string;
    readonly sourceMessageCorrelation: "unverified";
    readonly bridgeCompletion: false;
}
export interface SolanaDestinationCandidateInput {
    readonly signature: string;
    readonly recipient: string;
    readonly minimumOutputAtomic: string;
    /** LI.FI terminal exceptions are never canonical USDC delivery evidence. */
    readonly providerOutcome: "pending" | "completed" | "partial" | "refunded" | "failed" | "unknown";
    readonly signatureStatuses: unknown;
    readonly transaction: unknown;
}
/** Parse untrusted finalized RPC responses without admitting or completing a bridge operation. */
export declare function parseSolanaDestinationCandidate(input: SolanaDestinationCandidateInput): Promise<SolanaDestinationCandidate>;
