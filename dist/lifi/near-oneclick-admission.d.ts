import { type AssetUsageIdentity, type AssetUsageState } from "../asset-usage-ledger.js";
import type { StateStore } from "../state.js";
import { type OneClickSourceRecord } from "./near-oneclick-source-journal.js";
import type { OneClickLane } from "./near-oneclick-lanes.js";
/** One exact bridge mechanism per lane: an owner admits each lane on its own, with its own cap and recipient pin. */
export declare function oneClickMechanism(lane: Pick<OneClickLane, "id">): Readonly<{
    provider: "near-1click";
    reference: string;
}>;
/** The payer's origin asset: Base USDC on the Base lane, Ethereum ETH on the Ethereum lanes. */
export declare function oneClickUsageIdentity(lane: OneClickLane, payer: string): AssetUsageIdentity;
/** The deposit principal is held against the payer's origin-asset bridge caps from before signing until its outcome. */
export declare class OneClickSourceAdmission {
    private readonly state;
    private readonly profile;
    private readonly amountAtomic;
    private readonly operationId;
    private readonly recipient;
    private readonly now;
    private readonly ledger;
    private readonly identity;
    private readonly mechanism;
    private policyDigest;
    /** `recipient` is the TRON or Solana destination recipient; an owner recipient pin must list it (OD-1). */
    constructor(state: StateStore, profile: string, lane: OneClickLane, payer: string, amountAtomic: string, operationId: string, recipient: string, now: () => Date);
    private active;
    /** Read-only, before the quote: policy account, the origin asset's bridge rail, this lane's mechanism, caps and pin. */
    admit(): Promise<void>;
    private evaluate;
    /** After consent and before signing: the active policy and its pin again; the ledger checks the caps atomically. */
    reserve(): Promise<void>;
    /** The seal's guard, run under the record lock: the hold this run took is still held, so status has not released it. */
    assertHeld(): Promise<void>;
    /** Nothing was sealed, so the signature never left this process: the hold is released without counting. */
    releaseBeforeEffect(): Promise<void>;
}
export interface OneClickUsage {
    readonly reservationId: string;
    readonly state: AssetUsageState;
    readonly amountAtomic: string;
}
/**
 * Brings this operation's hold to the state its journal proves, idempotently. Records written before 1Click held usage
 * have no hold and are left alone; a hold whose principal is not this deposit's is never touched.
 */
export declare function settleOneClickUsage(root: string, record: OneClickSourceRecord, now: Date): Promise<OneClickUsage | null>;
/** An unsigned record past its effective deadline can never be sealed (the journal refuses it): its hold is released. */
export declare function releaseUnsignedOneClickUsage(root: string, record: OneClickSourceRecord, now: Date): Promise<void>;
