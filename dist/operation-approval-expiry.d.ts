import type { CommandOutcome } from "./commands.js";
/**
 * A record still awaiting the owner's approval, as its family's adapter describes it: the instant from which its approve
 * refuses, and what ends the record once that instant has passed.
 */
export interface ApprovalExpiry {
    /** Epoch milliseconds from which the family's approve refuses this record. */
    readonly deadlineMs: number;
    /** True when that approve now closes the record as failed_before_effect without asking anything: it stays named. */
    readonly approveCloses: boolean;
    /**
     * True when the status's operation slot must reach the caller exactly as the family built it, because it can be verified:
     * a swap's sealed record, or a local x402 purchase's self-hashed public view. The presentation then goes in the data slot.
     */
    readonly sealedSlot: boolean;
    /** What ends the record, in plain words. */
    readonly note: string;
}
/** Direct (Base USDC, provider), Solana, TRON and local x402: approve checks the deadline before any prompt and closes. */
export declare const EXPIRED_APPROVE_CLOSES: string;
/**
 * Local EVM direct: approve closes it as it closes Base USDC, and so does the next transfer the profile prepares on the
 * chain (TransferService.retireExpiredDirectTransfers); both first pass DirectPublicEffectJournal.assertUnstarted.
 */
export declare const EXPIRED_APPROVE_OR_NEXT_TRANSFER_CLOSES: string;
/** The retired cleanup85 cancellation, read-only to approve: only the next transfer the profile prepares on the chain retires it. */
export declare const EXPIRED_NEXT_TRANSFER_CLOSES: string;
/**
 * A local direct transfer without its public effect evidence (prepared before APN recorded it, or its wallet file is gone):
 * approve and the expiry retirement both stop at DirectPublicEffectJournal.assertUnstarted with direct_public_evidence_missing.
 */
export declare const EXPIRED_EVIDENCE_MISSING: string;
/**
 * A local direct transfer whose evidence approve refuses for any other reason (DirectPublicEffectJournal.assertUnstarted: a
 * prepared binding, frozen custody or wallet that no longer matches the saved operation, signing evidence already present),
 * or a generic EVM record without its frozen native custody: approve refuses before its deadline check, and so does the
 * expiry retirement.
 */
export declare const EXPIRED_EVIDENCE_UNVERIFIED: string;
/**
 * Gasless and swap: the index stops counting an unstarted record once the unstarted margin has passed its recorded expiry
 * (a gasless approve stops being able to finish a little before that expiry, so the release is counted from the expiry).
 */
export declare const EXPIRED_RELEASED_AFTER_MARGIN: string;
/**
 * `apn operation status` of a record still stored as `awaiting_approval` once its approval deadline has passed: it can
 * never be approved, so the status presents `state: expired`, `stored_state: awaiting_approval`, the reason the direct
 * approve records (`approval_window_expired`) and `expiry_note` saying what ends it. These fields go on the operation view,
 * or, for a sealed slot, in the data slot beside the untouched operation. Approve stays named only where running it now
 * closes the record without asking anything. `proof_class` is left as the family set it: what the stored record proves
 * (for a swap, its stored state). Status stays a pure read: the stored record keeps `awaiting_approval` until its family
 * ends it, and a receipt, derived from the stored record and hashed, never carries this presentation. Any other outcome,
 * and a sealed one whose data slot is neither empty nor a record, is returned as is.
 */
export declare function presentExpiredApproval(outcome: CommandOutcome, expiry: ApprovalExpiry | null, now: Date): CommandOutcome;
