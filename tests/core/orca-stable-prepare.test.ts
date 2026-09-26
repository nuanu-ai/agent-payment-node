import assert from "node:assert/strict";
import test from "node:test";
import { getTokenEncoder } from "@solana-program/token";
import { address, createKeyPairSignerFromPrivateKeyBytes, getAddressEncoder, getCompiledTransactionMessageDecoder } from "@solana/kit";
import { SOLANA_USDT } from "../../src/chain-policy.js";
import { ApnError } from "../../src/errors.js";
import { associatedTokenAddress, whirlpoolTickArrayAddress, type TickArrayState, type WhirlpoolState } from "../../src/swap/orca-solana/accounts.js";
import { ORCA_SOLANA_CHAIN, SYSTEM_PROGRAM, TOKEN_PROGRAM, USDC_MINT, WHIRLPOOL_PROGRAM, WHIRLPOOLS_CONFIG } from "../../src/swap/orca-solana/pins.js";
import { ORCA_STABLE_POOL, ORCA_STABLE_VAULT_A, ORCA_STABLE_VAULT_B } from "../../src/swap/orca-solana/stable-readonly.js";
import { quoteWhirlpoolExactInAToB } from "../../src/swap/orca-solana/math.js";
import { prepareOrcaStableUnsigned, validateOrcaStableUnsigned, type OrcaStablePrepareInput } from "../../src/swap/orca-solana/stable-prepare.js";

const raw = (owner: string, data: Buffer, lamports = 3_000_000n) => ({ owner, data, lamports, space: data.length, executable: false });
const token = (mint: string, owner: string, amount: bigint) => raw(TOKEN_PROGRAM, Buffer.from(getTokenEncoder().encode({
  mint: mint as never, owner: owner as never, amount, delegate: { __option: "None" }, state: 1,
  isNative: { __option: "None" }, delegatedAmount: 0n, closeAuthority: { __option: "None" },
})));
async function input(exists = true): Promise<OrcaStablePrepareInput> {
  const owner = (await createKeyPairSignerFromPrivateKeyBytes(Buffer.alloc(32, 23))).address;
  const encode = (key: string) => Buffer.from(getAddressEncoder().encode(address(key)));
  const poolBytes = Buffer.alloc(653);
  Buffer.from("3f95d10ce1806309", "hex").copy(poolBytes);
  encode(WHIRLPOOLS_CONFIG).copy(poolBytes, 8);
  poolBytes.writeUInt16LE(1, 41); poolBytes.writeUInt16LE(1, 43); poolBytes.writeUInt16LE(100, 45);
  poolBytes.writeBigUInt64LE(4_587_626_145_939_386n, 49);
  poolBytes.writeBigUInt64LE(1_000_000_000_000n, 65); poolBytes.writeBigUInt64LE(1n, 73);
  encode(USDC_MINT).copy(poolBytes, 101); encode(ORCA_STABLE_VAULT_A).copy(poolBytes, 133);
  encode(SOLANA_USDT).copy(poolBytes, 181); encode(ORCA_STABLE_VAULT_B).copy(poolBytes, 213);
  const pool: WhirlpoolState = { address: ORCA_STABLE_POOL, config: WHIRLPOOLS_CONFIG, tickSpacing: 1,
    feeTierIndexSeed: 1, feeRate: 100, protocolFeeRate: 0, liquidity: 4_587_626_145_939_386n,
    sqrtPrice: 1_000_000_000_000n + (1n << 64n), tickCurrentIndex: 0,
    mintA: USDC_MINT, mintB: SOLANA_USDT, vaultA: ORCA_STABLE_VAULT_A, vaultB: ORCA_STABLE_VAULT_B };
  const starts = [0, -88, -176];
  const arrays: TickArrayState[] = [];
  const arrayBytes = [];
  for (const start of starts) {
    const key = await whirlpoolTickArrayAddress(WHIRLPOOL_PROGRAM, ORCA_STABLE_POOL, start);
    const bytes = Buffer.alloc(9_988); Buffer.from("4561bdbe6e0742bb", "hex").copy(bytes);
    bytes.writeInt32LE(start, 8); encode(ORCA_STABLE_POOL).copy(bytes, 9_956);
    arrayBytes.push(raw(WHIRLPOOL_PROGRAM, bytes));
    arrays.push({ address: key, startTickIndex: start, whirlpool: ORCA_STABLE_POOL,
      ticks: Array.from({ length: 88 }, () => ({ initialized: false, liquidityNet: 0n })) });
  }
  const expected = BigInt(quoteWhirlpoolExactInAToB(pool, arrays, 1_000_000n).amountOutAtomic);
  const minimum = (expected * 9_950n + 9_999n) / 10_000n;
  return { owner, quote: { chain: ORCA_SOLANA_CHAIN, pool: ORCA_STABLE_POOL, program: WHIRLPOOL_PROGRAM,
    sourceMint: USDC_MINT, destinationMint: SOLANA_USDT, vaultA: ORCA_STABLE_VAULT_A, vaultB: ORCA_STABLE_VAULT_B,
    direction: "USDC_to_USDT_exact_input", slot: "450687913", amountInAtomic: "1000000", expectedOutputAtomic: expected.toString(),
    minimumOutputAtomic: minimum.toString(), tickCurrentIndex: 0, tickArrayStarts: starts, slippageBps: 50,
    signed: false, broadcast: false },
  snapshot: { slot: "450687913", owner: raw(SYSTEM_PROGRAM, Buffer.alloc(0), 20_000_000n),
    usdcAta: token(USDC_MINT, owner, 2_000_000n), usdtAta: exists ? token(SOLANA_USDT, owner, 0n) : null,
    usdcAtaAddress: await associatedTokenAddress(owner, USDC_MINT, TOKEN_PROGRAM),
    usdtAtaAddress: await associatedTokenAddress(owner, SOLANA_USDT, TOKEN_PROGRAM),
    pool: raw(WHIRLPOOL_PROGRAM, poolBytes), tickArrays: arrayBytes,
    vaultA: token(USDC_MINT, ORCA_STABLE_POOL, 339_542_399_990n),
    vaultB: token(SOLANA_USDT, ORCA_STABLE_POOL, 379_676_358_729n), oracle: null },
  lifetime: { blockhash: "D3CDPQLoa9jY1LXCkpUqd3JQDWz8DX1LDE1dhmJt9fq4", currentBlockHeight: "400000000", lastValidBlockHeight: "400000100" },
  computeUnitLimit: 250000, computeUnitPriceMicroLamports: "0", maximumTotalFeeLamports: "3000000", createUsdtAta: !exists,
  ...(exists ? {} : { usdtAtaRentLamports: "2000000", maximumAtaRentLamports: "2500000" }) };
}
const reason = (error: unknown) => error instanceof ApnError ? error.details?.reason : null;

test("offline stable preview compiles exact token swap without wrap or close", async () => {
  const value = await prepareOrcaStableUnsigned(await input());
  assert.equal(value.signable, false); assert.equal(value.executable, false);
  assert.equal(value.trust, "untrusted_offline_snapshot");
  assert.equal(value.totalFeeAndRentLamports, "5000");
  assert.deepEqual(value.instructionPrograms, ["ComputeBudget111111111111111111111111111111", "ComputeBudget111111111111111111111111111111", WHIRLPOOL_PROGRAM]);
  const message = getCompiledTransactionMessageDecoder().decode(Buffer.from(value.messageBase64, "base64"));
  assert.equal(message.header.numSignerAccounts, 1);
  assert.equal(message.staticAccounts[0], value.owner);
  assert.equal(message.version, 0);
  if (message.version !== 0) throw new Error("Expected v0 message");
  assert.equal(message.instructions.length, 3);
  assert.equal(await validateOrcaStableUnsigned(value), value);
});

test("absent USDT ATA requires explicit rent-capped creation", async () => {
  const value = await prepareOrcaStableUnsigned(await input(false));
  assert.equal(value.instructionPrograms.length, 4);
  assert.equal(value.totalFeeAndRentLamports, "2005000");
  const absent = { ...await input(false), createUsdtAta: false };
  await assert.rejects(prepareOrcaStableUnsigned(absent), (error) => reason(error) === "orca_stable_destination_absent");
  const overCap = { ...await input(false), maximumAtaRentLamports: "1000000" };
  await assert.rejects(prepareOrcaStableUnsigned(overCap), (error) => reason(error) === "orca_stable_rent_cap");
});

test("snapshot, ownership, amount, expiry and message mutations fail closed", async () => {
  const base = await input();
  await assert.rejects(prepareOrcaStableUnsigned({ ...base, snapshot: { ...base.snapshot, usdcAtaAddress: base.snapshot.usdtAtaAddress } }),
    (error) => reason(error) === "orca_stable_ata_mismatch");
  await assert.rejects(prepareOrcaStableUnsigned({ ...base, snapshot: { ...base.snapshot, usdcAta: token(USDC_MINT, base.owner, 1n) } }),
    (error) => reason(error) === "orca_stable_balance");
  await assert.rejects(prepareOrcaStableUnsigned({ ...base, snapshot: { ...base.snapshot, usdcAta: token(USDC_MINT, SYSTEM_PROGRAM, 2_000_000n) } }),
    (error) => reason(error) === "orca_stable_ata_state");
  await assert.rejects(prepareOrcaStableUnsigned({ ...base, quote: { ...base.quote, pool: SYSTEM_PROGRAM } }),
    (error) => reason(error) === "orca_stable_pin_drift");
  await assert.rejects(prepareOrcaStableUnsigned({ ...base, lifetime: { ...base.lifetime, currentBlockHeight: "400000100" } }),
    (error) => reason(error) === "orca_stable_lifetime");
  const preview = await prepareOrcaStableUnsigned(base);
  await assert.rejects(validateOrcaStableUnsigned({ ...preview, amountInAtomic: "1000001" }),
    (error) => reason(error) === "orca_stable_manifest_digest");
  await assert.rejects(validateOrcaStableUnsigned({ ...preview, unsignedPayload: preview.unsignedPayload.slice(0, -4) + "AAAA" }),
    (error) => reason(error) === "orca_stable_manifest_digest");
  await assert.rejects(validateOrcaStableUnsigned({ ...preview, marketSlot: "450687914" }),
    (error) => reason(error) === "orca_stable_manifest_digest");
  await assert.rejects(validateOrcaStableUnsigned({ ...preview, lastValidBlockHeight: "400000101" }),
    (error) => reason(error) === "orca_stable_manifest_digest");
  await assert.rejects(prepareOrcaStableUnsigned({ ...base, quote: { ...base.quote, expectedOutputAtomic: (BigInt(base.quote.expectedOutputAtomic) + 1n).toString() } }),
    (error) => reason(error) === "orca_stable_quote_state");
  await assert.rejects(prepareOrcaStableUnsigned({ ...base, snapshot: { ...base.snapshot, oracle: raw(WHIRLPOOL_PROGRAM, Buffer.alloc(1)) } }),
    (error) => reason(error) === "orca_stable_pool_state");
  const changedPool = Buffer.from(base.snapshot.pool.data); changedPool.writeUInt16LE(101, 45);
  await assert.rejects(prepareOrcaStableUnsigned({ ...base, snapshot: { ...base.snapshot, pool: raw(WHIRLPOOL_PROGRAM, changedPool) } }),
    (error) => reason(error) === "orca_stable_pool_state");
  await assert.rejects(prepareOrcaStableUnsigned({ ...base, snapshot: { ...base.snapshot,
    vaultB: token(USDC_MINT, ORCA_STABLE_POOL, 379_676_358_729n) } }),
    (error) => reason(error) === "orca_stable_vault_state");
  const changedTick = Buffer.from(base.snapshot.tickArrays[0]!.data); changedTick.writeInt32LE(88, 8);
  await assert.rejects(prepareOrcaStableUnsigned({ ...base, snapshot: { ...base.snapshot,
    tickArrays: [raw(WHIRLPOOL_PROGRAM, changedTick), ...base.snapshot.tickArrays.slice(1)] } }),
    (error) => reason(error) === "orca_stable_tick_state");
  await assert.rejects(prepareOrcaStableUnsigned({ ...base, maximumTotalFeeLamports: "4999" }),
    (error) => reason(error) === "orca_stable_fee_cap");
  await assert.rejects(prepareOrcaStableUnsigned({ ...base, computeUnitPriceMicroLamports: "100000000", maximumTotalFeeLamports: "3000000" }),
    (error) => reason(error) === "orca_stable_fee_cap");
  await assert.rejects(prepareOrcaStableUnsigned({ ...base, snapshot: { ...base.snapshot, owner: raw(SYSTEM_PROGRAM, Buffer.alloc(0), 4999n) } }),
    (error) => reason(error) === "orca_stable_fee_cap");
});

import { SolanaRpc, type SolanaMethod, type SolanaRpcPort } from "../../src/solana/rpc.js";
import { SOLANA_GENESIS } from "../../src/chain-policy.js";
import { readOrcaStableSnapshotAndPrepare, readOrcaStableSnapshotCore } from "../../src/swap/orca-solana/stable-snapshot.js";

const wire = (account: OrcaStablePrepareInput["snapshot"]["owner"]) => ({ owner: account.owner,
  data: [account.data.toString("base64"), "base64"], executable: account.executable,
  lamports: account.lamports, rentEpoch: 0n, space: account.space });
async function snapshotRpc() {
  const source = await input();
  const accounts = new Map<string, ReturnType<typeof wire>>([
    [ORCA_STABLE_POOL, wire(source.snapshot.pool)],
    [ORCA_STABLE_VAULT_A, wire(source.snapshot.vaultA)], [ORCA_STABLE_VAULT_B, wire(source.snapshot.vaultB)],
    [source.owner, wire(source.snapshot.owner)], [source.snapshot.usdcAtaAddress, wire(source.snapshot.usdcAta!)],
    [source.snapshot.usdtAtaAddress, wire(source.snapshot.usdtAta!)],
  ]);
  for (let i = 0; i < 3; i++) accounts.set(await whirlpoolTickArrayAddress(WHIRLPOOL_PROGRAM, ORCA_STABLE_POOL,
    source.quote.tickArrayStarts[i]!), wire(source.snapshot.tickArrays[i]!));
  const calls: SolanaMethod[] = [];
  let firstSlot = 450_687_913n, fullSlot = 450_687_913n, blockhashSlot = 450_687_913n;
  let staleHeightTrap = false, heightMinContextSlot: number | null = null;
  const rpc: SolanaRpcPort = { originHash: "a".repeat(64), call: async (method, params) => {
    calls.push(method);
    if (method === "getGenesisHash") return SOLANA_GENESIS;
    if (method === "getMultipleAccounts") return { context: { slot: calls.filter((row) => row === "getMultipleAccounts").length === 1 ? firstSlot : fullSlot },
      value: (params[0] as string[]).map((key) => accounts.get(key) ?? null) };
    if (method === "getLatestBlockhash") return { context: { slot: blockhashSlot }, value: {
      blockhash: source.lifetime.blockhash, lastValidBlockHeight: 400_000_100n } };
    if (method === "getBlockHeight") {
      heightMinContextSlot = (params[0] as { minContextSlot: number }).minContextSlot;
      return staleHeightTrap && BigInt(heightMinContextSlot) >= blockhashSlot ? 400_000_101n : 400_000_000n;
    }
    throw new Error(`unexpected ${method}`);
  } };
  return { source, rpc, calls, accounts, setSlots: (first: bigint, full: bigint) => { firstSlot = first; fullSlot = full; blockhashSlot = full; },
    trapOutOfOrderHeight: () => { blockhashSlot = fullSlot + 10n; staleHeightTrap = true; },
    heightMinContextSlot: () => heightMinContextSlot };
}
const snapshotRequest = (value: OrcaStablePrepareInput) => ({ owner: value.owner, amountAtomic: value.quote.amountInAtomic,
  slippageBps: value.quote.slippageBps, maximumPriceImpactBps: 50, computeUnitLimit: value.computeUnitLimit,
  computeUnitPriceMicroLamports: value.computeUnitPriceMicroLamports, createUsdtAta: false,
  maximumTotalFeeLamports: value.maximumTotalFeeLamports });

test("read-only snapshot observes market and owner in one slot before offline preview", async () => {
  const f = await snapshotRpc(); let verified = 0;
  const result = await readOrcaStableSnapshotCore(f.rpc, snapshotRequest(f.source), async () => { verified++; return []; });
  assert.equal(verified, 1);
  assert.equal(result.slot, "450687913");
  assert.equal(result.preview.trust, "untrusted_offline_snapshot");
  assert.equal(result.preview.signable, false); assert.equal(result.preview.executable, false);
  assert.deepEqual(f.calls, ["getGenesisHash", "getMultipleAccounts", "getMultipleAccounts", "getLatestBlockhash", "getBlockHeight"]);
  assert.equal(result.quote.expectedOutputAtomic, f.source.quote.expectedOutputAtomic);
});


test("block height is read at the blockhash context, rejecting an expired hash from an out-of-order provider", async () => {
  const f = await snapshotRpc(); f.trapOutOfOrderHeight();
  await assert.rejects(readOrcaStableSnapshotCore(f.rpc, snapshotRequest(f.source), async () => []),
    (error) => reason(error) === "orca_stable_lifetime");
  assert.equal(f.heightMinContextSlot(), 450_687_923);
  assert.deepEqual(f.calls, ["getGenesisHash", "getMultipleAccounts", "getMultipleAccounts", "getLatestBlockhash", "getBlockHeight"]);
});

test("snapshot reader refuses regressed slot, vault drift, terminal RPC error and unguarded transport", async () => {
  const stale = await snapshotRpc(); stale.setSlots(450_687_914n, 450_687_913n);
  await assert.rejects(readOrcaStableSnapshotCore(stale.rpc, snapshotRequest(stale.source), async () => []),
    (error) => reason(error) === "orca_slot_regressed");
  const drift = await snapshotRpc(); drift.accounts.set(ORCA_STABLE_VAULT_B, wire(token(USDC_MINT, ORCA_STABLE_POOL, 379_676_358_729n)));
  await assert.rejects(readOrcaStableSnapshotCore(drift.rpc, snapshotRequest(drift.source), async () => []),
    (error) => reason(error) === "orca_stable_vault_state");
  const stopped = await snapshotRpc(); let calls = 0;
  const terminal: SolanaRpcPort = { originHash: stopped.rpc.originHash, call: async (method, params) => {
    calls++;
    if (method === "getMultipleAccounts") throw new ApnError("APN_RPC_RATE_LIMITED", "terminal 429");
    return await stopped.rpc.call(method, params);
  } };
  await assert.rejects(readOrcaStableSnapshotCore(terminal, snapshotRequest(stopped.source), async () => []),
    (error) => error instanceof ApnError && error.code === "APN_RPC_RATE_LIMITED");
  assert.equal(calls, 2);
  const unguarded = new SolanaRpc("https://api.mainnet-beta.solana.com", async () => { throw new Error("must not fetch"); });
  await assert.rejects(readOrcaStableSnapshotAndPrepare(unguarded, snapshotRequest(stopped.source)),
    (error) => error instanceof ApnError && error.code === "APN_RPC_CONFIG");
});
