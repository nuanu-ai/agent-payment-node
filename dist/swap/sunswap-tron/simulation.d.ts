import type { TronRpcPort } from "../../tron/rpc.js";
import type { SwapSimulationProof } from "../quote.js";
import { type SunSwapUnsignedIntent, type SunSwapUnsignedTransaction } from "./transaction.js";
export interface SunSwapSimulationProof extends SwapSimulationProof {
    readonly energyRequired: string;
    readonly feeLimitSun: string;
}
/**
 * Simulates the exact unsigned call from the owner with call_value = input. The proof is bound to the recorded
 * reference block of the unsigned transaction; the head read after the call must stay within the frozen drift bound.
 */
export declare function simulateSunSwapTransaction(rpc: TronRpcPort, transaction: SunSwapUnsignedTransaction, intent: SunSwapUnsignedIntent): Promise<SunSwapSimulationProof>;
