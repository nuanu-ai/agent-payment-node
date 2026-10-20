/** One seller `exact` offer on Solana mainnet, parsed without trusting anything but its own fields. */
export interface X402SolanaOffer {
    readonly index: number;
    readonly mint: string;
    readonly amountAtomic: string;
    readonly payee: string;
    readonly feePayer: string;
    readonly maxTimeoutSeconds: number;
    /** The seller's declared requirements, sent back verbatim as `accepted`. */
    readonly declaredCanonicalJson: string;
    readonly offerHash: string;
    /** The seller's `extra.memo` (1 to 256 UTF-8 bytes), put verbatim into the Memo instruction; null when undeclared. */
    readonly memo: string | null;
}
/** Every structurally valid Solana `exact` offer in seller order; anything else is skipped, never repaired. */
export declare function solanaExactOffers(accepts: readonly unknown[]): readonly X402SolanaOffer[];
/**
 * A native SOL offer (the wrapped SOL mint with `extra.native`, a system-program lamport transfer the seller's own note
 * asks for, and no facilitator fee payer) is outside the x402 SVM `exact` scheme, which pays only through an SPL or
 * Token-2022 TransferChecked sponsored by a facilitator.
 */
export declare function refuseNativeSol(accepts: readonly unknown[], mint: string): void;
export interface SolanaOfferSelectionInput {
    readonly accepts: readonly unknown[];
    readonly mint: string;
    readonly payer: string;
    /** The smaller of the caller's `--max-amount` and the owner's per-payment cap. */
    readonly capAtomic: bigint;
    readonly payeeAdmitted: (payee: string) => boolean;
}
/**
 * The deterministic rule: the lowest-index Solana `exact` offer for the admitted mint whose price is within the cap, whose
 * payee the owner's pin admits, and whose fee
 * payer is a third party (never the payer, the payee or the mint).
 */
export declare function selectSolanaOffer(input: SolanaOfferSelectionInput): X402SolanaOffer;
