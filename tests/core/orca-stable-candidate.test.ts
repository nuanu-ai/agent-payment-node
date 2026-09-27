import assert from "node:assert/strict";
import test from "node:test";
import { readFile, readdir } from "node:fs/promises";
import { getBase58Decoder, getCompiledTransactionMessageDecoder } from "@solana/kit";
import { SOLANA_GENESIS, SOLANA_USDT } from "../../src/chain-policy.js";
import { sealAssetPolicyRegistry, type UnsignedAssetPolicyRegistry } from "../../src/asset-policy-registry.js";
import { AssetUsageLedger } from "../../src/asset-usage-ledger.js";
import { ApnError } from "../../src/errors.js";
import { type SolanaMethod, type SolanaRpcPort } from "../../src/solana/rpc.js";
import { GuardedSwapService } from "../../src/swap/service.js";
import { SwapOperationRepository } from "../../src/swap/repository.js";
import { whirlpoolTickArrayAddress } from "../../src/swap/orca-solana/accounts.js";
import { prepareOrcaStableGuardedCandidateCore } from "../../src/swap/orca-solana/stable-candidate.js";
import { ORCA_STABLE_GUARDED_MECHANISM_PIN } from "../../src/swap/orca-solana/stable-mechanism.js";
import { ORCA_SOLANA_CHAIN, SYSTEM_PROGRAM, TOKEN_PROGRAM, USDC_MINT, WHIRLPOOL_PROGRAM } from "../../src/swap/orca-solana/pins.js";
import { ORCA_STABLE_POOL, ORCA_STABLE_VAULT_A, ORCA_STABLE_VAULT_B } from "../../src/swap/orca-solana/stable-readonly.js";
import { temporaryState } from "./helpers.js";
import { input, raw, token } from "./orca-stable-fixture.js";

const NOW = new Date("2026-09-28T12:00:00.000Z");
const OFFICIAL_SWAP = JSON.parse(await readFile(new URL("../../../tests/core/fixtures/orca-stable-swap-official-7.0.0.json",
  import.meta.url), "utf8")) as { readonly amountAtomic: string; readonly minimumOutputAtomic: string;
  readonly programAddress: string; readonly dataHex: string;
  readonly accounts: readonly { readonly address: string; readonly role: number }[] };
const TOKEN_2022_PROGRAM = "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb";
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
  let inputTransfer = BigInt(source.quote.amountInAtomic), outputTransfer = BigInt(source.quote.minimumOutputAtomic);
  let missingTrace = false, extraCpi = false, token2022 = false, compiledTrace = false;
  let destinationAccount = source.snapshot.usdtAtaAddress;
  let postSource = token(USDC_MINT, source.owner, 1_000_000n);
  let postDestination = token(SOLANA_USDT, source.owner, BigInt(source.quote.minimumOutputAtomic));
  const postOwner = raw(SYSTEM_PROGRAM, Buffer.alloc(0), 19_995_000n);
  let simulationSlot = 450_687_914n, trustedTime = NOW;
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
      const message = getCompiledTransactionMessageDecoder().decode(Buffer.from(params[0] as string, "base64").subarray(65));
      const keys = message.staticAccounts;
      const transfer = (accountKeys: readonly string[], amount: bigint, programId: string = TOKEN_PROGRAM) => {
        const data = Buffer.alloc(9); data[0] = 3; data.writeBigUInt64LE(amount, 1);
        return compiledTrace ? { programIdIndex: keys.indexOf(programId as never),
          accounts: accountKeys.map((key) => keys.indexOf(key as never)), data: getBase58Decoder().decode(data) } :
          { programId, accounts: accountKeys, data: getBase58Decoder().decode(data) };
      };
      const instructions = [
        transfer([source.snapshot.usdcAtaAddress, ORCA_STABLE_VAULT_A, source.owner], inputTransfer,
          token2022 ? TOKEN_2022_PROGRAM : TOKEN_PROGRAM),
        transfer([ORCA_STABLE_VAULT_B, destinationAccount, ORCA_STABLE_POOL], outputTransfer),
        ...(extraCpi ? [transfer([source.snapshot.usdcAtaAddress, ORCA_STABLE_VAULT_A, source.owner], 1n)] : []),
      ];
      const result = { context: { slot: simulationSlot }, value: { err: simulationError,
        unitsConsumed: 200_000n, innerInstructions: missingTrace ? null : [{ index: exists ? 2 : 3, instructions }],
        accounts: [wire(postOwner), wire(postSource), wire(postDestination)] } };
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
    maximumTotalFeeLamports: "3000000", idempotencyKey: "stable-candidate-key", now: new Date("2000-01-01T00:00:00.000Z") };
  return { source, rpc, ports, service, request, calls, cleanup: temporary.cleanup, root: temporary.root,
    setFee: (value: bigint | null) => { fee = value; }, setError: (value: unknown) => { simulationError = value; },
    setInputTransfer: (value: bigint) => { inputTransfer = value; },
    setOutputTransfer: (value: bigint) => { outputTransfer = value; },
    setMalformedDestination: () => { accounts.set(source.snapshot.usdtAtaAddress,
      wire(token(USDC_MINT, source.owner, 1_000_000n))); },
    setMalformedPostDestination: () => { postDestination = token(USDC_MINT, source.owner, 1_000_000n); },
    setWrongOutputAccount: () => { destinationAccount = source.snapshot.usdcAtaAddress; },
    setMissingTrace: () => { missingTrace = true; }, setExtraCpi: () => { extraCpi = true; },
    useCompiledTrace: () => { compiledTrace = true; },
    setToken2022: () => { token2022 = true; }, setSimulationSlot: (value: bigint) => { simulationSlot = value; },
    clock: () => trustedTime, advanceClockAfterSimulation: () => { afterSimulation = () => {
      trustedTime = new Date(NOW.getTime() + 31_000); }; },
    setHeight: (value: bigint) => { height = value; }, setUsage: (value: string) => { usage = value; },
    setRevision: (value: number) => { current = { ...active, revision: value }; },
    driftRevisionAfterSimulation: () => { afterSimulation = () => { current = { ...active, revision: 8 }; }; },
    rateLimitAt: (method: SolanaMethod) => { rpcRateLimitedAt = method; },
  };
}

async function candidate(f: Awaited<ReturnType<typeof fixture>>) {
  return await prepareOrcaStableGuardedCandidateCore(f.rpc, f.ports, f.service, f.request, async () => [], f.clock);
}
async function assertNoOperation(root: string) {
  const entries = await readdir(root, { recursive: true }).catch((error: NodeJS.ErrnoException) => {
    if (error.code === "ENOENT") return [] as string[];
    throw error;
  });
  assert.equal(entries.some((path) => path.endsWith(".json") && path.includes("swap-operations")), false);
}

test("guarded stable candidate prepares only after same-simulation CPI transfer proof", async (t) => {
  const f = await fixture(); t.after(f.cleanup);
  const result = await candidate(f);
  assert.equal(result.operation.state, "awaiting_approval");
  assert.equal(result.quote.unsignedTransactionPayloadHash, result.evidence.unsignedPayloadHash);
  assert.equal(result.unsignedTransaction.messageHash, result.evidence.messageHash);
  assert.equal(result.signed, false); assert.equal(result.broadcast, false);
  assert.equal(result.evidence.actualFeeLamports, "5000");
  const decoded = getCompiledTransactionMessageDecoder().decode(Buffer.from(result.unsignedTransaction.payloadBase64, "base64").subarray(65));
  assert.equal(decoded.version, 0);
  assert.equal(decoded.header.numSignerAccounts, 1);
  assert.equal(decoded.staticAccounts[0], f.source.owner);
  const swap = decoded.instructions.at(-1)!;
  assert.equal(decoded.staticAccounts[swap.programAddressIndex], OFFICIAL_SWAP.programAddress);
  assert.equal(Buffer.from(swap.data ?? []).toString("hex"), OFFICIAL_SWAP.dataHex);
  assert.equal(f.source.quote.amountInAtomic, OFFICIAL_SWAP.amountAtomic);
  assert.equal(f.source.quote.minimumOutputAtomic, OFFICIAL_SWAP.minimumOutputAtomic);
  const indices = swap.accountIndices ?? [];
  assert.deepEqual(indices.map((i) => decoded.staticAccounts[i]), OFFICIAL_SWAP.accounts.map((account) => account.address));
  // The official owner meta is readonly signer; the compiled message makes it writable as fee payer.
  assert.deepEqual(indices.map((i) => i === 0 || i < decoded.staticAccounts.length - decoded.header.numReadonlyNonSignerAccounts),
    OFFICIAL_SWAP.accounts.map((account, index) => index === 1 ? true : account.role === 1 || account.role === 3));
  assert.equal(result.evidence.simulation.sourceDebitedAtomic, f.source.quote.amountInAtomic);
  assert.equal(result.evidence.simulation.destinationCreditedAtomic, f.source.quote.minimumOutputAtomic);
  assert.equal(result.quote.effectiveAt, NOW.toISOString());
  assert.ok(f.calls.includes("getFeeForMessage")); assert.ok(f.calls.includes("simulateTransaction"));
});

test("guarded candidate refuses absent destination ATA until setup CPI whitelist is proven", async (t) => {
  const f = await fixture(false); t.after(f.cleanup);
  await assert.rejects(candidate(f), (error) => reason(error) === "orca_stable_ata_trace_unsupported");
  await assertNoOperation(f.root);
});

test("guarded candidate checks ATA rent cap before its explicit unsupported setup boundary", async (t) => {
  const f = await fixture(false); t.after(f.cleanup);
  await assert.rejects(prepareOrcaStableGuardedCandidateCore(f.rpc, f.ports, f.service,
    { ...f.request, maximumAtaRentLamports: "1000000" }, async () => [], f.clock),
  (error) => reason(error) === "orca_stable_rent_cap");
  await assertNoOperation(f.root);
});

test("guarded stable candidate accepts compiled CPI account indices from the same simulation", async (t) => {
  const f = await fixture(); t.after(f.cleanup); f.useCompiledTrace();
  const result = await candidate(f);
  assert.equal(result.operation.state, "awaiting_approval");
  assert.equal(result.evidence.simulation.slot, "450687914");
  assert.notEqual(result.evidence.beforeSlot, result.evidence.simulation.slot);
});

for (const [name, mutate] of [
  ["fee null", (f: Awaited<ReturnType<typeof fixture>>) => f.setFee(null)],
  ["output short", (f: Awaited<ReturnType<typeof fixture>>) => f.setOutputTransfer(1n)],
  ["source under debit", (f: Awaited<ReturnType<typeof fixture>>) => f.setInputTransfer(999_999n)],
  ["source over debit", (f: Awaited<ReturnType<typeof fixture>>) => f.setInputTransfer(1_000_001n)],
  ["malformed destination", (f: Awaited<ReturnType<typeof fixture>>) => f.setMalformedDestination()],
  ["malformed simulated destination", (f: Awaited<ReturnType<typeof fixture>>) => f.setMalformedPostDestination()],
  ["wrong output account", (f: Awaited<ReturnType<typeof fixture>>) => f.setWrongOutputAccount()],
  ["missing CPI trace", (f: Awaited<ReturnType<typeof fixture>>) => f.setMissingTrace()],
  ["extra CPI transfer", (f: Awaited<ReturnType<typeof fixture>>) => f.setExtraCpi()],
  ["Token-2022 CPI", (f: Awaited<ReturnType<typeof fixture>>) => f.setToken2022()],
  ["simulation error", (f: Awaited<ReturnType<typeof fixture>>) => f.setError({ InstructionError: [2, "Custom"] })],
  ["fee cap", (f: Awaited<ReturnType<typeof fixture>>) => f.setFee(3_000_001n)],
  ["expired", (f: Awaited<ReturnType<typeof fixture>>) => f.setHeight(400_000_100n)],
  ["stale trusted clock", (f: Awaited<ReturnType<typeof fixture>>) => f.advanceClockAfterSimulation()],
  ["policy revision", (f: Awaited<ReturnType<typeof fixture>>) => f.setRevision(8)],
  ["policy drift after simulation", (f: Awaited<ReturnType<typeof fixture>>) => f.driftRevisionAfterSimulation()],
  ["daily cap", (f: Awaited<ReturnType<typeof fixture>>) => f.setUsage("2500000")],
  ["terminal 429", (f: Awaited<ReturnType<typeof fixture>>) => f.rateLimitAt("getFeeForMessage")],
] as const) test(`guarded stable candidate refuses ${name} with zero writes`, async (t) => {
  const f = await fixture(); t.after(f.cleanup); mutate(f);
  await assert.rejects(candidate(f));
  await assertNoOperation(f.root);
});
