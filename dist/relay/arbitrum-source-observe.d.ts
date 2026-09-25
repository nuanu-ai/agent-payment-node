/** Saved-operation Arbitrum source observation. No wallet, signer, send, or destination assertion. */
import type { Hex } from "viem";
import { type RelayUnsignedOperation } from "../relay-unsigned-operation.js";
import type { StateStore } from "../state.js";
import { type ArbitrumEffectRole, type ArbitrumSourceEffectJournal } from "./arbitrum-source-effect-journal.js";
import { RelayArbitrumSourceFinalityObserver } from "./arbitrum-source-finality.js";
export interface RelayArbitrumSourceObservePorts {
    readonly operation?: (operationId: string) => Promise<RelayUnsignedOperation | null>;
    readonly journal?: (profileHash: string, operationId: string) => Promise<ArbitrumSourceEffectJournal | null>;
    readonly transition?: (profileHash: string, operationId: string, expectedHash: string, role: ArbitrumEffectRole, proofDigest: string, verify: (input: {
        operation: RelayUnsignedOperation;
        journal: ArbitrumSourceEffectJournal;
        role: ArbitrumEffectRole;
        outcome: "confirmed" | "failed";
        proofDigest: string;
    }) => Promise<boolean>) => Promise<ArbitrumSourceEffectJournal>;
}
export declare class RelayArbitrumSourceObserveService {
    private readonly state;
    private readonly observer;
    private readonly ports;
    constructor(state: StateStore, observer: Pick<RelayArbitrumSourceFinalityObserver, "observe">, ports?: RelayArbitrumSourceObservePorts);
    observe(operationId: string): Promise<{
        operationId: string;
        state: "observation_only" | "source_effect_not_recorded" | "source_proof_pending" | "approval_source_confirmed" | "deposit_source_confirmed";
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
}
