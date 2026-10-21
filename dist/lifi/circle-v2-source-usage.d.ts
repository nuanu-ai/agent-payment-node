import type { CircleSourceProof } from "./circle-v2-source-proof.js";
import type { NonEvmSourceJournal } from "./non-evm-source-journal.js";
export interface CircleSourceUsage {
    readonly reservationId: string;
    readonly state: string;
    readonly amountAtomic: string;
    readonly effectAt: string | null;
}
/**
 * A burn whose receipt is recorded at the finalized tag settles the payer's hold once: a successful burn is a finalized
 * spend counted on the day its proof was recorded, a reverted one moved no USDC and releases the hold. Only the hold this
 * operation reserved, for the principal its own burn call carries, is touched; anything else is left as it is.
 */
export declare function settleCircleSourceUsage(root: string, journal: NonEvmSourceJournal, proof: CircleSourceProof, now: Date): Promise<CircleSourceUsage | null>;
