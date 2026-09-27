import { type SolanaRpcPort, SolanaRpc } from "../../solana/rpc.js";
import { type OrcaProgramPinVerifier } from "./pins.js";
import { type OrcaStableAdmissionPorts } from "./stable-admission.js";
import { type OrcaStableSnapshotRequest } from "./stable-snapshot.js";
import { GuardedSwapService } from "../service.js";
export declare const ORCA_STABLE_CANDIDATE_SCHEMA: "apn.orca-stable-guarded-candidate.v1";
export interface OrcaStableCandidateRequest extends OrcaStableSnapshotRequest {
    readonly profile: string;
    readonly policyRevision: number;
    readonly idempotencyKey: string;
}
/** A bounded production entry: all RPC reads, fee pricing and simulation precede the first operation write.
 * GuardedSwapService can retain a recoverable quoted/prepared record if a later transition fails. */
export declare function prepareOrcaStableGuardedCandidate(rpc: SolanaRpc, ports: OrcaStableAdmissionPorts, service: GuardedSwapService, request: OrcaStableCandidateRequest): Promise<{
    schemaVersion: "apn.orca-stable-guarded-candidate.v1";
    quote: import("../quote.js").SwapQuoteSnapshot;
    operation: import("../model.js").SwapOperationRecord;
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
export declare function prepareOrcaStableGuardedCandidateCore(rpc: SolanaRpcPort, ports: OrcaStableAdmissionPorts, service: GuardedSwapService, request: OrcaStableCandidateRequest, verifyPins: OrcaProgramPinVerifier, clock: () => Date): Promise<{
    schemaVersion: "apn.orca-stable-guarded-candidate.v1";
    quote: import("../quote.js").SwapQuoteSnapshot;
    operation: import("../model.js").SwapOperationRecord;
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
    unsignedTransaction: {
        payloadBase64: string;
        messageHash: string;
        blockhash: string;
        lastValidBlockHeight: string;
    };
    signed: false;
    broadcast: false;
}>;
