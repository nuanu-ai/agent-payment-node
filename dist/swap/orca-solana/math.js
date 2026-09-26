import { ApnError } from "../../errors.js";
import { TICK_ARRAY_SIZE } from "./accounts.js";
/**
 * Exact integer port of the Whirlpool exact-input, token A to token B swap loop (swap_manager::swap with
 * swap_math::compute_swap, sqrt_price_math and tick_math), restricted to the three tick arrays the transaction passes.
 * Rounding follows the program: input deltas round up, output deltas round down, next price rounds up. A swap that
 * would reach the end of the passed tick arrays is refused instead of guessed.
 */
const Q64 = 1n << 64n, U64_MAX = (1n << 64n) - 1n, U128_MAX = (1n << 128n) - 1n, U256_MAX = (1n << 256n) - 1n;
const FEE_RATE_DENOMINATOR = 1000000n;
export const WHIRLPOOL_MIN_SQRT_PRICE = 4295048016n;
const MIN_TICK = -443_636;
/** Bit multipliers of sqrt(1.0001)^-(2^i) in Q64.64, from the program's get_sqrt_price_negative_tick. */
const NEGATIVE_TICK_FACTORS = [
    [2, 18444899583751176498n], [4, 18443055278223354162n], [8, 18439367220385604838n], [16, 18431993317065449817n],
    [32, 18417254355718160513n], [64, 18387811781193591352n], [128, 18329067761203520168n], [256, 18212142134806087854n],
    [512, 17980523815641551639n], [1024, 17526086738831147013n], [2048, 16651378430235024244n], [4096, 15030750278693429944n],
    [8192, 12247334978882834399n], [16384, 8131365268884726200n], [32768, 3584323654723342297n], [65536, 696457651847595233n],
    [131072, 26294789957452057n], [262144, 37481735321082n],
];
const MAX_STEPS = 16;
/** The SOL/USDC route uses negative ticks. The separate stable-pair read-only route starts at tick zero. */
export function sqrtPriceAtTick(tick) {
    if (!Number.isSafeInteger(tick) || tick > 1 || tick < MIN_TICK)
        blocked("Whirlpool tick is outside the bounded quote range.", "orca_tick_range");
    if (tick === 0)
        return Q64;
    if (tick === 1)
        return 18447666387855959850n;
    const absolute = -tick;
    let ratio = (absolute & 1) !== 0 ? 18445821805675392311n : Q64;
    for (const [bit, factor] of NEGATIVE_TICK_FACTORS)
        if ((absolute & bit) !== 0)
            ratio = (ratio * factor) >> 64n;
    return ratio;
}
export function quoteWhirlpoolExactInAToB(pool, arrays, amountIn) {
    if (amountIn <= 0n || amountIn > U64_MAX)
        blocked("Whirlpool input must be a positive u64.", "orca_amount");
    if (arrays.length !== 3)
        blocked("Whirlpool swap requires exactly three tick arrays.", "orca_tick_array_state");
    const spacing = pool.tickSpacing, span = TICK_ARRAY_SIZE * spacing, fee = BigInt(pool.feeRate);
    if (spacing <= 0 || fee >= FEE_RATE_DENOMINATOR || pool.liquidity <= 0n || pool.liquidity > U128_MAX)
        blocked("Whirlpool state is not swappable.", "orca_pool_state");
    arrays.forEach((array, index) => {
        if (array.startTickIndex !== tickArrayStart(pool.tickCurrentIndex, spacing) - index * span || array.whirlpool !== pool.address) {
            blocked("Whirlpool tick arrays are not the exact downward sequence from the current tick.", "orca_tick_array_state");
        }
    });
    // The decoded price must lie inside the decoded tick, which also proves the tick math against the live state.
    if (sqrtPriceAtTick(pool.tickCurrentIndex) > pool.sqrtPrice || pool.sqrtPrice >= sqrtPriceAtTick(pool.tickCurrentIndex + 1)) {
        blocked("Whirlpool price and current tick are inconsistent.", "orca_pool_state");
    }
    let remaining = amountIn, output = 0n, feeTotal = 0n, price = pool.sqrtPrice, tick = pool.tickCurrentIndex, liquidity = pool.liquidity;
    let arrayIndex = 0, steps = 0, crossed = 0;
    while (remaining > 0n) {
        if (++steps > MAX_STEPS)
            blocked("Whirlpool swap crosses too many ticks for this bounded quote.", "orca_tick_boundary");
        const next = nextInitializedTick(arrays, tick, spacing, arrayIndex);
        const target = sqrtPriceAtTick(next.tick);
        const step = computeSwapStep(remaining, fee, liquidity, price, target);
        if (next.sequenceEnd && step.nextPrice === target)
            blocked("The swap would reach the end of the passed tick arrays.", "orca_tick_boundary");
        remaining -= step.amountIn + step.fee;
        output = checkedU64(output + step.amountOut);
        feeTotal += step.fee;
        if (step.nextPrice === target) {
            const row = arrays[next.arrayIndex].ticks[(next.tick - arrays[next.arrayIndex].startTickIndex) / spacing];
            if (row.initialized) {
                liquidity -= row.liquidityNet;
                crossed += 1;
            }
            if (liquidity < 0n || liquidity > U128_MAX)
                blocked("Whirlpool liquidity left its bounds while crossing a tick.", "orca_pool_state");
            tick = next.tick - 1;
        }
        else if (step.nextPrice !== price)
            tick = tickAtOrBelow(step.nextPrice, tick);
        price = step.nextPrice;
        arrayIndex = next.arrayIndex;
        if (liquidity === 0n && remaining > 0n)
            blocked("Whirlpool has no liquidity for the rest of this swap.", "orca_pool_state");
    }
    if (output <= 0n)
        blocked("Whirlpool quote returned no output.", "orca_quote_zero");
    const afterFee = amountIn * (FEE_RATE_DENOMINATOR - fee) / FEE_RATE_DENOMINATOR;
    const spot = spotOutput(afterFee, pool.sqrtPrice), shortfall = spot > output ? spot - output : 0n;
    const impact = spot === 0n ? 10000n : (shortfall * 10000n + spot - 1n) / spot;
    return { amountInAtomic: amountIn.toString(), amountOutAtomic: output.toString(), feeAtomic: feeTotal.toString(),
        sqrtPriceBefore: pool.sqrtPrice.toString(), sqrtPriceAfter: price.toString(), tickBefore: pool.tickCurrentIndex, tickAfter: tick,
        steps, initializedTicksCrossed: crossed, spotOutputAfterFeeAtomic: spot.toString(),
        spotOutputPerSolAtomic: spotOutput(1000000000n, pool.sqrtPrice).toString(), priceImpactBps: Number(impact > 10000n ? 10000n : impact) };
}
/** Start tick of the array holding `tick`: floor(tick / (88 * spacing)) * (88 * spacing). */
export function tickArrayStart(tick, spacing) {
    const span = TICK_ARRAY_SIZE * spacing;
    return Math.floor(tick / span) * span;
}
/** sqrtPrice^2 / 2^128 is token B atomic per token A atomic. */
export function spotOutput(amountA, sqrtPrice) { return amountA * sqrtPrice * sqrtPrice / (Q64 * Q64); }
function computeSwapStep(remaining, fee, liquidity, current, target) {
    const fixedToTarget = deltaA(current, target, liquidity, true);
    const calculated = remaining * (FEE_RATE_DENOMINATOR - fee) / FEE_RATE_DENOMINATOR;
    const nextPrice = fixedToTarget <= calculated ? target : nextSqrtPriceFromAInput(current, liquidity, calculated);
    const max = nextPrice === target;
    const amountIn = checkedU64(max ? fixedToTarget : deltaA(current, nextPrice, liquidity, true));
    const amountOut = checkedU64(deltaB(current, nextPrice, liquidity));
    const stepFee = !max ? remaining - amountIn : checkedU64(divideUp(amountIn * fee, FEE_RATE_DENOMINATOR - fee));
    if (amountIn + stepFee > remaining)
        blocked("Whirlpool swap step exceeded the remaining input.", "orca_pool_state");
    return { amountIn, amountOut, fee: stepFee, nextPrice };
}
function deltaA(first, second, liquidity, roundUp) {
    const [lower, upper] = first < second ? [first, second] : [second, first];
    const numerator = (liquidity * (upper - lower)) << 64n, denominator = upper * lower;
    if (numerator > U256_MAX || denominator === 0n)
        blocked("Whirlpool token A delta overflowed.", "orca_pool_state");
    const result = roundUp ? divideUp(numerator, denominator) : numerator / denominator;
    if (result > U128_MAX)
        blocked("Whirlpool token A delta overflowed.", "orca_pool_state");
    return result;
}
function deltaB(first, second, liquidity) {
    const [lower, upper] = first < second ? [first, second] : [second, first];
    const product = liquidity * (upper - lower);
    if (product > U128_MAX)
        blocked("Whirlpool token B delta overflowed.", "orca_pool_state");
    return product >> 64n;
}
function nextSqrtPriceFromAInput(price, liquidity, amount) {
    if (amount === 0n)
        return price;
    const numerator = (liquidity * price) << 64n, denominator = (liquidity << 64n) + price * amount;
    if (numerator > U256_MAX || denominator > U256_MAX)
        blocked("Whirlpool next price overflowed.", "orca_pool_state");
    const next = divideUp(numerator, denominator);
    if (next < WHIRLPOOL_MIN_SQRT_PRICE)
        blocked("Whirlpool next price is below the protocol minimum.", "orca_pool_state");
    return next;
}
function nextInitializedTick(arrays, tick, spacing, start) {
    let search = tick;
    for (let index = start; index < arrays.length; index += 1) {
        const array = arrays[index], lower = array.startTickIndex, upper = lower + TICK_ARRAY_SIZE * spacing;
        if (search < lower || search >= upper)
            blocked("Whirlpool search left the passed tick array.", "orca_tick_boundary");
        for (let offset = Math.floor((search - lower) / spacing); offset >= 0; offset -= 1) {
            if (array.ticks[offset].initialized)
                return { arrayIndex: index, tick: lower + offset * spacing, sequenceEnd: false };
        }
        if (index === arrays.length - 1)
            return { arrayIndex: index, tick: lower, sequenceEnd: true };
        search = lower - 1;
    }
    return blocked("Whirlpool search left the passed tick arrays.", "orca_tick_boundary");
}
/** Highest tick whose sqrt price is at or below `price`, searched downward from the previous tick. */
function tickAtOrBelow(price, from) {
    let tick = from;
    for (let guard = 0; guard < 4_096; guard += 1) {
        if (sqrtPriceAtTick(tick) <= price)
            return tick;
        tick -= 1;
    }
    return blocked("Whirlpool tick recovery exceeded its bound.", "orca_pool_state");
}
function divideUp(numerator, denominator) { return (numerator + denominator - 1n) / denominator; }
function checkedU64(value) { if (value < 0n || value > U64_MAX)
    blocked("Whirlpool amount left u64.", "orca_pool_state"); return value; }
function blocked(message, reason) { throw new ApnError("APN_OPERATION_BLOCKED", message, { reason }); }
//# sourceMappingURL=math.js.map