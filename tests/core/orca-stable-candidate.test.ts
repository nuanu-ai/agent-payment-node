import assert from "node:assert/strict";
import test from "node:test";
import { readFile, readdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { bindArgv } from "../../src/command-binder.js";
import { ApnCore } from "../../src/core.js";
import { StateStore } from "../../src/state.js";
import { getBase58Decoder, getBase58Encoder, getCompiledTransactionMessageDecoder } from "@solana/kit";
import { parseJsonWithBigInts } from "@solana/rpc-spec-types";
import { SOLANA_GENESIS, SOLANA_USDT } from "../../src/chain-policy.js";
import { sealAssetPolicyRegistry, type UnsignedAssetPolicyRegistry } from "../../src/asset-policy-registry.js";
import { AssetUsageLedger } from "../../src/asset-usage-ledger.js";
import { ApnError } from "../../src/errors.js";
import { SolanaRpc, type SolanaMethod, type SolanaRpcPort } from "../../src/solana/rpc.js";
import { GuardedSwapService, preparedSwapOperationId } from "../../src/swap/service.js";
import { SwapOperationRepository } from "../../src/swap/repository.js";
import { whirlpoolTickArrayAddress } from "../../src/swap/orca-solana/accounts.js";
import { prepareOrcaStableGuardedCandidateCore, simulateOrcaStableGuardedCore,
  simulateOrcaStableGuardedReadOnly } from "../../src/swap/orca-solana/stable-candidate.js";
import { ORCA_STABLE_GUARDED_MECHANISM_PIN } from "../../src/swap/orca-solana/stable-mechanism.js";
import { SavedOrcaStableMaterialStore } from "../../src/swap/orca-solana/stable-material.js";
import { orcaStablePreparedStatus } from "../../src/swap/orca-solana/stable-status.js";
import { ATA_PROGRAM, ORCA_SOLANA_CHAIN, SYSTEM_PROGRAM, TOKEN_PROGRAM, USDC_MINT, WHIRLPOOL_PROGRAM } from "../../src/swap/orca-solana/pins.js";
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
  let missingTrace = false, extraCpi = false, token2022 = false, compiledTrace = false, parsedTrace = false;
  let mutateParsed: ((groups: Array<{ index: number; instructions: Array<Record<string, unknown>> }>) => void) | null = null;
  let setupVariant: "valid" | "payer" | "mint" | "program" | "ata" | "owner" | "extra" | "rent" = "valid";
  let destinationAccount = source.snapshot.usdtAtaAddress;
  let destinationAppears = false;
  let postSource = token(USDC_MINT, source.owner, 1_000_000n);
  let postDestination = token(SOLANA_USDT, source.owner, BigInt(source.quote.minimumOutputAtomic));
  if (!exists) postDestination = raw(TOKEN_PROGRAM, postDestination.data, 2_000_000n);
  let postOwner = raw(SYSTEM_PROGRAM, Buffer.alloc(0), exists ? 19_995_000n : 17_995_000n);
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
    if (method === "getMultipleAccounts") {
      if (destinationAppears && (params[0] as string[]).length === 3) {
        accounts.set(source.snapshot.usdtAtaAddress, wire(token(SOLANA_USDT, source.owner, 0n)));
      }
      return { context: { slot: 450_687_913n },
      value: (params[0] as string[]).map((key) => accounts.get(key) ?? null) };
    }
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
      const encode = (bytes: Buffer) => getBase58Decoder().decode(bytes);
      const setupData = Buffer.alloc(52);
      setupData.writeBigUInt64LE(setupVariant === "rent" ? 2_000_001n : 2_000_000n, 4);
      setupData.writeBigUInt64LE(165n, 12);
      Buffer.from(getBase58Encoder().encode(TOKEN_PROGRAM)).copy(setupData, 20);
      const setup = [
        { programId: TOKEN_PROGRAM, accounts: [setupVariant === "mint" ? USDC_MINT : SOLANA_USDT], data: encode(Buffer.from([21, 7, 0])) },
        { programId: setupVariant === "program" ? ATA_PROGRAM : SYSTEM_PROGRAM,
          accounts: [setupVariant === "payer" ? source.snapshot.usdcAtaAddress : source.owner,
            setupVariant === "ata" ? source.snapshot.usdcAtaAddress : source.snapshot.usdtAtaAddress],
          data: encode(setupData) },
        { programId: TOKEN_PROGRAM, accounts: [source.snapshot.usdtAtaAddress], data: encode(Buffer.from([22])) },
        { programId: TOKEN_PROGRAM, accounts: [source.snapshot.usdtAtaAddress, SOLANA_USDT],
          data: encode(Buffer.concat([Buffer.from([18]), Buffer.from(getBase58Encoder().encode(
            setupVariant === "owner" ? source.snapshot.usdcAtaAddress : source.owner))])) },
        ...(setupVariant === "extra" ? [{ programId: SYSTEM_PROGRAM, accounts: [source.owner, source.snapshot.usdtAtaAddress],
          data: encode(setupData) }] : []),
      ];
      const setupInstructions = compiledTrace ? setup.map((instruction) => ({
        programIdIndex: keys.indexOf(instruction.programId as never),
        accounts: instruction.accounts.map((key) => keys.indexOf(key as never)), data: instruction.data,
      })) : setup;
      const parsedTransfers = [
        { program: "spl-token", programId: TOKEN_PROGRAM, parsed: { type: "transfer", info: {
          source: source.snapshot.usdcAtaAddress, destination: ORCA_STABLE_VAULT_A,
          amount: inputTransfer.toString(), authority: source.owner } } },
        { program: "spl-token", programId: TOKEN_PROGRAM, parsed: { type: "transfer", info: {
          source: ORCA_STABLE_VAULT_B, destination: destinationAccount,
          amount: outputTransfer.toString(), authority: ORCA_STABLE_POOL } } },
      ];
      const parsedSetup = [
        { program: "spl-token", programId: TOKEN_PROGRAM, parsed: { type: "getAccountDataSize", info: {
          mint: SOLANA_USDT, extensionTypes: ["immutableOwner"] } } },
        { program: "system", programId: SYSTEM_PROGRAM, parsed: { type: "createAccount", info: {
          source: source.owner, newAccount: source.snapshot.usdtAtaAddress, lamports: 2_000_000,
          space: 165, owner: TOKEN_PROGRAM } } },
        { program: "spl-token", programId: TOKEN_PROGRAM, parsed: { type: "initializeImmutableOwner", info: {
          account: source.snapshot.usdtAtaAddress } } },
        { program: "spl-token", programId: TOKEN_PROGRAM, parsed: { type: "initializeAccount3", info: {
          account: source.snapshot.usdtAtaAddress, mint: SOLANA_USDT, owner: source.owner } } },
      ];
      const groups = [
        ...(!exists ? [{ index: 2, instructions: parsedTrace ? parsedSetup : setupInstructions }] : []),
        { index: exists ? 2 : 3, instructions: parsedTrace ? parsedTransfers : instructions },
      ];
      if (parsedTrace) mutateParsed?.(groups);
      const result = { context: { slot: simulationSlot }, value: { err: simulationError,
        unitsConsumed: 200_000n, innerInstructions: missingTrace ? null : groups,
        accounts: [wire(postOwner), wire(postSource), wire(postDestination)] } };
      afterSimulation?.();
      return parsedTrace ? parseJsonWithBigInts(JSON.stringify(result, (_, value) =>
        typeof value === "bigint" ? Number(value) : value)) : result;
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
    setDestinationAppears: () => { destinationAppears = true; },
    setMalformedPostDestination: () => { postDestination = token(USDC_MINT, source.owner, 1_000_000n); },
    setWrongOutputAccount: () => { destinationAccount = source.snapshot.usdcAtaAddress; },
    setMissingTrace: () => { missingTrace = true; }, setExtraCpi: () => { extraCpi = true; },
    setSetupVariant: (value: typeof setupVariant) => { setupVariant = value; },
    setPostOwnerLamports: (value: bigint) => { postOwner = raw(SYSTEM_PROGRAM, Buffer.alloc(0), value); },
    useCompiledTrace: () => { compiledTrace = true; },
    useParsedTrace: (mutate?: typeof mutateParsed) => { parsedTrace = true; mutateParsed = mutate ?? null; },
    setToken2022: () => { token2022 = true; }, setSimulationSlot: (value: bigint) => { simulationSlot = value; },
    clock: () => trustedTime, advanceClockAfterSimulation: () => { afterSimulation = () => {
      trustedTime = new Date(NOW.getTime() + 31_000); }; },
    setHeight: (value: bigint) => { height = value; }, setUsage: (value: string) => { usage = value; },
    setRevision: (value: number) => { current = { ...active, revision: value }; },
    setActivation: (value: string) => { current = { ...active, activationDigest: value }; },
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
async function stateEntries(root: string): Promise<string[]> {
  return (await readdir(root, { recursive: true }).catch((error: NodeJS.ErrnoException) => {
    if (error.code === "ENOENT") return [] as string[];
    throw error;
  })).sort();
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

test("current-owner stable simulation proves the CPI trace without persisting or exposing transaction bytes", async (t) => {
  const f = await fixture(); t.after(f.cleanup);
  const before = await stateEntries(f.root);
  const result = await simulateOrcaStableGuardedCore(f.rpc, f.ports, f.request, async () => [], f.clock);
  assert.equal(result.schemaVersion, "apn.orca-stable-guarded-simulation.v1");
  assert.equal(result.mode, "read_only");
  assert.equal(result.signable, false); assert.equal(result.executable, false);
  assert.equal(result.signed, false); assert.equal(result.broadcast, false);
  assert.equal(result.evidence.simulation.sourceDebitedAtomic, f.source.quote.amountInAtomic);
  assert.equal(result.evidence.simulation.destinationCreditedAtomic, f.source.quote.minimumOutputAtomic);
  assert.ok(f.calls.includes("simulateTransaction"));
  assert.ok(!f.calls.includes("sendTransaction"));
  assert.equal("unsignedTransaction" in result, false);
  assert.deepEqual(await stateEntries(f.root), before);
  await assertNoOperation(f.root);
});

test("current-owner stable simulation fails closed on an unproven CPI trace with zero state writes", async (t) => {
  const f = await fixture(); t.after(f.cleanup); f.setMissingTrace();
  await assert.rejects(simulateOrcaStableGuardedCore(f.rpc, f.ports, f.request, async () => [], f.clock));
  await assertNoOperation(f.root);
});

test("read-only stable simulation entry refuses an unbounded transport before owner or RPC reads", async (t) => {
  const f = await fixture(); t.after(f.cleanup);
  await assert.rejects(simulateOrcaStableGuardedReadOnly(new SolanaRpc(), f.ports, f.request),
    (error) => error instanceof ApnError && error.code === "APN_RPC_CONFIG");
  assert.deepEqual(f.calls, []);
  await assertNoOperation(f.root);
});

test("guarded candidate creates only the missing owner USDT ATA inside the atomic swap", async (t) => {
  const f = await fixture(false); t.after(f.cleanup);
  const result = await candidate(f);
  assert.equal(result.operation.state, "awaiting_approval");
  assert.equal(result.evidence.rentLamports, "2000000");
  assert.equal(result.evidence.simulation.ownerLamportsAfter, "17995000");
  assert.equal(result.evidence.simulation.destinationCreditedAtomic, f.source.quote.minimumOutputAtomic);
});

test("parsed RPC JSON proves both owner ATA creation and stable swap transfers", async (t) => {
  const f = await fixture(false); t.after(f.cleanup); f.useParsedTrace();
  const result = await candidate(f);
  assert.equal(result.operation.state, "awaiting_approval");
  assert.equal(result.evidence.simulation.destinationCreditedAtomic, f.source.quote.minimumOutputAtomic);
  assert.equal(result.evidence.simulation.swapOuterInstructionIndex, 3);
});

test("parsed RPC JSON proves stable swap when the destination ATA already exists", async (t) => {
  const f = await fixture(); t.after(f.cleanup); f.useParsedTrace();
  const result = await simulateOrcaStableGuardedCore(f.rpc, f.ports, f.request, async () => [], f.clock);
  assert.equal(result.evidence.simulation.tokenTransferCount, 2);
  await assertNoOperation(f.root);
});

const parsedMutations: Record<string, (groups: Array<{ index: number; instructions: Array<Record<string, unknown>> }>) => void> = {
  index: (groups) => { groups[0]!.index = 1; },
  extraGroup: (groups) => { groups.push({ index: 4, instructions: [] }); },
  extraCpi: (groups) => { groups[1]!.instructions.push(groups[1]!.instructions[0]!); },
  mint: (groups) => { parsedInfoForTest(groups[0]!.instructions[0]!).mint = USDC_MINT; },
  extension: (groups) => { parsedInfoForTest(groups[0]!.instructions[0]!).extensionTypes = []; },
  payer: (groups) => { parsedInfoForTest(groups[0]!.instructions[1]!).source = ORCA_STABLE_VAULT_A; },
  rent: (groups) => { parsedInfoForTest(groups[0]!.instructions[1]!).lamports = 2_000_001; },
  space: (groups) => { parsedInfoForTest(groups[0]!.instructions[1]!).space = 164; },
  ata: (groups) => { parsedInfoForTest(groups[0]!.instructions[1]!).newAccount = ORCA_STABLE_VAULT_B; },
  owner: (groups) => { parsedInfoForTest(groups[0]!.instructions[3]!).owner = ORCA_STABLE_POOL; },
  program: (groups) => { groups[1]!.instructions[0]!.programId = TOKEN_2022_PROGRAM; },
  type: (groups) => { (groups[1]!.instructions[0]!.parsed as Record<string, unknown>).type = "transferChecked"; },
  authority: (groups) => { parsedInfoForTest(groups[1]!.instructions[0]!).authority = ORCA_STABLE_POOL; },
  source: (groups) => { parsedInfoForTest(groups[1]!.instructions[0]!).source = ORCA_STABLE_VAULT_A; },
  destination: (groups) => { parsedInfoForTest(groups[1]!.instructions[1]!).destination = ORCA_STABLE_VAULT_A; },
  amount: (groups) => { parsedInfoForTest(groups[1]!.instructions[0]!).amount = "1"; },
  multisig: (groups) => { parsedInfoForTest(groups[1]!.instructions[0]!).signers = [ORCA_STABLE_POOL]; },
  topLevelAccounts: (groups) => { groups[1]!.instructions[0]!.accounts = [ORCA_STABLE_POOL]; },
};
function parsedInfoForTest(instruction: Record<string, unknown>): Record<string, unknown> {
  return (instruction.parsed as { info: Record<string, unknown> }).info;
}
for (const [name, mutate] of Object.entries(parsedMutations)) {
  test(`parsed RPC JSON rejects ${name} CPI mutation without an operation`, async (t) => {
    const f = await fixture(false); t.after(f.cleanup); f.useParsedTrace(mutate);
    await assert.rejects(candidate(f), (error) => reason(error) === "orca_stable_trace_invalid");
    await assertNoOperation(f.root);
  });
}

test("guarded candidate checks ATA rent cap before simulation", async (t) => {
  const f = await fixture(false); t.after(f.cleanup);
  await assert.rejects(prepareOrcaStableGuardedCandidateCore(f.rpc, f.ports, f.service,
    { ...f.request, maximumAtaRentLamports: "1000000" }, async () => [], f.clock),
  (error) => reason(error) === "orca_stable_rent_cap");
  await assertNoOperation(f.root);
});

for (const variant of ["payer", "mint", "program", "ata", "owner", "extra", "rent"] as const) {
  test(`guarded ATA candidate refuses forged ${variant} setup CPI with zero writes`, async (t) => {
    const f = await fixture(false); t.after(f.cleanup); f.setSetupVariant(variant);
    await assert.rejects(candidate(f), (error) => reason(error) === "orca_stable_trace_invalid");
    await assertNoOperation(f.root);
  });
}

test("guarded ATA candidate refuses surplus swap CPI and non-rent owner debit", async (t) => {
  const extra = await fixture(false); t.after(extra.cleanup); extra.setExtraCpi();
  await assert.rejects(candidate(extra), (error) => reason(error) === "orca_stable_trace_invalid");
  await assertNoOperation(extra.root);
  const debit = await fixture(false); t.after(debit.cleanup); debit.setPostOwnerLamports(17_994_999n);
  await assert.rejects(candidate(debit), (error) => reason(error) === "orca_stable_simulation_delta");
  await assertNoOperation(debit.root);
});

test("guarded ATA candidate rejects an ATA that appears between snapshot and final account read", async (t) => {
  const f = await fixture(false); t.after(f.cleanup); f.setDestinationAppears();
  await assert.rejects(candidate(f), (error) => reason(error) === "orca_stable_ata_state");
  await assertNoOperation(f.root);
});

test("guarded stable candidate accepts compiled CPI account indices from the same simulation", async (t) => {
  const f = await fixture(); t.after(f.cleanup); f.useCompiledTrace();
  const result = await candidate(f);
  assert.equal(result.operation.state, "awaiting_approval");
  assert.equal(result.evidence.simulation.slot, "450687914");
  assert.notEqual(result.evidence.beforeSlot, result.evidence.simulation.slot);
});

test("guarded ATA candidate accepts compiled setup and swap CPI indices", async (t) => {
  const f = await fixture(false); t.after(f.cleanup); f.useCompiledTrace();
  const result = await candidate(f);
  assert.equal(result.operation.state, "awaiting_approval");
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

test("stable prepare binds CLI input, persists exact unsigned material, and status survives reopening", async (t) => {
  const f = await fixture(false); t.after(f.cleanup); f.useCompiledTrace();
  const request = bindArgv(["swap", "solana", "orca", "stable-prepare", "--profile", f.request.profile,
    "--policy-revision", String(f.request.policyRevision), "--owner", f.request.owner,
    "--amount", f.request.amountAtomic, "--slippage-bps", String(f.request.slippageBps),
    "--maximum-price-impact-bps", String(f.request.maximumPriceImpactBps),
    "--compute-unit-limit", String(f.request.computeUnitLimit), "--compute-unit-price", f.request.computeUnitPriceMicroLamports,
    "--create-usdt-ata", "true", "--maximum-ata-rent", f.request.maximumAtaRentLamports!,
    "--maximum-total-fee", f.request.maximumTotalFeeLamports, "--idempotency-key", f.request.idempotencyKey]).request;
  assert.equal(request.command, "swap.orca.stable-prepare");
  const store = new SavedOrcaStableMaterialStore(f.root);
  const core = new ApnCore({ state: new StateStore(f.root), clock: { now: f.clock },
    orcaStablePrepare: async () => prepareOrcaStableGuardedCandidateCore(f.rpc, f.ports, f.service,
      f.request, async () => [], f.clock, store),
    orcaStableStatus: operationId => orcaStablePreparedStatus(new SwapOperationRepository(f.root),
      new SavedOrcaStableMaterialStore(f.root), f.ports, operationId, f.clock()) });
  const prepared = await core.execute(request);
  assert.equal(prepared.ok, true);
  const operation = (prepared.data as any).operation;
  assert.equal(operation.state, "awaiting_approval");
  const reopened = new SavedOrcaStableMaterialStore(f.root);
  const material = await reopened.load(operation.operationId, operation);
  assert.equal(material?.preview.messageHash, (prepared.data as any).unsignedTransaction.messageHash);
  assert.equal(material?.preview.createUsdtAta, true);
  const status = await core.execute(bindArgv(["swap", "solana", "orca", "stable-status", "--operation", operation.operationId]).request);
  assert.equal(status.ok, true);
  assert.equal((status.data as any).signable, false);
  assert.equal((status.data as any).materialDigest, material?.materialDigest);
  assert.ok(f.calls.includes("simulateTransaction"));
  assert.ok(!f.calls.includes("sendTransaction"));
  for (const command of ["status", "approve", "execute"] as const) {
    const generic = await core.execute({ command: `swap.orca.${command}`, operationId: operation.operationId });
    assert.equal(generic.ok, false);
    assert.equal(generic.error?.details?.reason, "orca_mechanism_mismatch");
  }
});

test("stable status fails closed on material tamper, expiry, and active policy drift", async (t) => {
  const f = await fixture(); t.after(f.cleanup);
  const store = new SavedOrcaStableMaterialStore(f.root);
  const prepared = await prepareOrcaStableGuardedCandidateCore(f.rpc, f.ports, f.service,
    f.request, async () => [], f.clock, store);
  const operationId = prepared.operation.operationId;
  const operations = new SwapOperationRepository(f.root);
  const fresh = () => orcaStablePreparedStatus(operations, new SavedOrcaStableMaterialStore(f.root), f.ports, operationId, f.clock());
  assert.equal((await fresh()).operation.operationId, operationId);
  await assert.rejects(orcaStablePreparedStatus(operations, store, { ...f.ports, localAccount: async () => null },
    operationId, f.clock()), (error) => reason(error) === "orca_stable_owner_account");
  f.setActivation("b".repeat(64));
  await assert.rejects(fresh(), (error) => reason(error) === "orca_stable_policy_drift");
  f.setActivation("a".repeat(64));
  f.setRevision(8);
  await assert.rejects(fresh(), (error) => reason(error) === "orca_stable_policy_drift");
  await assert.rejects(orcaStablePreparedStatus(operations, store, f.ports, operationId,
    new Date(NOW.getTime() + 60_000)), (error) => error instanceof ApnError && error.code === "APN_REPREPARE_REQUIRED");
  const file = join(f.root, "orca-stable-material", `${operationId}.json`);
  const material = JSON.parse(await readFile(file, "utf8"));
  material.preview.unsignedPayload = "AA==";
  await writeFile(file, JSON.stringify(material));
  await assert.rejects(fresh());
});

test("material write failure leaves no operation and same-key retry prepares cleanly", async (t) => {
  const f = await fixture(); t.after(f.cleanup);
  class FailingMaterialStore extends SavedOrcaStableMaterialStore {
    override async save(): Promise<never> { throw new Error("injected material write failure"); }
  }
  await assert.rejects(prepareOrcaStableGuardedCandidateCore(f.rpc, f.ports, f.service, f.request,
    async () => [], f.clock, new FailingMaterialStore(f.root)), /injected material write failure/u);
  await assertNoOperation(f.root);
  await assert.rejects(orcaStablePreparedStatus(new SwapOperationRepository(f.root), new SavedOrcaStableMaterialStore(f.root),
    f.ports, preparedSwapOperationId(f.request.profile, f.request.idempotencyKey), f.clock()),
  (error) => error instanceof ApnError && error.code === "APN_OPERATION_NOT_FOUND");
  const prepared = await prepareOrcaStableGuardedCandidateCore(f.rpc, f.ports, f.service, f.request,
    async () => [], f.clock, new SavedOrcaStableMaterialStore(f.root));
  assert.equal(prepared.operation.state, "awaiting_approval");
  assert.equal((await new SavedOrcaStableMaterialStore(f.root).load(prepared.operation.operationId, prepared.operation))?.preview.messageHash,
    prepared.unsignedTransaction.messageHash);
});

test("interrupted operation transition reopens from staged material without repeating RPC", async (t) => {
  const f = await fixture(); t.after(f.cleanup);
  class FailingTransitionRepository extends SwapOperationRepository {
    override async transition(): Promise<never> { throw new Error("injected transition interruption"); }
  }
  const interrupted = new GuardedSwapService(new FailingTransitionRepository(f.root), new AssetUsageLedger(f.root));
  await assert.rejects(prepareOrcaStableGuardedCandidateCore(f.rpc, f.ports, interrupted, f.request,
    async () => [], f.clock, new SavedOrcaStableMaterialStore(f.root)), /injected transition interruption/u);
  const operationId = preparedSwapOperationId(f.request.profile, f.request.idempotencyKey);
  assert.ok(await new SavedOrcaStableMaterialStore(f.root).loadStaged(operationId));
  const partial = await new SwapOperationRepository(f.root).loadAny(operationId);
  assert.equal(partial?.state, "quoted");
  const status = await orcaStablePreparedStatus(new SwapOperationRepository(f.root), new SavedOrcaStableMaterialStore(f.root),
    f.ports, operationId, f.clock());
  assert.equal(status.operation.state, "quoted");
  const calls = [...f.calls];
  const recovered = await prepareOrcaStableGuardedCandidateCore(f.rpc, f.ports, f.service, f.request,
    async () => [], f.clock, new SavedOrcaStableMaterialStore(f.root));
  assert.equal(recovered.operation.state, "awaiting_approval");
  assert.equal(recovered.operation.operationId, operationId);
  assert.deepEqual(f.calls, calls);
});
