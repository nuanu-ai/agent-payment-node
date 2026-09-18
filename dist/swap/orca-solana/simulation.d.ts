import { type SolanaRpcPort } from "../../solana/rpc.js";
/** The owner's balances that the swap may move, read at quote time or re-read before signing. */
export interface OrcaOwnerBalances {
    readonly ownerLamports: string;
    readonly usdcAtomic: string;
    readonly usdcAccountExists: boolean;
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
export interface OrcaSimulationBounds {
    readonly owner: string;
    readonly wsolAccount: string;
    readonly usdcAccount: string;
    readonly before: OrcaOwnerBalances;
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
export declare function orcaOwnerBalances(ownerValue: unknown, usdcValue: unknown, owner: string): OrcaOwnerBalances;
