import { SOLANA_USDT } from "../../chain-policy.js";
import { ApnError } from "../../errors.js";
import { assertSolanaNetwork, rpcAtomic, rpcRecord, solanaAddress, SolanaRpc, type SolanaRpcPort } from "../../solana/rpc.js";
import { associatedTokenAddress, decodeTickArray, decodeWhirlpool, readRawAccounts, TICK_ARRAY_ACCOUNT_BYTES, whirlpoolOracleAddress,
  whirlpoolTickArrayAddress, type RawSolanaAccount } from "./accounts.js";
import { quoteWhirlpoolExactInAToB, tickArrayStart } from "./math.js";
import { ORCA_SOLANA_CHAIN, TOKEN_PROGRAM, USDC_MINT, WHIRLPOOL_ACCOUNT_DISCRIMINATOR, WHIRLPOOL_PROGRAM,
  WHIRLPOOLS_CONFIG, TICK_ARRAY_ACCOUNT_DISCRIMINATOR, type OrcaProgramPinVerifier, verifyOrcaProgramPins } from "./pins.js";
import { prepareOrcaStableUnsigned, type OrcaStablePrepareInput } from "./stable-prepare.js";
import { ORCA_STABLE_POOL, ORCA_STABLE_VAULT_A, ORCA_STABLE_VAULT_B } from "./stable-readonly.js";

export interface OrcaStableSnapshotRequest {
  readonly owner: string; readonly amountAtomic: string; readonly slippageBps: number; readonly maximumPriceImpactBps: number;
  readonly computeUnitLimit: number; readonly computeUnitPriceMicroLamports: string;
  readonly createUsdtAta: boolean; readonly maximumAtaRentLamports?: string; readonly maximumTotalFeeLamports: string;
}

/**
 * Read-only entry. The transport must have a fresh invocation cap and persistent 750 ms provider pacing.
 * Pinned program bytes are checked by the production verifier. Returned preview remains non-signable:
 * RPC observation is not approval, simulation, or authority to send.
 */
export async function readOrcaStableSnapshotAndPrepare(rpc: SolanaRpc, request: OrcaStableSnapshotRequest) {
  if (rpc.budget === undefined || rpc.budget.physicalRequests !== 0 || rpc.budget.maxPhysicalRequests > 24 ||
      rpc.budget.minimumIntervalMs < 750 || !rpc.hasPersistentPacer) {
    throw new ApnError("APN_RPC_CONFIG", "Stable Orca preview needs a fresh 24 POST budget and persistent 750 ms pacing.");
  }
  return await readOrcaStableSnapshotCore(rpc, request, verifyOrcaProgramPins);
}

/** Lower-level read for deterministic fixtures. Only the entry above supplies production pin verification. */
export async function readOrcaStableSnapshotCore(rpc: SolanaRpcPort, request: OrcaStableSnapshotRequest,
  verifyPins: OrcaProgramPinVerifier) {
  solanaAddress(request.owner);
  if (!/^[1-9][0-9]{0,19}$/u.test(request.amountAtomic) || BigInt(request.amountAtomic) > (1n << 64n) - 1n ||
      !Number.isSafeInteger(request.slippageBps) || request.slippageBps < 0 || request.slippageBps >= 10_000 ||
      !Number.isSafeInteger(request.maximumPriceImpactBps) || request.maximumPriceImpactBps < request.slippageBps ||
      request.maximumPriceImpactBps > 10_000) {
    throw new ApnError("APN_INVALID_INPUT", "Stable Orca snapshot quote request is invalid.");
  }
  await assertSolanaNetwork(rpc);
  await verifyPins(rpc);
  const initial = await readRawAccounts(rpc, [ORCA_STABLE_POOL], TICK_ARRAY_ACCOUNT_BYTES);
  const firstPool = pinnedPool(initial.accounts[0] ?? null);
  const start = tickArrayStart(firstPool.tickCurrentIndex, 1);
  const [tick0, tick1, tick2, oracle, usdcAtaAddress, usdtAtaAddress] = await Promise.all([
    whirlpoolTickArrayAddress(WHIRLPOOL_PROGRAM, ORCA_STABLE_POOL, start),
    whirlpoolTickArrayAddress(WHIRLPOOL_PROGRAM, ORCA_STABLE_POOL, start - 88),
    whirlpoolTickArrayAddress(WHIRLPOOL_PROGRAM, ORCA_STABLE_POOL, start - 176),
    whirlpoolOracleAddress(WHIRLPOOL_PROGRAM, ORCA_STABLE_POOL),
    associatedTokenAddress(request.owner, USDC_MINT, TOKEN_PROGRAM),
    associatedTokenAddress(request.owner, SOLANA_USDT, TOKEN_PROGRAM),
  ]);
  const full = await readRawAccounts(rpc, [ORCA_STABLE_POOL, tick0, tick1, tick2, oracle,
    ORCA_STABLE_VAULT_A, ORCA_STABLE_VAULT_B, request.owner, usdcAtaAddress, usdtAtaAddress], TICK_ARRAY_ACCOUNT_BYTES);
  if (full.slot < initial.slot) blocked("Stable Orca snapshot slot regressed.", "orca_slot_regressed");
  const [poolAccount, t0, t1, t2, oracleAccount, vaultA, vaultB, ownerAccount, usdcAta, usdtAta] = full.accounts;
  const pool = pinnedPool(poolAccount ?? null);
  if (tickArrayStart(pool.tickCurrentIndex, 1) !== start) blocked("Stable Orca pool moved across tick arrays.", "orca_tick_array_moved");
  if (poolAccount === null || t0 === null || t1 === null || t2 === null || vaultA === null || vaultB === null || ownerAccount === null)
    blocked("Stable Orca snapshot is missing a required account.", "orca_stable_snapshot_missing");
  // The offline compiler checks every raw account identity and reproduces this quote from the same-slot bytes.
  const quote = quoteFromRaw(pool, [t0!, t1!, t2!], [tick0, tick1, tick2], request, full.slot);
  if (full.slot > BigInt(Number.MAX_SAFE_INTEGER)) blocked("Stable snapshot slot exceeds RPC minContextSlot bounds.", "orca_stable_snapshot_slot");
  const latest = rpcRecord(await rpc.call("getLatestBlockhash", [{ commitment: "confirmed", minContextSlot: Number(full.slot) }]));
  const contextSlot = rpcAtomic(rpcRecord(latest.context).slot);
  if (contextSlot < full.slot) blocked("Stable Orca blockhash read is behind the snapshot.", "orca_slot_regressed");
  if (contextSlot > BigInt(Number.MAX_SAFE_INTEGER)) blocked("Stable blockhash context slot exceeds RPC bounds.", "orca_stable_snapshot_slot");
  const lifetime = rpcRecord(latest.value), blockhash = solanaAddress(lifetime.blockhash as string);
  const lastValidBlockHeight = rpcAtomic(lifetime.lastValidBlockHeight);
  // The height must come from a node at least as current as the blockhash response.
  const currentBlockHeight = rpcAtomic(await rpc.call("getBlockHeight", [{ commitment: "confirmed", minContextSlot: Number(contextSlot) }]));
  let rent: string | undefined;
  if (usdtAta === null && request.createUsdtAta) {
    rent = rpcAtomic(await rpc.call("getMinimumBalanceForRentExemption", [165, { commitment: "confirmed" }])).toString();
  }
  const input: OrcaStablePrepareInput = { owner: request.owner, quote,
    snapshot: { slot: full.slot.toString(), owner: ownerAccount!, usdcAta: usdcAta ?? null, usdtAta: usdtAta ?? null,
      usdcAtaAddress, usdtAtaAddress, pool: poolAccount!, tickArrays: [t0!, t1!, t2!],
      vaultA: vaultA!, vaultB: vaultB!, oracle: oracleAccount ?? null },
    lifetime: { blockhash, currentBlockHeight: currentBlockHeight.toString(), lastValidBlockHeight: lastValidBlockHeight.toString() },
    computeUnitLimit: request.computeUnitLimit, computeUnitPriceMicroLamports: request.computeUnitPriceMicroLamports,
    createUsdtAta: request.createUsdtAta, maximumTotalFeeLamports: request.maximumTotalFeeLamports,
    ...(rent === undefined ? {} : { usdtAtaRentLamports: rent, maximumAtaRentLamports: request.maximumAtaRentLamports }),
  };
  const preview = await prepareOrcaStableUnsigned(input);
  return { source: "rpc_observed_non_signing" as const, rpcOriginHash: rpc.originHash, slot: full.slot.toString(),
    quote, preview, signed: false as const, broadcast: false as const };
}

function quoteFromRaw(pool: ReturnType<typeof decodeWhirlpool>, rows: readonly RawSolanaAccount[], addresses: readonly string[],
  request: OrcaStableSnapshotRequest, slot: bigint): OrcaStablePrepareInput["quote"] {
  const starts = [0, 1, 2].map((index) => tickArrayStart(pool.tickCurrentIndex, 1) - index * 88);
  const ticks = rows.map((row, index) => decodeTickArray(addresses[index]!, row, WHIRLPOOL_PROGRAM,
    TICK_ARRAY_ACCOUNT_DISCRIMINATOR));
  if (ticks.some((tick, index) => tick.startTickIndex !== starts[index] || tick.whirlpool !== ORCA_STABLE_POOL))
    blocked("Stable Orca tick array moved or differs from its PDA.", "orca_stable_tick_state");
  const swap = quoteWhirlpoolExactInAToB(pool, ticks, BigInt(request.amountAtomic));
  if (swap.priceImpactBps > request.maximumPriceImpactBps) blocked("Stable Orca price impact exceeds owner cap.", "orca_price_impact");
  const minimum = (BigInt(swap.amountOutAtomic) * BigInt(10_000 - request.slippageBps) + 9_999n) / 10_000n;
  if (minimum <= 0n) blocked("Stable Orca minimum output is zero.", "orca_output_floor");
  return { chain: ORCA_SOLANA_CHAIN, pool: ORCA_STABLE_POOL, program: WHIRLPOOL_PROGRAM,
    sourceMint: USDC_MINT, destinationMint: SOLANA_USDT, vaultA: ORCA_STABLE_VAULT_A, vaultB: ORCA_STABLE_VAULT_B,
    direction: "USDC_to_USDT_exact_input", slot: slot.toString(), amountInAtomic: request.amountAtomic,
    expectedOutputAtomic: swap.amountOutAtomic, minimumOutputAtomic: minimum.toString(), tickCurrentIndex: pool.tickCurrentIndex,
    tickArrayStarts: starts, slippageBps: request.slippageBps, signed: false, broadcast: false };
}
function pinnedPool(account: RawSolanaAccount | null) {
  const pool = decodeWhirlpool(ORCA_STABLE_POOL, account, WHIRLPOOL_PROGRAM, WHIRLPOOL_ACCOUNT_DISCRIMINATOR);
  if (pool.config !== WHIRLPOOLS_CONFIG || pool.mintA !== USDC_MINT || pool.mintB !== SOLANA_USDT ||
      pool.vaultA !== ORCA_STABLE_VAULT_A || pool.vaultB !== ORCA_STABLE_VAULT_B || pool.tickSpacing !== 1 ||
      pool.feeTierIndexSeed !== 1 || pool.feeRate !== 100) blocked("Stable Orca pool pin changed.", "orca_stable_pool_state");
  return pool;
}
function blocked(message: string, reason: string): never { throw new ApnError("APN_OPERATION_BLOCKED", message, { reason }); }
