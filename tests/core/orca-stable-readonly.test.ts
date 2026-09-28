import assert from "node:assert/strict";
import test from "node:test";
import { getTokenEncoder } from "@solana-program/token";
import { getAddressEncoder, address } from "@solana/kit";
import { SOLANA_GENESIS, SOLANA_USDT } from "../../src/chain-policy.js";
import { ApnError } from "../../src/errors.js";
import { type SolanaMethod, type SolanaRpcPort } from "../../src/solana/rpc.js";
import { whirlpoolOracleAddress, whirlpoolTickArrayAddress, type TickArrayState, type WhirlpoolState } from "../../src/swap/orca-solana/accounts.js";
import { quoteWhirlpoolExactInAToB, sqrtPriceAtTick } from "../../src/swap/orca-solana/math.js";
import { ORCA_STABLE_POOL, ORCA_STABLE_VAULT_A, ORCA_STABLE_VAULT_B, orcaStableInventory,
  quoteOrcaStableReadOnly } from "../../src/swap/orca-solana/stable-readonly.js";
import { TOKEN_PROGRAM, USDC_MINT, WHIRLPOOL_PROGRAM, WHIRLPOOLS_CONFIG } from "../../src/swap/orca-solana/pins.js";

const encode = (key: string) => Buffer.from(getAddressEncoder().encode(address(key)));
const wire = (owner: string, data: Buffer) => ({ owner, data: [data.toString("base64"), "base64"], lamports: 1n,
  executable: false, rentEpoch: 0n, space: data.length });
const reason = (error: unknown) => error instanceof ApnError ? error.details?.reason : null;
const input = { amountAtomic: "1000000", slippageBps: 50, maximumPriceImpactBps: 50 };

async function fixture() {
  const pool = Buffer.alloc(653);
  Buffer.from("3f95d10ce1806309", "hex").copy(pool);
  encode(WHIRLPOOLS_CONFIG).copy(pool, 8);
  pool.writeUInt16LE(1, 41); pool.writeUInt16LE(1, 43); pool.writeUInt16LE(100, 45);
  pool.writeBigUInt64LE(4_587_626_145_939_386n, 49);
  pool.writeBigUInt64LE(1_000_000_000_000n, 65); pool.writeBigUInt64LE(1n, 73);
  encode(USDC_MINT).copy(pool, 101); encode(ORCA_STABLE_VAULT_A).copy(pool, 133);
  encode(SOLANA_USDT).copy(pool, 181); encode(ORCA_STABLE_VAULT_B).copy(pool, 213);
  const token = (mint: string, amount: bigint) => Buffer.from(getTokenEncoder().encode({ mint: mint as never,
    owner: ORCA_STABLE_POOL as never, amount, delegate: { __option: "None" }, state: 1,
    isNative: { __option: "None" }, delegatedAmount: 0n, closeAuthority: { __option: "None" } }));
  const accounts = new Map<string, ReturnType<typeof wire>>([
    [ORCA_STABLE_POOL, wire(WHIRLPOOL_PROGRAM, pool)],
    [ORCA_STABLE_VAULT_A, wire(TOKEN_PROGRAM, token(USDC_MINT, 339_542_399_990n))],
    [ORCA_STABLE_VAULT_B, wire(TOKEN_PROGRAM, token(SOLANA_USDT, 379_676_358_729n))],
  ]);
  const starts = [0, -88, -176];
  for (const start of starts) {
    const key = await whirlpoolTickArrayAddress(WHIRLPOOL_PROGRAM, ORCA_STABLE_POOL, start);
    const data = Buffer.alloc(9_988);
    Buffer.from("4561bdbe6e0742bb", "hex").copy(data); data.writeInt32LE(start, 8);
    encode(ORCA_STABLE_POOL).copy(data, 9_956);
    accounts.set(key, wire(WHIRLPOOL_PROGRAM, data));
  }
  const oracle = await whirlpoolOracleAddress(WHIRLPOOL_PROGRAM, ORCA_STABLE_POOL);
  const calls: { method: SolanaMethod; keys?: readonly string[] }[] = [];
  const slots = [450_687_913n, 450_687_913n];
  const rpc: SolanaRpcPort = { originHash: "f".repeat(64), call: async (method, params) => {
    calls.push({ method, ...(method === "getMultipleAccounts" ? { keys: params[0] as readonly string[] } : {}) });
    if (method === "getGenesisHash") return SOLANA_GENESIS;
    if (method === "getMultipleAccounts") return { context: { slot: slots.shift() ?? 450_687_913n },
      value: (params[0] as readonly string[]).map((key) => accounts.get(key) ?? null) };
    throw new Error(`Unexpected effect: ${method}`);
  } };
  return { rpc, calls, accounts, pool, oracle, starts, slots };
}

test("stable pool inventory and quote are keyless, exact and sourced from one slot", async () => {
  const f = await fixture();
  assert.equal(orcaStableInventory().signable, false);
  const quote = await quoteOrcaStableReadOnly(f.rpc, { amountAtomic: "1000000", slippageBps: 50, maximumPriceImpactBps: 50 });
  assert.equal(quote.slot, "450687913");
  assert.deepEqual(quote.tickArrayStarts, f.starts);
  assert.equal(quote.sourceReserveAtomic, "339542399990");
  assert.equal(quote.destinationReserveAtomic, "379676358729");
  assert.equal(quote.signed, false); assert.equal(quote.broadcast, false);
  assert.ok(BigInt(quote.expectedOutputAtomic) > 0n);
  assert.equal(BigInt(quote.minimumOutputAtomic), (BigInt(quote.expectedOutputAtomic) * 9950n + 9999n) / 10000n);
  assert.deepEqual(f.calls.map((call) => call.method), ["getGenesisHash", "getMultipleAccounts", "getMultipleAccounts"]);
  assert.deepEqual(f.calls[2]?.keys?.slice(0, 1), [ORCA_STABLE_POOL]);
  assert.equal(f.calls[2]?.keys?.[4], f.oracle);
});

test("stable quote admits live tick one with the official positive tick two upper bound", async () => {
  const f = await fixture();
  assert.equal(sqrtPriceAtTick(1), 18447666387855959850n);
  assert.equal(sqrtPriceAtTick(2), 18448588748116922571n);
  const livePrice = 18447712270019865443n;
  f.pool.writeBigUInt64LE(livePrice & ((1n << 64n) - 1n), 65);
  f.pool.writeBigUInt64LE(livePrice >> 64n, 73);
  f.pool.writeInt32LE(1, 81);
  f.accounts.set(ORCA_STABLE_POOL, wire(WHIRLPOOL_PROGRAM, f.pool));
  const quote = await quoteOrcaStableReadOnly(f.rpc, input);
  assert.equal(quote.tickCurrentIndex, 1);
  assert.deepEqual(quote.tickArrayStarts, [0, -88, -176]);
  assert.equal(quote.slot, "450687913");
  assert.ok(BigInt(quote.expectedOutputAtomic) > 0n);
  assert.deepEqual(f.calls.map((call) => call.method), ["getGenesisHash", "getMultipleAccounts", "getMultipleAccounts"]);
});

test("stable quote handles the tick one to zero price transition and accepts observed tick two", async () => {
  const crossing = await fixture();
  const boundary = sqrtPriceAtTick(1);
  crossing.pool.writeBigUInt64LE(boundary & ((1n << 64n) - 1n), 65);
  crossing.pool.writeBigUInt64LE(boundary >> 64n, 73);
  crossing.pool.writeInt32LE(1, 81);
  crossing.accounts.set(ORCA_STABLE_POOL, wire(WHIRLPOOL_PROGRAM, crossing.pool));
  const quote = await quoteOrcaStableReadOnly(crossing.rpc, input);
  assert.equal(quote.tickCurrentIndex, 1);
  assert.ok(BigInt(quote.expectedOutputAtomic) > 0n);
  const pool: WhirlpoolState = { address: ORCA_STABLE_POOL, config: WHIRLPOOLS_CONFIG, tickSpacing: 1, feeTierIndexSeed: 1,
    feeRate: 100, protocolFeeRate: 0, liquidity: 4_587_626_145_939_386n, sqrtPrice: boundary, tickCurrentIndex: 1,
    mintA: USDC_MINT, vaultA: ORCA_STABLE_VAULT_A, mintB: SOLANA_USDT, vaultB: ORCA_STABLE_VAULT_B };
  const arrays: TickArrayState[] = [0, -88, -176].map((startTickIndex) => ({ address: "fixture", startTickIndex,
    whirlpool: ORCA_STABLE_POOL, ticks: Array.from({ length: 88 }, () => ({ initialized: false, liquidityNet: 0n })) }));
  assert.equal(quoteWhirlpoolExactInAToB(pool, arrays, 1_000_000n).tickAfter, 0);

  const beyond = await fixture();
  // Pool account observed at slot 451251696: tick 2, sqrt price 18449273916518842236.
  const price = 18449273916518842236n;
  assert.ok(sqrtPriceAtTick(2) <= price && price < sqrtPriceAtTick(3));
  beyond.pool.writeBigUInt64LE(price & ((1n << 64n) - 1n), 65);
  beyond.pool.writeBigUInt64LE(price >> 64n, 73);
  beyond.pool.writeInt32LE(2, 81);
  beyond.accounts.set(ORCA_STABLE_POOL, wire(WHIRLPOOL_PROGRAM, beyond.pool));
  const tickTwoQuote = await quoteOrcaStableReadOnly(beyond.rpc, input);
  assert.equal(tickTwoQuote.tickCurrentIndex, 2);
  assert.ok(BigInt(tickTwoQuote.expectedOutputAtomic) > 0n);
  assert.ok(tickTwoQuote.priceImpactBps <= 50);
  assert.equal(BigInt(tickTwoQuote.minimumOutputAtomic),
    (BigInt(tickTwoQuote.expectedOutputAtomic) * 9950n + 9999n) / 10000n);
  const large = await fixture();
  large.pool.writeBigUInt64LE(price & ((1n << 64n) - 1n), 65);
  large.pool.writeBigUInt64LE(price >> 64n, 73);
  large.pool.writeInt32LE(2, 81);
  large.accounts.set(ORCA_STABLE_POOL, wire(WHIRLPOOL_PROGRAM, large.pool));
  await assert.rejects(quoteOrcaStableReadOnly(large.rpc, { ...input, amountAtomic: "30000000000000" }),
    (error) => reason(error) === "orca_price_impact");
});

test("Whirlpool tick prices match protocol vectors, rise monotonically, and reject outside bounds", () => {
  const vectors: readonly (readonly [number, bigint])[] = [
    [-443_636, 4_295_048_016n], [-1, 18_445_821_805_675_392_311n], [0, 18_446_744_073_709_551_616n],
    [1, 18_447_666_387_855_959_850n], [2, 18_448_588_748_116_922_571n], [3, 18_449_511_154_494_745_446n],
    [4, 18_450_433_606_991_734_263n], [32_768, 94_936_283_578_220_370_716n],
    [443_635, 79_222_712_478_800_779_441_888_593_664n],
    [443_636, 79_226_673_515_401_279_992_447_579_055n],
  ];
  for (const [tick, expected] of vectors) assert.equal(sqrtPriceAtTick(tick), expected);
  for (let tick = -443_636; tick < 443_636; tick += 997) {
    assert.ok(sqrtPriceAtTick(tick) < sqrtPriceAtTick(tick + 1), `non-monotonic tick ${tick}`);
  }
  for (const tick of [-443_637, 443_637, Number.NaN, 1.5]) {
    assert.throws(() => sqrtPriceAtTick(tick), (error) => reason(error) === "orca_tick_range");
  }
});

test("Whirlpool downward quote accepts only the exact maximum tick endpoint price", () => {
  const maximum = sqrtPriceAtTick(443_636);
  const pool: WhirlpoolState = { address: ORCA_STABLE_POOL, config: WHIRLPOOLS_CONFIG, tickSpacing: 1, feeTierIndexSeed: 1,
    feeRate: 100, protocolFeeRate: 0, liquidity: 10n ** 25n, sqrtPrice: maximum, tickCurrentIndex: 443_636,
    mintA: USDC_MINT, vaultA: ORCA_STABLE_VAULT_A, mintB: SOLANA_USDT, vaultB: ORCA_STABLE_VAULT_B };
  const start = Math.floor(443_636 / 88) * 88;
  const arrays: TickArrayState[] = [start, start - 88, start - 176].map((startTickIndex) => ({ address: "fixture", startTickIndex,
    whirlpool: ORCA_STABLE_POOL, ticks: Array.from({ length: 88 }, () => ({ initialized: false, liquidityNet: 0n })) }));
  const quote = quoteWhirlpoolExactInAToB(pool, arrays, 2n);
  assert.ok(BigInt(quote.amountOutAtomic) > 0n);
  assert.ok(BigInt(quote.sqrtPriceAfter) < maximum);
  for (const sqrtPrice of [maximum - 1n, maximum + 1n]) {
    assert.throws(() => quoteWhirlpoolExactInAToB({ ...pool, sqrtPrice }, arrays, 2n),
      (error) => reason(error) === "orca_pool_state");
  }
});

test("stable quote fails closed on pool drift, oracle state, caps and non-mainnet", async () => {
  const f = await fixture();
  await assert.rejects(quoteOrcaStableReadOnly(f.rpc, { amountAtomic: "1000000", slippageBps: 51,
    maximumPriceImpactBps: 50 }), (error) => error instanceof ApnError && error.code === "APN_INVALID_INPUT");
  f.pool.writeUInt16LE(101, 45);
  f.accounts.set(ORCA_STABLE_POOL, wire(WHIRLPOOL_PROGRAM, f.pool));
  await assert.rejects(quoteOrcaStableReadOnly(f.rpc, { amountAtomic: "1000000", slippageBps: 50,
    maximumPriceImpactBps: 50 }), (error) => reason(error) === "orca_pool_fee_drift");
  f.pool.writeUInt16LE(100, 45);
  f.accounts.set(ORCA_STABLE_POOL, wire(WHIRLPOOL_PROGRAM, f.pool));
  f.accounts.set(f.oracle, wire(WHIRLPOOL_PROGRAM, Buffer.alloc(1)));
  await assert.rejects(quoteOrcaStableReadOnly(f.rpc, { amountAtomic: "1000000", slippageBps: 50,
    maximumPriceImpactBps: 50 }), (error) => reason(error) === "orca_adaptive_fee");
  const wrong: SolanaRpcPort = { originHash: "f".repeat(64), call: async () => "wrong-genesis" };
  await assert.rejects(quoteOrcaStableReadOnly(wrong, { amountAtomic: "1000000", slippageBps: 50,
    maximumPriceImpactBps: 50 }), (error) => error instanceof ApnError && error.code === "APN_CHAIN_MISMATCH");
});

test("stable quote rejects regressed slot and mismatched program, vault or tick array", async () => {
  const input = { amountAtomic: "1000000", slippageBps: 50, maximumPriceImpactBps: 50 };
  const stale = await fixture(); stale.slots.splice(0, 2, 450_687_913n, 450_687_912n);
  await assert.rejects(quoteOrcaStableReadOnly(stale.rpc, input), (error) => reason(error) === "orca_slot_regressed");
  const owner = await fixture(); owner.accounts.set(ORCA_STABLE_POOL, wire(TOKEN_PROGRAM, owner.pool));
  await assert.rejects(quoteOrcaStableReadOnly(owner.rpc, input), (error) => reason(error) === "orca_pool_state");
  const vault = await fixture(); vault.accounts.set(ORCA_STABLE_VAULT_B, wire(TOKEN_PROGRAM, Buffer.alloc(165)));
  await assert.rejects(quoteOrcaStableReadOnly(vault.rpc, input), (error) => reason(error) === "orca_pool_pin_drift");
  const ticks = await fixture();
  const key = await whirlpoolTickArrayAddress(WHIRLPOOL_PROGRAM, ORCA_STABLE_POOL, 0);
  ticks.accounts.set(key, wire(WHIRLPOOL_PROGRAM, Buffer.alloc(9_988)));
  await assert.rejects(quoteOrcaStableReadOnly(ticks.rpc, input), (error) => reason(error) === "orca_tick_array_state");
});
