import { type TronRpcPort } from "../../tron/rpc.js";
import type { SwapSimulationProof } from "../quote.js";
import { type SunSwapUnsignedIntent, type SunSwapUnsignedTransaction } from "./transaction.js";
export interface SunSwapSimulationProof extends SwapSimulationProof {
    readonly energyRequired: string;
    readonly feeLimitSun: string;
}
export declare function simulateSunSwapTransaction(rpc: TronRpcPort, transaction: SunSwapUnsignedTransaction, intent: SunSwapUnsignedIntent): Promise<SunSwapSimulationProof>;
