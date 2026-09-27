import type { OrcaStableUnsignedPreview } from "./stable-prepare.js";
/** Source/destination effect proof comes solely from the successful simulation's CPI trace. */
export interface OrcaStableTraceProof {
    readonly sourceDebitedAtomic: string;
    readonly destinationCreditedAtomic: string;
    readonly swapOuterInstructionIndex: number;
    readonly tokenTransferCount: 2;
}
/**
 * Prove the same-result classic Tokenkeg Transfer CPIs. Orca's pinned legacy swap uses
 * anchor_spl::token::transfer (Orca a119d79b, util/token.rs); it has no mint CPI accounts.
 * A missing or unfamiliar trace fails closed.
 * The standalone transaction message has no address lookup tables, so partially decoded CPI account indices
 * resolve against its exact static account table. Parsed CPIs must bind the same exact accounts and values.
 * A missing destination permits only the
 * classic Tokenkeg ATA creation sequence from the pinned associated-token program.
 */
export declare function proveOrcaStableSimulationTransfers(innerValue: unknown, preview: OrcaStableUnsignedPreview, owner: string, amountInAtomic: string, minimumOutputAtomic: string): OrcaStableTraceProof;
