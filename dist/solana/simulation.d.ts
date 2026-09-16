import type { RailSimulationEvidence } from "../direct-rail-ports.js";
import { type SolanaRpcPort } from "./rpc.js";
/**
 * Every way the pre-send simulation can end other than success. The transport loss is separated
 * from every chain answer, so a lost read is retried rather than reported as a refusal.
 */
export type SolanaSimulationReason = "solana_simulation_unavailable" | "solana_simulation_protocol" | "solana_simulation_blockhash_not_found" | "solana_simulation_already_processed" | "solana_simulation_insufficient_funds" | "solana_simulation_instruction_error" | "solana_simulation_rejected";
/**
 * Runs the exact unsigned bytes through the validator before anything is signed. `sigVerify: false`
 * makes the zero-filled signature slots irrelevant and simulation produces no on-chain effect, so
 * this is a read: a transaction that would fail on chain is refused while no signature exists.
 */
export declare function simulateSolanaSend(rpc: SolanaRpcPort, unsignedPayload: string): Promise<RailSimulationEvidence>;
