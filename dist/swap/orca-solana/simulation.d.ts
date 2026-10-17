import { type SolanaRpcPort } from "../../solana/rpc.js";
import { type RawSolanaAccount } from "./accounts.js";
import type { OrcaPoolConfig } from "./pools.js";
/** The owner's balances that a sol-usdc swap may move, read at quote time or re-read before signing. */
export interface OrcaOwnerBalances {
    readonly ownerLamports: string;
    readonly usdcAtomic: string;
    readonly usdcAccountExists: boolean;
}
/** The owner's balances that a token-input swap may move: SOL for the fee and rent, the source and destination tokens. */
export interface OrcaTokenOwnerBalances {
    readonly ownerLamports: string;
    readonly sourceAtomic: string;
    readonly destinationAtomic: string;
    readonly destinationAccountExists: boolean;
}
export interface OrcaSimulationEvidence {
    readonly requestHash: string;
    readonly resultHash: string;
    readonly slot: string;
    readonly unitsConsumed: string;
    readonly replaceRecentBlockhash: boolean;
    readonly ownerLamportsAfter: string;
    readonly usdcAtomicAfter: string;
    readonly usdcReceivedAtomic: string;
    readonly solSpentLamports: string;
}
export interface OrcaTokenSimulationEvidence {
    readonly requestHash: string;
    readonly resultHash: string;
    readonly slot: string;
    readonly unitsConsumed: string;
    readonly replaceRecentBlockhash: boolean;
    readonly ownerLamportsAfter: string;
    readonly sourceAtomicAfter: string;
    readonly destinationAtomicAfter: string;
    readonly outputReceivedAtomic: string;
    readonly solSpentLamports: string;
}
export interface OrcaSimulationBounds {
    readonly owner: string;
    readonly wsolAccount: string;
    readonly usdcAccount: string;
    readonly before: OrcaOwnerBalances;
    readonly minimumOutputAtomic: string;
    readonly maximumSolSpendLamports: string;
    readonly computeUnitLimit: number;
    /** An existing wSOL account the swap keeps: it must end with exactly its balance before the swap. */
    readonly wsolKept: {
        readonly amountAtomic: string;
        readonly lamports: string;
    } | null;
}
export interface OrcaTokenSimulationBounds {
    readonly pool: OrcaPoolConfig;
    readonly owner: string;
    readonly sourceAccount: string;
    readonly destinationAccount: string;
    readonly before: OrcaTokenOwnerBalances;
    readonly amountInAtomic: string;
    readonly minimumOutputAtomic: string;
    readonly maximumSolSpendLamports: string;
    readonly computeUnitLimit: number;
}
export type OrcaSimulationReason = "orca_simulation_unavailable" | "orca_simulation_protocol" | "orca_simulation_blockhash_not_found" | "orca_simulation_insufficient_funds" | "orca_simulation_instruction_error" | "orca_simulation_rejected" | "orca_simulation_output_shortfall" | "orca_simulation_spend_exceeded";
/**
 * Runs the exact unsigned bytes with `sigVerify: false` and reads back the owner's lamports, the wSOL account and the
 * USDC account. The Whirlpool program itself enforces `other_amount_threshold`; APN additionally requires the USDC
 * delta to reach the minimum, the wSOL account to be closed, and the SOL spend to stay inside input + fee + rent.
 */
export declare function simulateOrcaSwap(rpc: SolanaRpcPort, unsignedPayload: string, bounds: OrcaSimulationBounds, replaceRecentBlockhash: boolean, minContextSlot: string): Promise<OrcaSimulationEvidence>;
/**
 * Token-input pools: the same exact-bytes simulation. The source account must lose exactly the input, the destination
 * account must gain at least the minimum, and the SOL spend must stay inside the network fee plus any new account rent.
 */
export declare function simulateOrcaTokenSwap(rpc: SolanaRpcPort, unsignedPayload: string, bounds: OrcaTokenSimulationBounds, replaceRecentBlockhash: boolean, minContextSlot: string): Promise<OrcaTokenSimulationEvidence>;
export declare function orcaOwnerBalances(ownerValue: unknown, usdcValue: unknown, owner: string): OrcaOwnerBalances;
/** The source account must exist; the destination may be absent (the swap creates it idempotently). */
export declare function orcaTokenOwnerBalances(pool: OrcaPoolConfig, ownerValue: RawSolanaAccount | null, sourceValue: RawSolanaAccount | null, destinationValue: RawSolanaAccount | null, owner: string): OrcaTokenOwnerBalances;
