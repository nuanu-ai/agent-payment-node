import { ApnError } from "../../errors.js";

/** Ticks per Whirlpool tick array, fixed and dynamic layouts alike. */
export const WHIRLPOOL_TICK_ARRAY_TICKS = 88;

/**
 * The Whirlpool program's own A-to-B swap sequence: it starts at the tick array holding the pool's current tick and walks
 * down through the arrays the message names, stopping at the first one it does not find. Jupiter's build names three
 * consecutive arrays from its view of the pool when it quoted. By the time APN re-reads the pool (quote proof, approval)
 * the price may have moved down into the second or third of them; the program then still swaps through the arrays left,
 * and the exact-message simulation, the encoded minimum output and the finalized receipt bound what that swap delivers.
 * A pool whose current tick lies above the first array or below the last has no array to start from: the quoted message
 * can no longer execute, so it refuses for a new quote. `identity` refuses arrays that are not one aligned descending run.
 */
export function assertWhirlpoolTickArraySequence(starts: readonly number[], tickCurrentIndex: number, tickSpacing: number,
  identity: () => never): void {
  const width = tickSpacing * WHIRLPOOL_TICK_ARRAY_TICKS, first = starts[0];
  if (!Number.isSafeInteger(width) || width < 1 || starts.length !== 3 || first === undefined ||
    starts.some((start, index) => !Number.isSafeInteger(start) || start % width !== 0 || start !== first - index * width)) identity();
  const current = Math.floor(tickCurrentIndex / width) * width, last = first - 2 * width;
  if (current > first || current < last) {
    throw new ApnError("APN_REPREPARE_REQUIRED", "The pool's price moved outside the tick arrays the quoted swap names; quote again.", {
      reason: "jupiter_v1_pool_left_quoted_tick_arrays", tickCurrentIndex, tickSpacing,
      firstTickArrayStart: first, lastTickArrayStart: last,
    });
  }
}
