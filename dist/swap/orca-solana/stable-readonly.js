import { getTokenDecoder } from "@solana-program/token";
import { SOLANA_USDT } from "../../chain-policy.js";
import { ApnError } from "../../errors.js";
import { assertSolanaNetwork } from "../../solana/rpc.js";
import { decodeTickArray, decodeWhirlpool, readRawAccounts, TICK_ARRAY_ACCOUNT_BYTES, whirlpoolOracleAddress, whirlpoolTickArrayAddress } from "./accounts.js";
import { quoteWhirlpoolExactInAToB, spotOutput, tickArrayStart } from "./math.js";
import { ORCA_SOLANA_CHAIN, TICK_ARRAY_ACCOUNT_DISCRIMINATOR, TOKEN_PROGRAM, USDC_MINT, WHIRLPOOL_ACCOUNT_DISCRIMINATOR, WHIRLPOOL_PROGRAM, WHIRLPOOLS_CONFIG } from "./pins.js";
/** C2-05 is intentionally limited to market reads. There is no plan, transaction, signer, or operation record. */
export const ORCA_STABLE_POOL = "4fuUiYxTQ6QCrdSq9ouBYcTM7bqSwYTSyLueGZLTy4T4";
export const ORCA_STABLE_VAULT_A = "4oY1eVHJrt7ywuFoQnAZwto4qcQip1QhYMAhD11PU4QL";
export const ORCA_STABLE_VAULT_B = "4dSG9tKHZR4CAictyEnH9XuGZyKapodWXq5xyg7uFwE9";
export const ORCA_STABLE_FEE_RATE = 100;
export function orcaStableInventory() {
    return { chain: ORCA_SOLANA_CHAIN, mode: "read_only", admitted: false, signable: false, executable: false,
        ownerBalanceVerified: false, tokenAccountVerified: false, fundingVerified: false, feesVerified: false,
        pool: ORCA_STABLE_POOL, program: WHIRLPOOL_PROGRAM, config: WHIRLPOOLS_CONFIG,
        sourceMint: USDC_MINT, destinationMint: SOLANA_USDT, vaultA: ORCA_STABLE_VAULT_A, vaultB: ORCA_STABLE_VAULT_B,
        tickSpacing: 1, feeRate: ORCA_STABLE_FEE_RATE, direction: "USDC_to_USDT_exact_input" };
}
export async function quoteOrcaStableReadOnly(rpc, request) {
    const amount = request.amountAtomic;
    if (typeof amount !== "string" || !/^[1-9][0-9]{0,19}$/u.test(amount) || BigInt(amount) > (1n << 64n) - 1n ||
        !Number.isSafeInteger(request.slippageBps) || request.slippageBps < 0 || request.slippageBps >= 10_000 ||
        !Number.isSafeInteger(request.maximumPriceImpactBps) || request.maximumPriceImpactBps < 0 ||
        request.maximumPriceImpactBps > 10_000 || request.slippageBps > request.maximumPriceImpactBps) {
        throw new ApnError("APN_INVALID_INPUT", "Stable Whirlpool amount or owner quote caps are invalid.");
    }
    await assertSolanaNetwork(rpc);
    const initial = await readRawAccounts(rpc, [ORCA_STABLE_POOL], TICK_ARRAY_ACCOUNT_BYTES);
    const firstPool = pinnedPool(initial.accounts[0] ?? null);
    const start = tickArrayStart(firstPool.tickCurrentIndex, 1);
    const arrays = await Promise.all([0, 1, 2].map((index) => whirlpoolTickArrayAddress(WHIRLPOOL_PROGRAM, ORCA_STABLE_POOL, start - index * 88)));
    const oracle = await whirlpoolOracleAddress(WHIRLPOOL_PROGRAM, ORCA_STABLE_POOL);
    const read = await readRawAccounts(rpc, [ORCA_STABLE_POOL, ...arrays, oracle, ORCA_STABLE_VAULT_A, ORCA_STABLE_VAULT_B], TICK_ARRAY_ACCOUNT_BYTES);
    if (read.slot < initial.slot)
        blocked("RPC returned a stale market snapshot.", "orca_slot_regressed");
    const [poolAccount, a0, a1, a2, oracleAccount, vaultA, vaultB] = read.accounts;
    const pool = pinnedPool(poolAccount ?? null);
    if (tickArrayStart(pool.tickCurrentIndex, 1) !== start)
        blocked("Pool moved across a tick array while reading.", "orca_tick_array_moved");
    if (oracleAccount !== null)
        blocked("Adaptive fee state is outside this pinned quote.", "orca_adaptive_fee");
    const ticks = [a0, a1, a2].map((account, index) => decodeTickArray(arrays[index], account ?? null, WHIRLPOOL_PROGRAM, TICK_ARRAY_ACCOUNT_DISCRIMINATOR));
    const sourceReserve = vaultAmount(vaultA ?? null, USDC_MINT), destinationReserve = vaultAmount(vaultB ?? null, SOLANA_USDT);
    const swap = quoteWhirlpoolExactInAToB(pool, ticks, BigInt(amount));
    if (swap.priceImpactBps > request.maximumPriceImpactBps)
        blocked("Pool impact exceeds the owner cap.", "orca_price_impact");
    if (BigInt(swap.amountOutAtomic) > destinationReserve)
        blocked("Quote exceeds the destination vault reserve.", "orca_pool_state");
    const minimum = (BigInt(swap.amountOutAtomic) * BigInt(10_000 - request.slippageBps) + 9999n) / 10000n;
    if (minimum <= 0n)
        blocked("Minimum output is zero.", "orca_output_floor");
    return { ...orcaStableInventory(), slot: read.slot.toString(), sourceReserveAtomic: sourceReserve.toString(),
        destinationReserveAtomic: destinationReserve.toString(), amountInAtomic: amount,
        expectedOutputAtomic: swap.amountOutAtomic, minimumOutputAtomic: minimum.toString(), feeAtomic: swap.feeAtomic,
        slippageBps: request.slippageBps, priceImpactBps: swap.priceImpactBps,
        spotUsdtPerUsdcAtomic: spotOutput(1000000n, pool.sqrtPrice).toString(),
        tickCurrentIndex: pool.tickCurrentIndex, tickArrayStarts: ticks.map((row) => row.startTickIndex),
        initializedTicksCrossed: swap.initializedTicksCrossed, signed: false, broadcast: false };
}
function pinnedPool(account) {
    const pool = decodeWhirlpool(ORCA_STABLE_POOL, account, WHIRLPOOL_PROGRAM, WHIRLPOOL_ACCOUNT_DISCRIMINATOR);
    if (pool.config !== WHIRLPOOLS_CONFIG || pool.mintA !== USDC_MINT || pool.mintB !== SOLANA_USDT ||
        pool.vaultA !== ORCA_STABLE_VAULT_A || pool.vaultB !== ORCA_STABLE_VAULT_B || pool.tickSpacing !== 1 ||
        pool.feeTierIndexSeed !== 1)
        blocked("Stable Whirlpool identity changed.", "orca_pool_pin_drift");
    if (pool.feeRate !== ORCA_STABLE_FEE_RATE)
        blocked("Stable Whirlpool fee changed.", "orca_pool_fee_drift");
    return pool;
}
function vaultAmount(account, mint) {
    if (account === null || account.owner !== TOKEN_PROGRAM || account.executable || account.data.length !== 165) {
        blocked("Stable Whirlpool vault is missing or malformed.", "orca_pool_pin_drift");
    }
    const token = getTokenDecoder().decode(account.data);
    if (token.mint !== mint || token.owner !== ORCA_STABLE_POOL || token.state !== 1) {
        blocked("Stable Whirlpool vault identity changed.", "orca_pool_pin_drift");
    }
    return token.amount;
}
function blocked(message, reason) { throw new ApnError("APN_OPERATION_BLOCKED", message, { reason }); }
//# sourceMappingURL=stable-readonly.js.map