import type { StateStore } from "../state.js";
export declare const CIRCLE_V2_BASE_SOLANA_MECHANISM: Readonly<{
    provider: "circle-cctp-v2";
    reference: "circle-v2-base-solana-withfees.v1";
}>;
/** The burned principal is held against the payer's Base USDC bridge cap from before signing until settled. */
export declare class CircleV2SourceAdmission {
    private readonly state;
    private readonly profile;
    private readonly amountAtomic;
    private readonly operationId;
    private readonly now;
    private readonly ledger;
    private readonly identity;
    private readonly reservationId;
    private policyDigest;
    constructor(state: StateStore, profile: string, payer: string, amountAtomic: string, operationId: string, now: () => Date);
    private key;
    private active;
    /** Read-only admission before the owner is asked: policy account, Base USDC bridge rail, CCTP mechanism and caps. */
    admit(): Promise<void>;
    /** After consent and before signing: the ledger re-evaluates the active policy and caps atomically. */
    reserve(): Promise<void>;
    /** Nothing was signed: the hold is released without counting. */
    releaseBeforeEffect(): Promise<void>;
    /** The one send was accepted or is ambiguous: the principal stays counted as spent. */
    followSend(state: "submitted" | "unknown_finality"): Promise<void>;
    private transition;
}
