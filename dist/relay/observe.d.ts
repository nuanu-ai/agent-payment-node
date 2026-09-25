/** Read-only cross-chain evidence for one saved Ethereum USDC to BNB Relay operation. */
import type { Hex } from "viem";
import type { StateStore } from "../state.js";
import { type RelayDepositObservation } from "./deposit-effect.js";
import { type RelayBnbProofPorts, type RelayBnbProofResult } from "./destination-proof.js";
import { RelayKeylessStatusService } from "./status.js";
export interface RelaySourceFinalityPorts {
    /** A fresh, canonical, finalized Ethereum observation. At most three physical RPC POSTs. */
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
}
/** No signer, wallet, send, journal mutation, or retry surface is reachable here. */
export declare class RelayObserveService {
    private readonly state;
    private readonly source;
    private readonly status;
    private readonly usedBnbInvocations;
    /** The factory must return a fresh budgeted BNB adapter for each observation. */
    private readonly bnbInvocation;
    constructor(state: StateStore, source: RelaySourceFinalityPorts, bnbInvocation: () => RelayBnbProofPorts, status?: RelayKeylessStatusService);
    observe(operationId: string): Promise<RelayObserveResult>;
}
