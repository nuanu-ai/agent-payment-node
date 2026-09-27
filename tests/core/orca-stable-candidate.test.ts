import assert from "node:assert/strict";
import test from "node:test";
import { readdir } from "node:fs/promises";
import { getCompiledTransactionMessageDecoder } from "@solana/kit";
import { SOLANA_GENESIS, SOLANA_USDT } from "../../src/chain-policy.js";
import { sealAssetPolicyRegistry, type UnsignedAssetPolicyRegistry } from "../../src/asset-policy-registry.js";
import { AssetUsageLedger } from "../../src/asset-usage-ledger.js";
import { ApnError } from "../../src/errors.js";
import { type SolanaMethod, type SolanaRpcPort } from "../../src/solana/rpc.js";
import { GuardedSwapService } from "../../src/swap/service.js";
import { SwapOperationRepository } from "../../src/swap/repository.js";
import { whirlpoolOracleAddress, whirlpoolTickArrayAddress } from "../../src/swap/orca-solana/accounts.js";
import { prepareOrcaStableGuardedCandidateCore } from "../../src/swap/orca-solana/stable-candidate.js";
import { ORCA_STABLE_GUARDED_MECHANISM_PIN } from "../../src/swap/orca-solana/stable-mechanism.js";
import { ORCA_SOLANA_CHAIN, SYSTEM_PROGRAM, TOKEN_PROGRAM, USDC_MINT, WHIRLPOOL_PROGRAM } from "../../src/swap/orca-solana/pins.js";
import { ORCA_STABLE_POOL, ORCA_STABLE_VAULT_A, ORCA_STABLE_VAULT_B } from "../../src/swap/orca-solana/stable-readonly.js";
import { temporaryState } from "./helpers.js";
import { input, raw, token } from "./orca-stable-fixture.js";

const NOW = new Date("2026-09-28T12:00:00.000Z");
/** Orca generated client 7.0.0, commit a119d79bada4e730fef791cac6adb669405a21de,
 * ts-sdk/client/src/generated/instructions/swap.ts: discriminator, five fields, and 11 account metas. */
const OFFICIAL_SWAP_DISCRIMINATOR = Buffer.from([248, 198, 158, 145, 225, 117, 135, 200]);
const OFFICIAL_SWAP_WRITABLE = [false, false, true, true, true, true, true, true, true, true, false];
const wire = (account: ReturnType<typeof raw>) => ({ owner: account.owner, data: [account.data.toString("base64"), "base64"],
  executable: account.executable, lamports: account.lamports, rentEpoch: 0n, space: account.space });
const reason = (error: unknown) => error instanceof ApnError ? error.details?.reason : null;

async function fixture(exists = true) {
  const source = await input(exists);
  const row = (mint: string, symbol: string) => ({ kind: "token" as const, identifier: mint, symbol, decimals: 6,
    rails: { direct: false, gasless: false, x402: false, bridge: false, swap: true },
    caps: { maximumPerTransferAtomic: "2000000", dailyLimitAtomic: "3000000" },
    mechanismPins: { swap: ORCA_STABLE_GUARDED_MECHANISM_PIN } });
  const registry = sealAssetPolicyRegistry({ schemaVersion: "apn.asset-policy-registry.v1", registryVersion: "stable-candidate.1",
    publishedAt: "2026-09-28T00:00:00.000Z", effectiveDate: "2026-09-28",
    effectiveAt: "2026-09-28T00:00:00.000Z", expiresAt: "2026-09-29T00:00:00.000Z",
    chains: [{ chain: ORCA_SOLANA_CHAIN, family: "solana", name: "Solana", assets: [row(USDC_MINT, "USDC"), row(SOLANA_USDT, "USDT")] }] } satisfies UnsignedAssetPolicyRegistry);
  const active = { profile: "stable-candidate", registry, digest: registry.policyDigest, revision: 7,
    accounts: { solana: source.owner }, activationDigest: "a".repeat(64), activatedAt: "2026-09-28T00:00:00.000Z" };
  let current = active, usage = "0", fee: bigint | null = 5_000n, simulationError: unknown = null;
  let sourceAfter = token(USDC_MINT, source.owner, 1_000_000n);
  let destinationAfter = token(SOLANA_USDT, source.owner, BigInt(source.quote.minimumOutputAtomic));
  let afterOwner = raw(SYSTEM_PROGRAM, Buffer.alloc(0), exists ? 19_995_000n : 17_995_000n);
  let height = 400_000_000n, rpcRateLimitedAt: SolanaMethod | null = null;
  let afterSimulation: (() => void) | null = null;
  const accounts = new Map<string, ReturnType<typeof wire>>([
    [ORCA_STABLE_POOL, wire(source.snapshot.pool)], [ORCA_STABLE_VAULT_A, wire(source.snapshot.vaultA)],
    [ORCA_STABLE_VAULT_B, wire(source.snapshot.vaultB)], [source.owner, wire(source.snapshot.owner)],
    [source.snapshot.usdcAtaAddress, wire(source.snapshot.usdcAta!)],
  ]);
  if (source.snapshot.usdtAta !== null) accounts.set(source.snapshot.usdtAtaAddress, wire(source.snapshot.usdtAta));
  for (let i = 0; i < 3; i++) accounts.set(await whirlpoolTickArrayAddress(WHIRLPOOL_PROGRAM, ORCA_STABLE_POOL,
    source.quote.tickArrayStarts[i]!), wire(source.snapshot.tickArrays[i]!));
  const calls: SolanaMethod[] = [];
  const rpc: SolanaRpcPort = { originHash: "b".repeat(64), call: async (method, params) => {
    calls.push(method);
    if (method === rpcRateLimitedAt) throw new ApnError("APN_RPC_RATE_LIMITED", "terminal 429");
    if (method === "getGenesisHash") return SOLANA_GENESIS;
    if (method === "getMultipleAccounts") return { context: { slot: 450_687_913n },
      value: (params[0] as string[]).map((key) => accounts.get(key) ?? null) };
    if (method === "getLatestBlockhash") return { context: { slot: 450_687_913n }, value: {
      blockhash: source.lifetime.blockhash, lastValidBlockHeight: 400_000_100n } };
    if (method === "getBlockHeight") return height;
    if (method === "getMinimumBalanceForRentExemption") return 2_000_000n;
    if (method === "getFeeForMessage") return { value: fee };
    if (method === "simulateTransaction") {
      const result = { context: { slot: 450_687_914n }, value: { err: simulationError,
        unitsConsumed: 200_000n, accounts: [wire(afterOwner), wire(sourceAfter), wire(destinationAfter)] } };
      afterSimulation?.();
      return result;
    }
    throw new Error(`Unexpected ${method}`);
  } };
  const ports = { activePolicy: async () => current, localAccount: async () => ({ provider: "local" as const,
    custody: "local_software" as const, address: source.owner, profile: "stable-candidate", schemaVersion: "apn.chain-account.v1" as const,
    profileHash: "c".repeat(64), rail: "solana" as const, network: "mainnet" as const,
    createdAt: NOW.toISOString(), identityHash: "d".repeat(64) }), dailyUsage: async () => usage };
  const temporary = await temporaryState();
  const service = new GuardedSwapService(new SwapOperationRepository(temporary.root), new AssetUsageLedger(temporary.root));
  const request = { profile: "stable-candidate", policyRevision: 7, owner: source.owner, amountAtomic: source.quote.amountInAtomic,
    slippageBps: 50, maximumPriceImpactBps: 50, computeUnitLimit: 250_000, computeUnitPriceMicroLamports: "0",
    createUsdtAta: !exists, ...(exists ? {} : { maximumAtaRentLamports: "2500000" }),
    maximumTotalFeeLamports: "3000000", idempotencyKey: "stable-candidate-key", now: NOW };
  return { source, rpc, ports, service, request, calls, cleanup: temporary.cleanup, root: temporary.root,
    setFee: (value: bigint | null) => { fee = value; }, setError: (value: unknown) => { simulationError = value; },
    setSourceAfter: (value: bigint) => { sourceAfter = token(USDC_MINT, source.owner, value); },
    setDestinationAfter: (value: bigint) => { destinationAfter = token(SOLANA_USDT, source.owner, value); },
    setMalformedDestination: () => { destinationAfter = token(USDC_MINT, source.owner, 1_000_000n); },
    setHeight: (value: bigint) => { height = value; }, setUsage: (value: string) => { usage = value; },
    setRevision: (value: number) => { current = { ...active, revision: value }; },
    driftRevisionAfterSimulation: () => { afterSimulation = () => { current = { ...active, revision: 8 }; }; },
    rateLimitAt: (method: SolanaMethod) => { rpcRateLimitedAt = method; },
  };
}

async function candidate(f: Awaited<ReturnType<typeof fixture>>) {
  return await prepareOrcaStableGuardedCandidateCore(f.rpc, f.ports, f.service, f.request, async () => []);
}
async function assertNoOperation(root: string) {
  const entries = await readdir(root, { recursive: true }).catch((error: NodeJS.ErrnoException) => {
    if (error.code === "ENOENT") return [] as string[];
    throw error;
  });
  assert.equal(entries.some((path) => path.endsWith(".json") && path.includes("swap-operations")), false);
}

for (const exists of [true, false]) test(`guarded stable candidate prepares only after priced simulation, ATA exists=${exists}`, async (t) => {
  const f = await fixture(exists); t.after(f.cleanup);
  const result = await candidate(f);
  assert.equal(result.operation.state, "awaiting_approval");
  assert.equal(result.quote.unsignedTransactionPayloadHash, result.evidence.unsignedPayloadHash);
  assert.equal(result.unsignedTransaction.messageHash, result.evidence.messageHash);
  assert.equal(result.signed, false); assert.equal(result.broadcast, false);
  assert.equal(result.evidence.actualFeeLamports, "5000");
  const decoded = getCompiledTransactionMessageDecoder().decode(Buffer.from(result.unsignedTransaction.payloadBase64, "base64").subarray(65));
  assert.equal(decoded.version, 0);
  const swap = decoded.instructions.at(-1)!;
  assert.equal(decoded.staticAccounts[swap.programAddressIndex], WHIRLPOOL_PROGRAM);
  const swapData = Buffer.from(swap.data ?? []);
  assert.equal(swapData.length, 42);
  assert.deepEqual(swapData.subarray(0, 8), OFFICIAL_SWAP_DISCRIMINATOR);
  assert.equal(swapData.readBigUInt64LE(8), BigInt(f.source.quote.amountInAtomic));
  assert.equal(swapData.readBigUInt64LE(16), BigInt(f.source.quote.minimumOutputAtomic));
  assert.equal(swapData.subarray(24, 40).toString("hex"), "0".repeat(32));
  assert.deepEqual([...swapData.subarray(40)], [1, 1]);
  const tickAddresses = await Promise.all(f.source.quote.tickArrayStarts.map((start) =>
    whirlpoolTickArrayAddress(WHIRLPOOL_PROGRAM, ORCA_STABLE_POOL, start)));
  const expectedAccounts = [TOKEN_PROGRAM, f.source.owner, ORCA_STABLE_POOL, result.evidence.sourceAta,
    ORCA_STABLE_VAULT_A, result.evidence.destinationAta, ORCA_STABLE_VAULT_B, ...tickAddresses,
    await whirlpoolOracleAddress(WHIRLPOOL_PROGRAM, ORCA_STABLE_POOL)];
  const indices = swap.accountIndices ?? [];
  assert.deepEqual(indices.map((i) => decoded.staticAccounts[i]), expectedAccounts);
  // The owner meta is readonly in Orca's instruction; the compiled message makes it writable as fee payer.
  assert.deepEqual(indices.map((i) => i === 0 || i < decoded.staticAccounts.length - decoded.header.numReadonlyNonSignerAccounts),
    OFFICIAL_SWAP_WRITABLE.map((writable, index) => index === 1 ? true : writable));
  assert.ok(f.calls.includes("getFeeForMessage")); assert.ok(f.calls.includes("simulateTransaction"));
});

for (const [name, mutate] of [
  ["fee null", (f: Awaited<ReturnType<typeof fixture>>) => f.setFee(null)],
  ["output short", (f: Awaited<ReturnType<typeof fixture>>) => f.setDestinationAfter(1n)],
  ["source debit high", (f: Awaited<ReturnType<typeof fixture>>) => f.setSourceAfter(0n)],
  ["malformed destination", (f: Awaited<ReturnType<typeof fixture>>) => f.setMalformedDestination()],
  ["simulation error", (f: Awaited<ReturnType<typeof fixture>>) => f.setError({ InstructionError: [2, "Custom"] })],
  ["fee cap", (f: Awaited<ReturnType<typeof fixture>>) => f.setFee(3_000_001n)],
  ["expired", (f: Awaited<ReturnType<typeof fixture>>) => f.setHeight(400_000_100n)],
  ["policy revision", (f: Awaited<ReturnType<typeof fixture>>) => f.setRevision(8)],
  ["policy drift after simulation", (f: Awaited<ReturnType<typeof fixture>>) => f.driftRevisionAfterSimulation()],
  ["daily cap", (f: Awaited<ReturnType<typeof fixture>>) => f.setUsage("2500000")],
  ["terminal 429", (f: Awaited<ReturnType<typeof fixture>>) => f.rateLimitAt("getFeeForMessage")],
] as const) test(`guarded stable candidate refuses ${name} with zero writes`, async (t) => {
  const f = await fixture(); t.after(f.cleanup); mutate(f);
  await assert.rejects(candidate(f));
  await assertNoOperation(f.root);
});
