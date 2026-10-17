/** Saved-operation Arbitrum source observation and, once the deposit is final and an Ethereum reader is configured, the
 * Ethereum USDC credit to the operation's own recipient. No wallet, signer or send. */
import { type Hex } from "viem";
import { type RelayUnsignedOperation } from "../relay-unsigned-operation.js";
import type { StateStore } from "../state.js";
import { type ArbitrumEffectEvent, type ArbitrumEffectRole, type ArbitrumSourceEffectJournal } from "./arbitrum-source-effect-journal.js";
import { RelayArbitrumSourceFinalityObserver } from "./arbitrum-source-finality.js";
import type { RelayArbitrumDestinationObserver } from "./arbitrum-destination.js";
export interface RelayArbitrumSourceObservePorts {
    readonly operation?: (profileHash: string, operationId: string) => Promise<RelayUnsignedOperation | null>;
    readonly journal?: (profileHash: string, operationId: string) => Promise<ArbitrumSourceEffectJournal | null>;
    readonly transition?: (profileHash: string, operationId: string, expectedHash: string, role: ArbitrumEffectRole, proofDigest: string, verify: (input: {
        operation: RelayUnsignedOperation;
        journal: ArbitrumSourceEffectJournal;
        role: ArbitrumEffectRole;
        outcome: "confirmed" | "failed" | "never_landed";
        proofDigest: string;
    }) => Promise<boolean>, outcome: "confirmed" | "failed" | "never_landed") => Promise<ArbitrumSourceEffectJournal>;
    /** Synthetic seam; production finalizes the shared usage reservation from the saved safe source proof. */
    readonly finalizeUsage?: (operation: RelayUnsignedOperation, proofDigest: string) => Promise<void>;
    /** Synthetic seam for unverified fences (mark_submitting, record_send); production uses the CAS journal repository. */
    readonly advance?: (profileHash: string, operationId: string, expectedHash: string, event: ArbitrumEffectEvent) => Promise<ArbitrumSourceEffectJournal>;
    /** Synthetic seam; production releases the shared usage reservation after a safe source revert proof. */
    readonly releaseRevertedUsage?: (operation: RelayUnsignedOperation, proofDigest: string) => Promise<void>;
}
export declare class RelayArbitrumSourceObserveService {
    private readonly state;
    private readonly observer;
    private readonly ports;
    /** Present when the caller supplied an Ethereum RPC: the final deposit then continues to the destination credit. */
    private readonly destination?;
    constructor(state: StateStore, observer: Pick<RelayArbitrumSourceFinalityObserver, "observe" | "observeRevert" | "observeUnsent">, ports?: RelayArbitrumSourceObservePorts, 
    /** Present when the caller supplied an Ethereum RPC: the final deposit then continues to the destination credit. */
    destination?: Pick<RelayArbitrumDestinationObserver, "observe"> | undefined);
    /** A final deposit is proven; with an Ethereum reader the same invocation proves (or reads the recorded) credit. */
    private withDestination;
    private finalizeUsage;
    /** Bytes already known on chain count as an uncertain send: the principal hold stays counted. */
    private holdUncertainSend;
    /** A reverted or never-landed approval or deposit moved no principal: the hold is released, never counted as spent. */
    private releaseRevertedUsage;
    /** The operation is found only under the caller's explicit profile (OWNR 4.1). */
    observe(profile: string, operationId: string): Promise<{
        operationId: string;
        state: "source_effect_reverted" | "source_effect_never_landed" | "approval_skipped" | "observation_only" | "source_effect_not_recorded" | "deposit_source_confirmed" | "source_proof_pending" | "approval_source_confirmed";
        reason: string;
        approvalPhase: import("./arbitrum-source-effect-journal.js").ArbitrumEffectPhase | null;
        depositPhase: import("./arbitrum-source-effect-journal.js").ArbitrumEffectPhase | null;
        sourceProof: {
            approval: Readonly<{
                transactionHash: Hex;
                blockNumber: string;
                blockHash: Hex;
            }> | null;
            deposit: Readonly<{
                transactionHash: Hex;
                blockNumber: string;
                blockHash: Hex;
            }> | null;
            sourceChainId: 42161;
            rpcOrigin: string;
            safeHead: Readonly<{
                number: string;
                hash: Hex;
            }>;
            proofClass: "canonical_safe_source_receipts";
            destinationDeliveryProven: false;
            causalLinkCryptographicallyProven: false;
            paidAcceptance: false;
        } | null;
        sourceFinalized: boolean;
        destinationDeliveryProven: false;
        causalLinkCryptographicallyProven: false;
        paidAcceptance: false;
        executionAdmitted: false;
        nextActions: readonly [];
    }>;
    private recordRevert;
    private recordNeverLanded;
}
