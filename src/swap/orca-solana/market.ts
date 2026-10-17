import { getTokenDecoder } from "@solana-program/token";
import { ApnError } from "../../errors.js";
import { rpcAtomic, solanaAddress, type SolanaRpcPort } from "../../solana/rpc.js";
import { associatedTokenAddress, decodeTickArray, decodeWhirlpool, readRawAccounts, TICK_ARRAY_ACCOUNT_BYTES,
  whirlpoolOracleAddress, whirlpoolTickArrayAddress, type RawSolanaAccount, type TickArrayState, type WhirlpoolState } from "./accounts.js";
import { quoteWhirlpoolExactInAToB, tickArrayStart, type WhirlpoolSwapQuote } from "./math.js";
import { sha256Hex, TICK_ARRAY_ACCOUNT_DISCRIMINATOR, TOKEN_PROGRAM, WHIRLPOOL_ACCOUNT_DISCRIMINATOR, WHIRLPOOL_PROGRAM, WHIRLPOOLS_CONFIG } from "./pins.js";
import { ORCA_POOLS, type OrcaPoolConfig } from "./pools.js";
import { orcaOwnerBalances, orcaTokenOwnerBalances, type OrcaOwnerBalances, type OrcaTokenOwnerBalances } from "./simulation.js";

export type OrcaPoolView = { readonly address: string; readonly tickSpacing: number; readonly feeRate: number; readonly protocolFeeRate: number;
  readonly liquidity: string; readonly sqrtPrice: string; readonly tickCurrentIndex: number };
interface OrcaMarketCommon {
  readonly slot: bigint;
  readonly pool: WhirlpoolState;
  readonly poolView: OrcaPoolView;
  readonly tickArrays: readonly TickArrayState[];
  readonly oracle: string;
  readonly tokenAccountRentLamports: bigint;
  readonly accountDataSha256: Readonly<Record<string, string>>;
  readonly swap: WhirlpoolSwapQuote;
}
/** The sol-usdc pool, in the field names its stored evidence has always used. */
export interface OrcaMarketRead extends OrcaMarketCommon {
  readonly wsolAccount: string;
  readonly usdcAccount: string;
  readonly vaultSolLamports: string;
  readonly vaultUsdcAtomic: string;
  readonly owner: OrcaOwnerBalances;
  /** The owner's existing wSOL account, reused and kept; null when the swap creates and closes it. */
  readonly wsol: OrcaKeptWsol | null;
}
/** A token-input pool: the owner's source (mint A) and destination (mint B) accounts. */
export interface OrcaTokenMarketRead extends OrcaMarketCommon {
  readonly sourceAccount: string;
  readonly destinationAccount: string;
  readonly vaultAAtomic: string;
  readonly vaultBAtomic: string;
  readonly owner: OrcaTokenOwnerBalances;
}
interface PoolRead { readonly slot: bigint; readonly pool: WhirlpoolState; readonly arrays: readonly string[]; readonly oracle: string;
  readonly source: string; readonly destination: string; readonly accounts: readonly (RawSolanaAccount | null)[] }

/**
 * Native SOL to USDC on the sol-usdc pool. Reads the pinned pool, the three downward tick arrays derived from the current
 * tick, the oracle PDA, its two vaults and the owner's accounts: the first eight keys (pool and tick arrays first) in one
 * getMultipleAccounts at one slot, the owner's two token accounts in a second page no more than ORCA_MAX_SLOT_DRIFT slots
 * away, then prices the exact input with the local port of the program's swap math. The tick arrays are derived from a
 * first pool read and re-derived from the pool in the first page.
 */
export async function readOrcaMarket(rpc: SolanaRpcPort, owner: string, amountIn: bigint): Promise<OrcaMarketRead> {
  const config = ORCA_POOLS["sol-usdc"], read = await readPool(rpc, config, owner);
  const [, , , , , vaultA, vaultB, ownerAccount, wsolState, usdcState] = read.accounts;
  const vaultSol = vaultAmount(config, vaultA ?? null, config.mintA), vaultUsdc = vaultAmount(config, vaultB ?? null, config.mintB);
  const wsol = keptWsol(config, wsolState ?? null, owner);
  const balances = orcaOwnerBalances(ownerAccount ?? null, usdcState ?? null, owner);
  const common = await priced(rpc, config, read, amountIn, [[read.destination, usdcState ?? null]]);
  return { ...common, wsolAccount: read.source, usdcAccount: read.destination, vaultSolLamports: vaultSol.toString(),
    vaultUsdcAtomic: vaultUsdc.toString(), owner: balances, wsol };
}

/** A token-input pool: the same reads; the owner's source account must exist and hold at least the exact input. */
export async function readOrcaTokenMarket(rpc: SolanaRpcPort, config: OrcaPoolConfig, owner: string, amountIn: bigint): Promise<OrcaTokenMarketRead> {
  if (config.nativeWrap !== null) throw new ApnError("APN_INVALID_INPUT", "This Orca pool takes native SOL input.");
  const read = await readPool(rpc, config, owner);
  const [, , , , , vaultA, vaultB, ownerAccount, sourceState, destinationState] = read.accounts;
  const vaultAAtomic = vaultAmount(config, vaultA ?? null, config.mintA), vaultBAtomic = vaultAmount(config, vaultB ?? null, config.mintB);
  const balances = orcaTokenOwnerBalances(config, ownerAccount ?? null, sourceState ?? null, destinationState ?? null, owner);
  if (BigInt(balances.sourceAtomic) < amountIn) {
    throw new ApnError("APN_INSUFFICIENT_ASSET", `The ${config.symbolA} balance cannot cover the exact input.`, { reason: "orca_insufficient_source" });
  }
  const common = await priced(rpc, config, read, amountIn, [[read.source, sourceState ?? null], [read.destination, destinationState ?? null]]);
  return { ...common, sourceAccount: read.source, destinationAccount: read.destination,
    vaultAAtomic: vaultAAtomic.toString(), vaultBAtomic: vaultBAtomic.toString(), owner: balances };
}

async function readPool(rpc: SolanaRpcPort, config: OrcaPoolConfig, owner: string): Promise<PoolRead> {
  solanaAddress(owner);
  const [source, destination, oracle] = await Promise.all([associatedTokenAddress(owner, config.mintA, TOKEN_PROGRAM),
    associatedTokenAddress(owner, config.mintB, TOKEN_PROGRAM), whirlpoolOracleAddress(WHIRLPOOL_PROGRAM, config.pool)]);
  const first = pinnedPool(config, (await readRawAccounts(rpc, [config.pool], TICK_ARRAY_ACCOUNT_BYTES)).accounts[0] ?? null);
  const arrays = await tickArrayAddresses(config, first);
  const read = await readRawAccounts(rpc, [config.pool, ...arrays, oracle, config.vaultA, config.vaultB, owner, source, destination],
    TICK_ARRAY_ACCOUNT_BYTES);
  const pool = pinnedPool(config, read.accounts[0] ?? null);
  if ((await tickArrayAddresses(config, pool)).some((value, index) => value !== arrays[index])) {
    blocked("The pool moved to another tick array between reads; quote again.", "orca_tick_array_moved");
  }
  // The local swap math prices the fee rate read above. An adaptive-fee oracle would add a variable fee that math cannot
  // reproduce, so it refuses; the pinned static-fee-tier pool cannot acquire one, and this costs no extra read.
  if (read.accounts[4] !== null) blocked("The pool has an adaptive-fee oracle; its variable fee is outside this pinned quote.", "orca_adaptive_fee");
  return { slot: read.slot, pool, arrays, oracle, source, destination, accounts: read.accounts };
}

async function priced(rpc: SolanaRpcPort, config: OrcaPoolConfig, read: PoolRead, amountIn: bigint,
  owned: readonly (readonly [string, RawSolanaAccount | null])[]): Promise<OrcaMarketCommon> {
  const [poolAccount, a0, a1, a2, , vaultA, vaultB] = read.accounts;
  const tickArrays = [a0, a1, a2].map((account, index) => decodeTickArray(read.arrays[index]!, account ?? null, WHIRLPOOL_PROGRAM,
    TICK_ARRAY_ACCOUNT_DISCRIMINATOR));
  const rent = rpcAtomic(await rpc.call("getMinimumBalanceForRentExemption", [165, { commitment: "confirmed" }]));
  if (rent === 0n) blocked("Token account rent could not be priced.", "orca_rent");
  const pool = read.pool, swap = quoteWhirlpoolExactInAToB(pool, tickArrays, amountIn);
  const hashes: Record<string, string> = {};
  [[config.pool, poolAccount], [read.arrays[0], a0], [read.arrays[1], a1], [read.arrays[2], a2], [config.vaultA, vaultA], [config.vaultB, vaultB],
    ...owned].forEach(([key, account]) => {
    if (account !== null && account !== undefined && typeof key === "string") hashes[key] = sha256Hex((account as RawSolanaAccount).data);
  });
  return { slot: read.slot, pool, poolView: { address: pool.address, tickSpacing: pool.tickSpacing, feeRate: pool.feeRate,
    protocolFeeRate: pool.protocolFeeRate, liquidity: pool.liquidity.toString(), sqrtPrice: pool.sqrtPrice.toString(),
    tickCurrentIndex: pool.tickCurrentIndex }, tickArrays, oracle: read.oracle, tokenAccountRentLamports: rent, accountDataSha256: hashes, swap };
}

export interface OrcaKeptWsol { readonly amountAtomic: string; readonly lamports: string }
/** An existing wSOL account is used only when it is the owner's plain native account; its balance must survive the swap. */
function keptWsol(config: OrcaPoolConfig, account: RawSolanaAccount | null, owner: string): OrcaKeptWsol | null {
  if (account === null) return null;
  if (account.owner !== TOKEN_PROGRAM || account.data.length !== 165) blocked("The owner's wSOL address holds a non-token account.", "orca_wsol_account_unusable");
  const token = getTokenDecoder().decode(account.data);
  if (token.owner !== owner || token.mint !== config.mintA || token.state !== 1 || token.isNative.__option !== "Some" ||
      token.delegate.__option !== "None" || token.closeAuthority.__option !== "None") {
    blocked("The owner's wSOL account is frozen, delegated, closable by another key, or not the owner's.", "orca_wsol_account_unusable");
  }
  return { amountAtomic: token.amount.toString(), lamports: account.lamports.toString() };
}

async function tickArrayAddresses(config: OrcaPoolConfig, pool: WhirlpoolState): Promise<readonly string[]> {
  const start = tickArrayStart(pool.tickCurrentIndex, pool.tickSpacing), span = 88 * pool.tickSpacing;
  return await Promise.all([0, 1, 2].map((index) => whirlpoolTickArrayAddress(WHIRLPOOL_PROGRAM, config.pool, start - index * span)));
}
function pinnedPool(config: OrcaPoolConfig, account: RawSolanaAccount | null): WhirlpoolState {
  const pool = decodeWhirlpool(config.pool, account, WHIRLPOOL_PROGRAM, WHIRLPOOL_ACCOUNT_DISCRIMINATOR);
  if (pool.config !== WHIRLPOOLS_CONFIG || pool.mintA !== config.mintA || pool.mintB !== config.mintB || pool.vaultA !== config.vaultA ||
      pool.vaultB !== config.vaultB || pool.tickSpacing !== config.tickSpacing || pool.feeTierIndexSeed !== config.tickSpacing) {
    blocked("The Whirlpool config, mints, vaults or tick spacing differ from the pin.", "orca_pool_pin_drift");
  }
  // No fee-rate pin (SWAP-18): the swap math prices pool.feeRate from this same read, the encoded minimum output follows
  // from it, and the exact-message simulation and the receipt delta check enforce that minimum.
  return pool;
}
function vaultAmount(config: OrcaPoolConfig, account: RawSolanaAccount | null, mint: string): bigint {
  if (account === null || account.owner !== TOKEN_PROGRAM || account.data.length !== 165) blocked("A pinned pool vault is missing.", "orca_pool_pin_drift");
  const token = getTokenDecoder().decode(account.data);
  if (token.mint !== mint || token.owner !== config.pool || token.state !== 1) blocked("A pinned pool vault changed mint or authority.", "orca_pool_pin_drift");
  return token.amount;
}
function blocked(message: string, reason: string): never { throw new ApnError("APN_OPERATION_BLOCKED", message, { reason }); }
