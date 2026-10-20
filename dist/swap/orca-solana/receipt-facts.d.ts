import type { SwapOperationRecord, SwapReceiptEconomics } from "../model.js";
import type { OrcaKeylessMaterial } from "./material.js";
/** The accounts a plan's economics are read from: the owner's source (or for SOL the pool's wSOL vault) and destination. */
export interface OrcaFactsAccounts {
    readonly owner: string;
    readonly native: boolean;
    readonly input: string;
    readonly destination: string;
    readonly mintA: string;
    readonly decimalsA: number;
    readonly mintB: string;
    readonly decimalsB: number;
}
export declare function orcaFactsAccounts(record: SwapOperationRecord, material: OrcaKeylessMaterial): OrcaFactsAccounts;
/**
 * The economics of an Orca swap its record proved finalized, from that transaction's own finalized record (read once):
 * the fee and the payer's SOL delta, the owner's output-token delta, the input (the owner's source-token delta, or for SOL
 * what the pool's wSOL vault received) and the rent a new destination account holds. The transaction must carry the
 * record's own signature, be paid by the record's account and have the outcome the record holds.
 */
export declare function orcaEconomicsFromTransaction(record: SwapOperationRecord, accounts: OrcaFactsAccounts, responseValue: unknown): SwapReceiptEconomics;
