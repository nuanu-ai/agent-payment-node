/** Relay cross-chain observation; a finality-proven source effect is reconciled into local state (never signed or sent). */
import type { Hex } from "viem";
import { AssetUsageLedger } from "../asset-usage-ledger.js";
import type { StateStore } from "../state.js";
import { type RelayDepositObservation } from "./deposit-effect.js";
import { type RelayBnbProofPorts, type RelayBnbProofResult } from "./destination-proof.js";
import { RelayKeylessStatusService } from "./status.js";
import { RelayNativeObserveService } from "./native-observe.js";
export interface RelaySourceFinalityPorts {
    /** A fresh, canonical, finalized Ethereum observation. At most two physical RPC POSTs. */
    finalizedDeposit(hash: Hex): Promise<RelayDepositObservation | null>;
}
export type RelayObserveState = "prepared_waiting" | "approval_pending" | "deposit_pending" | "source_unproven" | "source_finalized" | "provider_candidate_unproven" | "recipient_credit_observed" | "operational_acceptance";
export interface RelayObserveResult {
    readonly operationId: string;
    readonly state: RelayObserveState;
    readonly reason: string;
    readonly sourceFinalized: boolean;
    readonly providerStatus: string | null;
    readonly providerStatusBound: boolean;
    readonly destinationProof: RelayBnbProofResult | null;
    readonly causalLinkCryptographicallyProven: false;
    readonly paidAcceptance: false;
    readonly operationalAcceptance: boolean;
    readonly sourceActualFee?: import("./source-fee-proof.js").RelayBaseReceiptFee;
}
/** No signer, send, or retry surface is reachable here. */
export declare class RelayObserveService {
    private readonly state;
    private readonly source;
    private readonly status;
    private readonly native?;
    private readonly usage;
    private readonly usedBnbInvocations;
    /** The factory must return a fresh budgeted BNB adapter for each observation. */
    private readonly bnbInvocation;
    constructor(state: StateStore, source: RelaySourceFinalityPorts, bnbInvocation: () => RelayBnbProofPorts, status?: RelayKeylessStatusService, native?: RelayNativeObserveService | undefined, usage?: Pick<AssetUsageLedger, "load" | "transition">);
    /** The operation is found only under the caller's explicit profile (OWNR 4.1). */
    observe(profile: string, operationId: string): Promise<RelayObserveResult>;
}
