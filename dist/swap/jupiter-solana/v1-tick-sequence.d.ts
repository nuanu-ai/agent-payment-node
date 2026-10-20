/** Ticks per Whirlpool tick array, fixed and dynamic layouts alike. */
export declare const WHIRLPOOL_TICK_ARRAY_TICKS = 88;
/**
 * The Whirlpool program's own A-to-B swap sequence: it starts at the tick array holding the pool's current tick and walks
 * down through the arrays the message names, stopping at the first one it does not find. Jupiter's build names three
 * consecutive arrays from its view of the pool when it quoted. By the time APN re-reads the pool (quote proof, approval)
 * the price may have moved down into the second or third of them; the program then still swaps through the arrays left,
 * and the exact-message simulation, the encoded minimum output and the finalized receipt bound what that swap delivers.
 * A pool whose current tick lies above the first array or below the last has no array to start from: the quoted message
 * can no longer execute, so it refuses for a new quote. `identity` refuses arrays that are not one aligned descending run.
 */
export declare function assertWhirlpoolTickArraySequence(starts: readonly number[], tickCurrentIndex: number, tickSpacing: number, identity: () => never): void;
