import { getTokenDecoder } from "@solana-program/token";
import { ApnError } from "../../errors.js";
import { rpcAtomic, solanaAddress } from "../../solana/rpc.js";
import { associatedTokenAddress, decodeTickArray, decodeWhirlpool, readRawAccounts, TICK_ARRAY_ACCOUNT_BYTES, whirlpoolOracleAddress, whirlpoolTickArrayAddress } from "./accounts.js";
import { quoteWhirlpoolExactInAToB, tickArrayStart } from "./math.js";
import { ORCA_POOL_FEE_RATE, ORCA_POOL_TICK_SPACING, ORCA_SOL_USDC_POOL, ORCA_SOL_VAULT, ORCA_USDC_VAULT, sha256Hex, TICK_ARRAY_ACCOUNT_DISCRIMINATOR, TOKEN_PROGRAM, USDC_MINT, WHIRLPOOL_ACCOUNT_DISCRIMINATOR, WHIRLPOOL_PROGRAM, WHIRLPOOLS_CONFIG, WSOL_MINT, } from "./pins.js";
import { orcaOwnerBalances } from "./simulation.js";
/**
 * Reads the pinned pool, its two vaults, the three downward tick arrays derived from the current tick, the oracle PDA
 * and the owner's accounts in one `getMultipleAccounts` at one slot, then prices the exact input with the local port of
 * the program's swap math. The tick arrays are derived from a first pool read and re-derived from the same-slot read.
 */
export async function readOrcaMarket(rpc, owner, amountIn) {
    solanaAddress(owner);
    const [wsolAccount, usdcAccount, oracle] = await Promise.all([associatedTokenAddress(owner, WSOL_MINT, TOKEN_PROGRAM),
        associatedTokenAddress(owner, USDC_MINT, TOKEN_PROGRAM), whirlpoolOracleAddress(WHIRLPOOL_PROGRAM, ORCA_SOL_USDC_POOL)]);
    const first = pinnedPool((await readRawAccounts(rpc, [ORCA_SOL_USDC_POOL], TICK_ARRAY_ACCOUNT_BYTES)).accounts[0] ?? null);
    const arrays = await tickArrayAddresses(first);
    const read = await readRawAccounts(rpc, [ORCA_SOL_USDC_POOL, ...arrays, oracle, ORCA_SOL_VAULT, ORCA_USDC_VAULT, owner, wsolAccount, usdcAccount], TICK_ARRAY_ACCOUNT_BYTES);
    const [poolAccount, a0, a1, a2, oracleAccount, solVault, usdcVault, ownerAccount, wsolState, usdcState] = read.accounts;
    const pool = pinnedPool(poolAccount ?? null);
    if ((await tickArrayAddresses(pool)).some((value, index) => value !== arrays[index])) {
        blocked("The pool moved to another tick array between reads; quote again.", "orca_tick_array_moved");
    }
    const tickArrays = [a0, a1, a2].map((account, index) => decodeTickArray(arrays[index], account ?? null, WHIRLPOOL_PROGRAM, TICK_ARRAY_ACCOUNT_DISCRIMINATOR));
    if (oracleAccount !== null)
        blocked("The pool has an adaptive-fee oracle; its variable fee is outside this pinned quote.", "orca_adaptive_fee");
    const vaultSol = vaultAmount(solVault ?? null, WSOL_MINT), vaultUsdc = vaultAmount(usdcVault ?? null, USDC_MINT);
    if (wsolState !== null)
        blocked("The owner's wSOL account already exists; unwrap or close it before this swap.", "orca_wsol_account_present");
    const balances = orcaOwnerBalances(ownerAccount ?? null, usdcState ?? null, owner);
    const rent = rpcAtomic(await rpc.call("getMinimumBalanceForRentExemption", [165, { commitment: "confirmed" }]));
    if (rent === 0n)
        blocked("Token account rent could not be priced.", "orca_rent");
    const swap = quoteWhirlpoolExactInAToB(pool, tickArrays, amountIn);
    const hashes = {};
    [[ORCA_SOL_USDC_POOL, poolAccount], [arrays[0], a0], [arrays[1], a1], [arrays[2], a2], [ORCA_SOL_VAULT, solVault], [ORCA_USDC_VAULT, usdcVault],
        [usdcAccount, usdcState]].forEach(([key, account]) => {
        if (account !== null && account !== undefined && typeof key === "string")
            hashes[key] = sha256Hex(account.data);
    });
    return { slot: read.slot, pool, poolView: { address: pool.address, tickSpacing: pool.tickSpacing, feeRate: pool.feeRate,
            protocolFeeRate: pool.protocolFeeRate, liquidity: pool.liquidity.toString(), sqrtPrice: pool.sqrtPrice.toString(),
            tickCurrentIndex: pool.tickCurrentIndex }, tickArrays, oracle, wsolAccount, usdcAccount, vaultSolLamports: vaultSol.toString(),
        vaultUsdcAtomic: vaultUsdc.toString(), owner: balances, tokenAccountRentLamports: rent, accountDataSha256: hashes, swap };
}
async function tickArrayAddresses(pool) {
    const start = tickArrayStart(pool.tickCurrentIndex, pool.tickSpacing), span = 88 * pool.tickSpacing;
    return await Promise.all([0, 1, 2].map((index) => whirlpoolTickArrayAddress(WHIRLPOOL_PROGRAM, ORCA_SOL_USDC_POOL, start - index * span)));
}
function pinnedPool(account) {
    const pool = decodeWhirlpool(ORCA_SOL_USDC_POOL, account, WHIRLPOOL_PROGRAM, WHIRLPOOL_ACCOUNT_DISCRIMINATOR);
    if (pool.config !== WHIRLPOOLS_CONFIG || pool.mintA !== WSOL_MINT || pool.mintB !== USDC_MINT || pool.vaultA !== ORCA_SOL_VAULT ||
        pool.vaultB !== ORCA_USDC_VAULT || pool.tickSpacing !== ORCA_POOL_TICK_SPACING || pool.feeTierIndexSeed !== ORCA_POOL_TICK_SPACING) {
        blocked("The Whirlpool config, mints, vaults or tick spacing differ from the pin.", "orca_pool_pin_drift");
    }
    if (pool.feeRate !== ORCA_POOL_FEE_RATE)
        blocked("The Whirlpool fee rate changed from the pinned 0.04%.", "orca_pool_fee_drift");
    return pool;
}
function vaultAmount(account, mint) {
    if (account === null || account.owner !== TOKEN_PROGRAM || account.data.length !== 165)
        blocked("A pinned pool vault is missing.", "orca_pool_pin_drift");
    const token = getTokenDecoder().decode(account.data);
    if (token.mint !== mint || token.owner !== ORCA_SOL_USDC_POOL || token.state !== 1)
        blocked("A pinned pool vault changed mint or authority.", "orca_pool_pin_drift");
    return token.amount;
}
function blocked(message, reason) { throw new ApnError("APN_OPERATION_BLOCKED", message, { reason }); }
//# sourceMappingURL=market.js.map