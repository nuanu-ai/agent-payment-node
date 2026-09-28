import { type SolanaRpcPort, SolanaRpc } from "../../solana/rpc.js";
import { type OrcaProgramPinVerifier } from "./pins.js";
import { type OrcaStableAdmissionPorts } from "./stable-admission.js";
import { type OrcaStableSnapshotRequest } from "./stable-snapshot.js";
import { GuardedSwapService } from "../service.js";
import { SavedOrcaStableMaterialStore } from "./stable-material.js";
export declare const ORCA_STABLE_CANDIDATE_SCHEMA: "apn.orca-stable-guarded-candidate.v1";
export interface OrcaStableCandidateRequest extends OrcaStableSnapshotRequest {
    readonly profile: string;
    readonly policyRevision: number;
    readonly idempotencyKey: string;
}
export type OrcaStableSimulationRequest = Omit<OrcaStableCandidateRequest, "idempotencyKey">;
export declare const ORCA_STABLE_SIMULATION_SCHEMA: "apn.orca-stable-guarded-simulation.v1";
/** Current-owner proof only. It reads active policy, accounts and RPC; it never creates an operation or exposes transaction bytes. */
export declare function simulateOrcaStableGuardedReadOnly(rpc: SolanaRpc, ports: OrcaStableAdmissionPorts, request: OrcaStableSimulationRequest): Promise<{
    schemaVersion: "apn.orca-stable-guarded-simulation.v1";
    mode: "read_only";
    quote: import("../quote.js").SwapQuoteSnapshot;
    evidence: {
        schemaVersion: "apn.orca-stable-guarded-candidate.v1";
        marketSlot: string;
        beforeSlot: string;
        simulation: {
            postAccountDataSha256: {
                owner: string;
                source: string;
                destination: string;
            };
            ownerLamportsAfter: string;
            sourceAtomicAfter: string;
            destinationAtomicAfter: string;
            sourceDebitedAtomic: string;
            destinationCreditedAtomic: string;
            swapOuterInstructionIndex: number;
            tokenTransferCount: 2;
            slot: string;
            unitsConsumed: string;
        };
        sourceAta: string;
        destinationAta: string;
        pool: string;
        program: string;
        blockhash: string;
        lastValidBlockHeight: string;
        messageHash: string;
        unsignedPayloadHash: string;
        actualFeeLamports: string;
        rentLamports: string;
        policyDigest: string;
        policyRevision: number;
        activationDigest: string;
        mechanismDigest: string;
        ownerUsage: {
            source: string;
            destination: string;
        };
    };
    signable: false;
    executable: false;
    signed: false;
    broadcast: false;
}>;
/** A bounded production entry: all RPC reads, fee pricing and simulation precede persistence.
 * Validated material is durable before the first operation write, so interrupted transitions can resume. */
export declare function prepareOrcaStableGuardedCandidate(rpc: SolanaRpc, ports: OrcaStableAdmissionPorts, service: GuardedSwapService, request: OrcaStableCandidateRequest): Promise<{
    schemaVersion: "apn.orca-stable-guarded-candidate.v1";
    quote: import("../quote.js").SwapQuoteSnapshot;
    operation: import("../model.js").SwapOperationRecord;
    evidence: Awaited<ReturnType<typeof proveOrcaStableGuardedCore>>["evidence"];
    unsignedTransaction: {
        payloadBase64: string;
        messageHash: string;
        blockhash: string;
        lastValidBlockHeight: string;
    };
    signed: false;
    broadcast: false;
}>;
/** Injectable pin verifier permits deterministic fake-RPC tests; production always uses the pinned verifier. */
export declare function prepareOrcaStableGuardedCandidateCore(rpc: SolanaRpcPort, ports: OrcaStableAdmissionPorts, service: GuardedSwapService, request: OrcaStableCandidateRequest, verifyPins: OrcaProgramPinVerifier, clock: () => Date, materialStore?: SavedOrcaStableMaterialStore): Promise<{
    schemaVersion: "apn.orca-stable-guarded-candidate.v1";
    quote: import("../quote.js").SwapQuoteSnapshot;
    operation: import("../model.js").SwapOperationRecord;
    evidence: Awaited<ReturnType<typeof proveOrcaStableGuardedCore>>["evidence"];
    unsignedTransaction: {
        payloadBase64: string;
        messageHash: string;
        blockhash: string;
        lastValidBlockHeight: string;
    };
    signed: false;
    broadcast: false;
}>;
/** Injectable read-only proof for fake transport tests. No service or repository is reachable from this path. */
export declare function simulateOrcaStableGuardedCore(rpc: SolanaRpcPort, ports: OrcaStableAdmissionPorts, request: OrcaStableSimulationRequest, verifyPins: OrcaProgramPinVerifier, clock: () => Date): Promise<{
    schemaVersion: "apn.orca-stable-guarded-simulation.v1";
    mode: "read_only";
    quote: import("../quote.js").SwapQuoteSnapshot;
    evidence: {
        schemaVersion: "apn.orca-stable-guarded-candidate.v1";
        marketSlot: string;
        beforeSlot: string;
        simulation: {
            postAccountDataSha256: {
                owner: string;
                source: string;
                destination: string;
            };
            ownerLamportsAfter: string;
            sourceAtomicAfter: string;
            destinationAtomicAfter: string;
            sourceDebitedAtomic: string;
            destinationCreditedAtomic: string;
            swapOuterInstructionIndex: number;
            tokenTransferCount: 2;
            slot: string;
            unitsConsumed: string;
        };
        sourceAta: string;
        destinationAta: string;
        pool: string;
        program: string;
        blockhash: string;
        lastValidBlockHeight: string;
        messageHash: string;
        unsignedPayloadHash: string;
        actualFeeLamports: string;
        rentLamports: string;
        policyDigest: string;
        policyRevision: number;
        activationDigest: string;
        mechanismDigest: string;
        ownerUsage: {
            source: string;
            destination: string;
        };
    };
    signable: false;
    executable: false;
    signed: false;
    broadcast: false;
}>;
/** Internal exact-byte proof reused by the saved-operation preflight. It never persists or signs. */
export declare function proveOrcaStableGuardedCore(rpc: SolanaRpcPort, ports: OrcaStableAdmissionPorts, request: OrcaStableSimulationRequest, verifyPins: OrcaProgramPinVerifier, clock: () => Date): Promise<{
    quoteInput: {
        profile: string;
        account: string;
        recipient: string;
        sourceAsset: {
            chain: "solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d";
            kind: "token";
            identifier: string;
        };
        destinationAsset: {
            chain: "solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d";
            kind: "token";
            identifier: string;
        };
        inputAmountAtomic: string;
        expectedOutputAtomic: string;
        minimumOutputAtomic: string;
        slippageBps: number;
        effectiveAt: string;
        expiresAt: string;
        providerResponseHash: string;
        routeHash: string;
        unsignedTransactionPayloadHash: string;
        simulation: {
            requestHash: string;
            resultHash: string;
            success: true;
            blockNumber: string;
            blockHash: string;
            headBlockNumber: string;
            maxHeadDrift: number;
            gasEstimate: string;
        };
    };
    active: import("../../allowlist-active-policy.js").ActiveAssetPolicy;
    commitNow: Date;
    boundQuote: import("../quote.js").SwapQuoteSnapshot;
    evidence: {
        schemaVersion: "apn.orca-stable-guarded-candidate.v1";
        marketSlot: string;
        beforeSlot: string;
        simulation: {
            postAccountDataSha256: {
                owner: string;
                source: string;
                destination: string;
            };
            ownerLamportsAfter: string;
            sourceAtomicAfter: string;
            destinationAtomicAfter: string;
            sourceDebitedAtomic: string;
            destinationCreditedAtomic: string;
            swapOuterInstructionIndex: number;
            tokenTransferCount: 2;
            slot: string;
            unitsConsumed: string;
        };
        sourceAta: string;
        destinationAta: string;
        pool: string;
        program: string;
        blockhash: string;
        lastValidBlockHeight: string;
        messageHash: string;
        unsignedPayloadHash: string;
        actualFeeLamports: string;
        rentLamports: string;
        policyDigest: string;
        policyRevision: number;
        activationDigest: string;
        mechanismDigest: string;
        ownerUsage: {
            source: string;
            destination: string;
        };
    };
    preview: import("./stable-prepare.js").OrcaStableUnsignedPreview;
    unsignedTransaction: {
        payloadBase64: string;
        messageHash: string;
        blockhash: string;
        lastValidBlockHeight: string;
    };
}>;
