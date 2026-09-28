import assert from "node:assert/strict";
import { Client, InMemoryTransport } from "@modelcontextprotocol/client";
import { createMcpServer } from "../../src/mcp-server.js";
import test from "node:test";
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { bindArgv } from "../../src/command-binder.js";
import { canonicalJson, domainHash, sha256 } from "../../src/canonical.js";
import { ApnCore } from "../../src/core.js";
import { createApnCore } from "../../src/runtime-factory.js";
import { StateStore } from "../../src/state.js";
import { createKeyPairSignerFromPrivateKeyBytes, getBase58Decoder, getBase58Encoder, getBase64EncodedWireTransaction, getCompiledTransactionMessageDecoder,
  getSignatureFromTransaction, getTransactionDecoder, signTransaction } from "@solana/kit";
import { parseJsonWithBigInts } from "@solana/rpc-spec-types";
import { SOLANA_GENESIS, SOLANA_USDT } from "../../src/chain-policy.js";
import { sealAssetPolicyRegistry, type UnsignedAssetPolicyRegistry } from "../../src/asset-policy-registry.js";
import { AssetUsageLedger } from "../../src/asset-usage-ledger.js";
import { ApnError } from "../../src/errors.js";
import { ChainAccountStore, sealChainAccount } from "../../src/chain-account-store.js";
import { SolanaRpc, SolanaRpcBudget, type SolanaMethod, type SolanaRpcPort } from "../../src/solana/rpc.js";
import { SolanaRpcPacer } from "../../src/solana/pacing.js";
import { GuardedSwapService, preparedSwapOperationId } from "../../src/swap/service.js";
import { SwapOperationRepository } from "../../src/swap/repository.js";
import { transitionSwapOperation } from "../../src/swap/transitions.js";
import { whirlpoolTickArrayAddress } from "../../src/swap/orca-solana/accounts.js";
import { prepareOrcaStableGuardedCandidateCore, simulateOrcaStableGuardedCore,
  simulateOrcaStableGuardedReadOnly } from "../../src/swap/orca-solana/stable-candidate.js";
import { ORCA_STABLE_GUARDED_MECHANISM_PIN } from "../../src/swap/orca-solana/stable-mechanism.js";
import { SavedOrcaStableMaterialStore } from "../../src/swap/orca-solana/stable-material.js";
import { approveOrcaStableReservation, stableApprovalScreen } from "../../src/swap/orca-solana/stable-approval.js";
import { releaseOrcaStableNoEffect } from "../../src/swap/orca-solana/stable-release.js";
import { orcaStablePreparedStatus } from "../../src/swap/orca-solana/stable-status.js";
import { verifyOrcaStableFinalizedReceipt } from "../../src/swap/orca-solana/stable-receipt.js";
import { beginOrcaStableExecution, beginOrcaStableExecutionAndSend, OrcaStableExecutionBindingStore } from "../../src/swap/orca-solana/stable-execution-journal.js";
import { OrcaStableLocalSigner, OrcaStableSingleSender } from "../../src/swap/orca-solana/stable-effect-runtime.js";
import { OrcaStableFinalizedObserver } from "../../src/swap/orca-solana/stable-observer.js";
import { OrcaStableFinalizedObservationStore } from "../../src/swap/orca-solana/stable-finalized-proof.js";
import { freshOrcaStableExecutionPreflightCore } from "../../src/swap/orca-solana/stable-fresh-preflight.js";
import { recoverOrcaStableNoSend } from "../../src/swap/orca-solana/stable-no-send-recovery.js";
import { OrcaStableNoSendProofStore } from "../../src/swap/orca-solana/stable-no-send-proof.js";
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
  let height = 400_000_000n, genesis = SOLANA_GENESIS, rpcRateLimitedAt: SolanaMethod | null = null;
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
  const rpc: SolanaRpcPort = { originHash: sha256("https://stable-source.example/rpc"), call: async (method, params) => {
    calls.push(method);
    if (method === rpcRateLimitedAt) throw new ApnError("APN_RPC_RATE_LIMITED", "terminal 429");
    if (method === "getGenesisHash") return genesis;
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
    removeAccount: (key: string) => { accounts.delete(key); },
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
    setHeight: (value: bigint) => { height = value; }, setGenesis: (value: string) => { genesis = value; },
    setUsage: (value: string) => { usage = value; },
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
  const expired = await orcaStablePreparedStatus(operations, store, f.ports, operationId,
    new Date(NOW.getTime() + 60_000));
  assert.equal(expired.operation.state, "failed_before_effect");
  const file = join(f.root, "orca-stable-material", `${operationId}.json`);
  const material = JSON.parse(await readFile(file, "utf8"));
  material.preview.unsignedPayload = "AA==";
  await writeFile(file, JSON.stringify(material));
  await assert.rejects(fresh());
});

test("stable foreground approval binds the exact screen and reserves principal without a send", async (t) => {
  const f = await fixture(false); t.after(f.cleanup);
  const prepared = await candidate(f);
  const bound = bindArgv(["swap", "solana", "orca", "stable-approve", "--operation", prepared.operation.operationId]).request;
  assert.deepEqual(bound, { command: "swap.orca.stable-approve", operationId: prepared.operation.operationId });
  const store = new SavedOrcaStableMaterialStore(f.root);
  const material = (await store.load(prepared.operation.operationId, prepared.operation))!;
  const lines = stableApprovalScreen(prepared.operation, material, prepared.operation.quote.expiresAt);
  for (const field of [prepared.operation.operationId, f.source.owner, prepared.quote.quoteHash,
    material.policyDigest, material.activationDigest, material.preview.maximumTotalFeeLamports,
    material.preview.ataRentLamports, prepared.quote.minimumOutputAtomic, material.preview.lastValidBlockHeight])
    assert.ok(lines.some((line) => line.includes(field)));
  let prompts = 0;
  const result = await approveOrcaStableReservation(f.service, store, f.ports, prepared.operation.operationId,
    { confirm: async (screen, code) => { prompts++; assert.ok(screen.some((line) => line.includes("reserves the USDC principal")));
      assert.match(code, /^[a-f0-9]{6}$/u); } }, f.clock);
  assert.equal(prompts, 1);
  assert.equal(result.operation.state, "reserved");
  assert.equal(result.operation.usageLease?.amountAtomic, f.source.quote.amountInAtomic);
  assert.equal(result.signable, false); assert.equal(result.executable, false);
  const core = new ApnCore({ state: new StateStore(f.root), clock: { now: f.clock },
    orcaStableApprove: operationId => approveOrcaStableReservation(f.service, store, f.ports, operationId,
      { confirm: async () => { throw new Error("already reserved"); } }, f.clock) });
  assert.equal((await core.execute(bound)).ok, false);
  assert.equal((await orcaStablePreparedStatus(f.service.operations, store, f.ports,
    prepared.operation.operationId, f.clock())).operation.state, "reserved");
  assert.ok(!f.calls.includes("sendTransaction"));
  await assert.rejects(approveOrcaStableReservation(f.service, store, f.ports, prepared.operation.operationId,
    { confirm: async () => { throw new Error("unexpected second prompt"); } }, f.clock),
  (error) => reason(error) === "orca_stable_already_approved");
});

test("saved stable reservation rebuilds and simulates fresh exact bytes without a signing or send route", async (t) => {
  const f = await fixture(); t.after(f.cleanup);
  const prepared = await candidate(f);
  const materials = new SavedOrcaStableMaterialStore(f.root);
  const reserved = (await approveOrcaStableReservation(f.service, materials, f.ports,
    prepared.operation.operationId, { confirm: async () => {} }, f.clock)).operation;
  const material = (await materials.load(reserved.operationId, reserved))!;
  assert.equal(material.maximumPriceImpactBps, f.request.maximumPriceImpactBps);
  f.calls.length = 0;
  const preflight = await freshOrcaStableExecutionPreflightCore(f.rpc, f.ports, f.service.usage,
    reserved, material, async () => [], f.clock);
  assert.equal(preflight.preview.minimumOutputAtomic, reserved.quote.minimumOutputAtomic);
  assert.equal(preflight.preview.owner, reserved.quote.account);
  assert.match(preflight.simulationHash, /^[a-f0-9]{64}$/u);
  assert.ok(f.calls.includes("getLatestBlockhash"));
  assert.ok(f.calls.includes("getFeeForMessage"));
  assert.ok(f.calls.includes("simulateTransaction"));
  assert.ok(!f.calls.includes("sendTransaction"));
});

test("saved stable fresh preflight refuses policy drift, expiry, fee cap and a terminal 429", async (t) => {
  const f = await fixture(); t.after(f.cleanup);
  const prepared = await candidate(f);
  const materials = new SavedOrcaStableMaterialStore(f.root);
  const reserved = (await approveOrcaStableReservation(f.service, materials, f.ports,
    prepared.operation.operationId, { confirm: async () => {} }, f.clock)).operation;
  const material = (await materials.load(reserved.operationId, reserved))!;
  const run = (clock = f.clock) => freshOrcaStableExecutionPreflightCore(f.rpc, f.ports, f.service.usage,
    reserved, material, async () => [], clock);
  f.setRevision(8);
  await assert.rejects(run(), (error) => reason(error) === "orca_stable_policy_drift");
  f.setRevision(7);
  await assert.rejects(run(() => new Date(Date.parse(reserved.quote.expiresAt))),
    (error) => reason(error) === "orca_stable_deadline");
  f.setFee(3_000_001n);
  await assert.rejects(run(), (error) => reason(error) === "orca_stable_fee_cap");
  f.setFee(5_000n);
  f.rateLimitAt("getLatestBlockhash");
  const before = f.calls.length;
  await assert.rejects(run(), (error) => error instanceof ApnError && error.code === "APN_RPC_RATE_LIMITED");
  assert.equal(f.calls.slice(before).filter((call) => call === "getLatestBlockhash").length, 1);
});

test("stable source binding seals the observed origin and mainnet genesis and rejects unbound execution", async (t) => {
  const f = await fixture(); t.after(f.cleanup);
  const prepared = await candidate(f), materials = new SavedOrcaStableMaterialStore(f.root);
  const reserved = (await approveOrcaStableReservation(f.service, materials, f.ports,
    prepared.operation.operationId, { confirm: async () => {} }, f.clock)).operation;
  const material = (await materials.load(reserved.operationId, reserved))!;
  assert.deepEqual(material.sourceBinding, { schemaVersion: "apn.orca-stable-rpc-source.v1",
    rpcOriginHash: f.rpc.originHash, genesisHash: SOLANA_GENESIS });
  assert.deepEqual((material.evidence as any).sourceBinding, material.sourceBinding);
  f.calls.length = 0;
  await assert.rejects(freshOrcaStableExecutionPreflightCore({ ...f.rpc, originHash: sha256("https://other.example/rpc") },
    f.ports, f.service.usage, reserved, material, async () => [], f.clock),
  (error) => reason(error) === "orca_stable_rpc_source");
  assert.equal(f.calls.length, 0);
  await assert.rejects(freshOrcaStableExecutionPreflightCore(f.rpc, f.ports, f.service.usage,
    reserved, { ...material, schemaVersion: "apn.orca-stable-guarded-material.v1" } as any,
    async () => [], f.clock), { code: "APN_REPREPARE_REQUIRED" });
  assert.equal(f.calls.length, 0);
  f.setGenesis("not-mainnet");
  await assert.rejects(freshOrcaStableExecutionPreflightCore(f.rpc, f.ports, f.service.usage,
    reserved, material, async () => [], f.clock), { code: "APN_CHAIN_MISMATCH" });
  assert.deepEqual(f.calls, ["getGenesisHash"]);
  assert.equal((await f.service.operations.loadAny(reserved.operationId))?.state, "reserved");
  assert.equal((await f.service.usage.load({ account: reserved.quote.account, chain: ORCA_SOLANA_CHAIN,
    asset: { kind: "token", identifier: USDC_MINT } }, reserved.usageLease!.reservationId))?.state, "reserved");
  assert.ok(!f.calls.includes("sendTransaction"));
});

test("saved stable fresh preflight refuses changed pinned pool and destination ATA", async (t) => {
  for (const mutate of ["pool", "destination"] as const) {
    const f = await fixture(); t.after(f.cleanup);
    const prepared = await candidate(f);
    const materials = new SavedOrcaStableMaterialStore(f.root);
    const reserved = (await approveOrcaStableReservation(f.service, materials, f.ports,
      prepared.operation.operationId, { confirm: async () => {} }, f.clock)).operation;
    const material = (await materials.load(reserved.operationId, reserved))!;
    if (mutate === "pool") f.removeAccount(ORCA_STABLE_POOL);
    else f.setMalformedDestination();
    await assert.rejects(freshOrcaStableExecutionPreflightCore(f.rpc, f.ports, f.service.usage,
      reserved, material, async () => [], f.clock));
    assert.equal((await f.service.operations.loadAny(reserved.operationId))?.state, "reserved");
    assert.ok(!f.calls.includes("sendTransaction"));
  }
});

test("fresh preflight measures all final owner checks against its full clock and quote deadline", async (t) => {
  for (const delayMs of [1_000, 30_001, 60_000]) {
    const f = await fixture(); t.after(f.cleanup);
    const prepared = await candidate(f);
    const materials = new SavedOrcaStableMaterialStore(f.root);
    const reserved = (await approveOrcaStableReservation(f.service, materials, f.ports,
      prepared.operation.operationId, { confirm: async () => {} }, f.clock)).operation;
    const material = (await materials.load(reserved.operationId, reserved))!;
    let heightReads = 0, time = NOW;
    const rpc: SolanaRpcPort = { originHash: f.rpc.originHash, call: async (method, params) => {
      const result = await f.rpc.call(method, params);
      if (method === "getBlockHeight") heightReads++;
      return result;
    } };
    const ports = { ...f.ports, activePolicy: async () => {
      const active = await f.ports.activePolicy();
      // The second height read is the proof's final RPC. Delay an owner read after it.
      if (heightReads >= 2) time = new Date(NOW.getTime() + delayMs);
      return active;
    } };
    const run = () => freshOrcaStableExecutionPreflightCore(rpc, ports, f.service.usage,
      reserved, material, async () => [], () => time);
    if (delayMs === 1_000) {
      const result = await run();
      assert.equal(result.elapsedMs, delayMs);
      assert.equal(result.checkedAt, time.toISOString());
    } else {
      await assert.rejects(run(), (error) => reason(error) === "orca_stable_freshness");
      assert.equal((await f.service.operations.loadAny(reserved.operationId))?.state, "reserved");
    }
  }
});

test("stable approval rechecks replacement and expiry after consent before reserving", async (t) => {
  const f = await fixture(); t.after(f.cleanup);
  const prepared = await candidate(f), store = new SavedOrcaStableMaterialStore(f.root);
  await assert.rejects(approveOrcaStableReservation(f.service, store, f.ports, prepared.operation.operationId,
    { confirm: async () => { f.setActivation("b".repeat(64)); } }, f.clock),
  (error) => reason(error) === "orca_stable_policy_drift");
  assert.equal((await f.service.operations.loadAny(prepared.operation.operationId))?.state, "awaiting_approval");
  f.setActivation("a".repeat(64));
  await assert.rejects(approveOrcaStableReservation(f.service, store, f.ports, prepared.operation.operationId,
    { confirm: async () => { f.setRevision(8); } }, f.clock),
  (error) => reason(error) === "orca_stable_policy_drift");
  f.setRevision(7);
  await assert.rejects(approveOrcaStableReservation(f.service, store, f.ports, prepared.operation.operationId,
    { confirm: async () => {} }, () => new Date(NOW.getTime() + 60_000)),
  (error) => error instanceof ApnError && error.code === "APN_REPREPARE_REQUIRED");
  assert.equal((await f.service.operations.loadAny(prepared.operation.operationId))?.usageLease, null);
});

test("stable reserve retry after interrupted operation write reuses the principal lease", async (t) => {
  const f = await fixture(); t.after(f.cleanup);
  const prepared = await candidate(f), store = new SavedOrcaStableMaterialStore(f.root);
  const original = f.service.operations.transition.bind(f.service.operations);
  let interrupted = false;
  f.service.operations.transition = (async (...args: Parameters<typeof original>) => {
    if (!interrupted && args[3] === "reserved") { interrupted = true; throw new Error("interrupted after lease"); }
    return await original(...args);
  }) as typeof original;
  const consent = { confirm: async () => {} };
  await assert.rejects(approveOrcaStableReservation(f.service, store, f.ports, prepared.operation.operationId,
    consent, f.clock), /interrupted after lease/u);
  assert.equal((await f.service.operations.loadAny(prepared.operation.operationId))?.state, "awaiting_approval");
  const recovered = await approveOrcaStableReservation(f.service, store, f.ports, prepared.operation.operationId,
    consent, f.clock);
  assert.equal(recovered.operation.state, "reserved");
  const usage = await f.service.usage.usage({ account: f.source.owner, chain: ORCA_SOLANA_CHAIN,
    asset: { kind: "token", identifier: USDC_MINT } }, NOW);
  assert.equal(usage.amountAtomic, f.source.quote.amountInAtomic);
});

test("stable no-effect release reconciles an orphan lease and is idempotent", async (t) => {
  const f = await fixture(); t.after(f.cleanup);
  const prepared = await candidate(f), store = new SavedOrcaStableMaterialStore(f.root);
  const original = f.service.operations.transition.bind(f.service.operations);
  f.service.operations.transition = (async (...args: Parameters<typeof original>) => {
    if (args[3] === "reserved") throw new Error("crash after lease write");
    return await original(...args);
  }) as typeof original;
  await assert.rejects(approveOrcaStableReservation(f.service, store, f.ports, prepared.operation.operationId,
    { confirm: async () => {} }, f.clock), /crash after lease write/u);
  const releaseRequest = bindArgv(["swap", "solana", "orca", "stable-release", "--operation", prepared.operation.operationId]).request;
  assert.deepEqual(releaseRequest, { command: "swap.orca.stable-release", operationId: prepared.operation.operationId });
  const released = await releaseOrcaStableNoEffect(f.service, store, prepared.operation.operationId, f.clock());
  assert.equal(released.operation.state, "failed_before_effect");
  assert.equal(released.operation.usageLease?.state, "failed_before_effect");
  assert.equal((await f.service.usage.usage({ account: f.source.owner, chain: ORCA_SOLANA_CHAIN,
    asset: { kind: "token", identifier: USDC_MINT } }, NOW)).amountAtomic, "0");
  assert.deepEqual(await releaseOrcaStableNoEffect(f.service, store, prepared.operation.operationId, f.clock()), released);
  assert.equal((await orcaStablePreparedStatus(f.service.operations, store, f.ports,
    prepared.operation.operationId, f.clock())).operation.state, "failed_before_effect");
});

test("expired stable status releases a reserved lease and repeated reads remain terminal", async (t) => {
  const f = await fixture(); t.after(f.cleanup);
  const prepared = await candidate(f), store = new SavedOrcaStableMaterialStore(f.root);
  await approveOrcaStableReservation(f.service, store, f.ports, prepared.operation.operationId,
    { confirm: async () => {} }, f.clock);
  const expiredAt = new Date(NOW.getTime() + 60_000);
  const status = await orcaStablePreparedStatus(f.service.operations, store, f.ports,
    prepared.operation.operationId, expiredAt);
  assert.equal(status.operation.state, "failed_before_effect");
  assert.equal(status.operation.usageLease?.state, "failed_before_effect");
  assert.equal((await orcaStablePreparedStatus(f.service.operations, store, f.ports,
    prepared.operation.operationId, expiredAt)).operation.integrityHash, status.operation.integrityHash);
  assert.equal((await f.service.usage.usage({ account: f.source.owner, chain: ORCA_SOLANA_CHAIN,
    asset: { kind: "token", identifier: USDC_MINT } }, expiredAt)).amountAtomic, "0");
});

test("stable approval samples the clock again after awaited policy reads", async (t) => {
  const f = await fixture(); t.after(f.cleanup);
  const prepared = await candidate(f), store = new SavedOrcaStableMaterialStore(f.root);
  let policyCalls = 0, now = NOW;
  const ports = { ...f.ports, activePolicy: async () => {
    const active = await f.ports.activePolicy();
    if (++policyCalls === 4) now = new Date(NOW.getTime() + 60_000);
    return active;
  } };
  await assert.rejects(approveOrcaStableReservation(f.service, store, ports, prepared.operation.operationId,
    { confirm: async () => {} }, () => now), (error) => reason(error) === "orca_stable_approval_expired");
  assert.equal((await f.service.operations.loadAny(prepared.operation.operationId))?.usageLease, null);
});

test("stable release refuses an operation with a possible-effect marker", async (t) => {
  const f = await fixture(); t.after(f.cleanup);
  const prepared = await candidate(f), store = new SavedOrcaStableMaterialStore(f.root);
  const approved = await approveOrcaStableReservation(f.service, store, f.ports, prepared.operation.operationId,
    { confirm: async () => {} }, f.clock);
  await assert.rejects(f.service.markSubmitting(approved.operation, f.clock()), { code: "APN_OPERATION_BLOCKED" });
  // Model a future effect marker through the low-level repository to prove release and status remain observation-only.
  const markerBody = { operationId: approved.operation.operationId,
    operationIntegrityHash: approved.operation.integrityHash,
    unsignedTransactionPayloadHash: approved.operation.quote.unsignedTransactionPayloadHash, markedAt: NOW.toISOString() };
  const { operationId: _operationId, ...markerFields } = markerBody;
  const marked = await f.service.operations.transition(approved.operation.ownerProfileHash, approved.operation.operationId,
    approved.operation.integrityHash, "submitting", { submissionMarker: { ...markerFields,
      markerHash: domainHash("apn.swap-submission-marker.v1", canonicalJson(markerBody)) } }, NOW);
  await assert.rejects(releaseOrcaStableNoEffect(f.service, store, prepared.operation.operationId, f.clock()),
    (error) => reason(error) === "orca_stable_effect_boundary");
  assert.equal((await f.service.usage.usage({ account: f.source.owner, chain: ORCA_SOLANA_CHAIN,
    asset: { kind: "token", identifier: USDC_MINT } }, NOW)).amountAtomic, f.source.quote.amountInAtomic);
  const observed = await orcaStablePreparedStatus(f.service.operations, store, f.ports,
    prepared.operation.operationId, new Date(NOW.getTime() + 60_000));
  assert.equal(observed.operation.integrityHash, marked.integrityHash);
});

test("internal stable journal persists marker, binding and sealed signed bytes once", async (t) => {
  const f = await fixture(); t.after(f.cleanup);
  const prepared = await candidate(f), materials = new SavedOrcaStableMaterialStore(f.root);
  await approveOrcaStableReservation(f.service, materials, f.ports, prepared.operation.operationId,
    { confirm: async () => {} }, f.clock);
  const bindings = new OrcaStableExecutionBindingStore(f.root);
  const signed = new Map<string, unknown>();
  let preflights = 0, signs = 0;
  const ports = { admission: f.ports, preflight: async () => {
    preflights++;
    const material = (await materials.loadStaged(prepared.operation.operationId))!;
    return { preview: material.preview, checkedAt: NOW.toISOString(), elapsedMs: 14_000,
      physicalPostCount: 18, simulationHash: "d".repeat(64) };
  }, sign: async (operation: any, binding: any) => {
    signs++;
    const signer = await createKeyPairSignerFromPrivateKeyBytes(Buffer.alloc(32, 23));
    const unsigned = getTransactionDecoder().decode(Buffer.from(binding.preview.unsignedPayload, "base64"));
    const transaction = await signTransaction([signer.keyPair], unsigned);
    const rawPayload = getBase64EncodedWireTransaction(transaction);
    return { operationId: operation.operationId, fingerprint: binding.bindingHash,
      transactionId: getSignatureFromTransaction(transaction), rawPayload, rawPayloadHash: sha256(rawPayload) };
  }, effects: { saveEffect: async (_account: unknown, effect: any) => { signed.set(effect.operationId, effect); return effect; },
    effect: async () => null } } as any;
  const first = await beginOrcaStableExecution(f.service, materials, bindings, ports,
    prepared.operation.operationId, f.clock);
  assert.equal(first.operation.state, "submitting");
  assert.equal(first.binding?.preview.messageHash, (await materials.loadStaged(prepared.operation.operationId))!.preview.messageHash);
  assert.equal(first.signature, (signed.get(prepared.operation.operationId) as any).transactionId);
  assert.equal(preflights, 1); assert.equal(signs, 1);
  assert.equal((await new OrcaStableExecutionBindingStore(f.root).load(first.operation,
    (await materials.loadStaged(prepared.operation.operationId))!))?.bindingHash, first.binding?.bindingHash);
  await assert.rejects(beginOrcaStableExecution(f.service, materials, bindings, ports,
    prepared.operation.operationId, f.clock), (error) => reason(error) === "orca_stable_observe_only");
  assert.equal(preflights, 1); assert.equal(signs, 1);
  await assert.rejects(releaseOrcaStableNoEffect(f.service, materials, prepared.operation.operationId, f.clock()),
    (error) => reason(error) === "orca_stable_effect_boundary");
  assert.ok(!f.calls.includes("sendTransaction"));
});

test("private stable first attempt consumes 23 preflight POSTs and one persisted-effect send", async (t) => {
  const f = await fixture(); t.after(f.cleanup);
  const prepared = await candidate(f), materials = new SavedOrcaStableMaterialStore(f.root);
  await approveOrcaStableReservation(f.service, materials, f.ports, prepared.operation.operationId,
    { confirm: async () => {} }, f.clock);
  const state = new StateStore(f.root);
  await state.initialize();
  let time = NOW.getTime(), signedEffect: any = null;
  const starts: number[] = [], methods: string[] = [];
  const fetcher: typeof fetch = async (_url, init) => {
    const request = JSON.parse(init!.body as string);
    starts.push(time); methods.push(request.method);
    const result = request.method === "sendTransaction" ? signedEffect?.transactionId : SOLANA_GENESIS;
    return new Response(JSON.stringify({ jsonrpc: "2.0", id: request.id, result }),
      { status: 200, headers: { "content-type": "application/json" } });
  };
  const endpoint = "https://stable-source.example/rpc";
  const budget = new SolanaRpcBudget({ maxPhysicalRequests: 24, minimumIntervalMs: 750,
    now: () => time, wait: async ms => { time += ms; } });
  const rpc = new SolanaRpc(endpoint, fetcher, budget,
    new SolanaRpcPacer(state, () => time, async ms => { time += ms; }));
  const custody = {
    account: async () => await f.ports.localAccount(),
    withSeed: async (_account: unknown, action: (seed: Buffer) => Promise<unknown>) => await action(Buffer.alloc(32, 23)),
    effect: async () => null,
    effectByOperationId: async () => signedEffect,
    saveEffect: async (_account: unknown, effect: unknown) => { signedEffect = effect; },
  } as any;
  const bindings = new OrcaStableExecutionBindingStore(f.root);
  const signer = new OrcaStableLocalSigner(custody);
  const sender = new OrcaStableSingleSender(f.service, materials, bindings, custody, rpc, f.clock);
  let signs = 0;
  const ports = { admission: f.ports, preflight: async () => {
    for (let index = 0; index < 23; index++) assert.equal(await rpc.call("getGenesisHash", []), SOLANA_GENESIS);
    return { preview: (await materials.loadStaged(prepared.operation.operationId))!.preview,
      checkedAt: NOW.toISOString(), elapsedMs: 17_000, physicalPostCount: budget.physicalRequests,
      simulationHash: "d".repeat(64) };
  }, sign: async (operation: any, binding: any, account: any) => {
    signs++; return await signer.sign(operation, binding, account);
  }, effects: custody, send: async (operationId: string) => await sender.sendOnce(operationId) };
  const result = await beginOrcaStableExecutionAndSend(f.service, materials, bindings,
    ports, prepared.operation.operationId, f.clock);
  assert.equal(result.operation.state, "submitted");
  assert.equal(result.signature, signedEffect.transactionId);
  assert.equal(signs, 1);
  assert.equal(budget.physicalRequests, 24);
  assert.equal(starts.length, 24);
  assert.equal(methods.filter(method => method === "sendTransaction").length, 1);
  assert.ok(starts.every((start, index) => index === 0 || start - starts[index - 1]! >= 750));
  await assert.rejects(beginOrcaStableExecutionAndSend(f.service, materials, new OrcaStableExecutionBindingStore(f.root),
    ports, prepared.operation.operationId, f.clock), (error) => reason(error) === "orca_stable_observe_only");
  assert.equal(signs, 1); assert.equal(starts.length, 24);
  await assert.rejects(sender.sendOnce(prepared.operation.operationId),
    (error) => reason(error) === "orca_stable_effect_boundary");
  assert.equal(starts.length, 24);
  const nextBudget = new SolanaRpcBudget({ maxPhysicalRequests: 24, minimumIntervalMs: 750,
    now: () => time, wait: async ms => { time += ms; } });
  const nextRpc = new SolanaRpc(endpoint, fetcher, nextBudget,
    new SolanaRpcPacer(new StateStore(f.root), () => time, async ms => { time += ms; }));
  await nextRpc.call("getGenesisHash", []);
  assert.equal(starts[24]! - starts[23]!, 750);
});

test("stable physical transport makes one 429 attempt and persists provider cooldown", async (t) => {
  const temporary = await temporaryState(); t.after(temporary.cleanup);
  const state = new StateStore(temporary.root); await state.initialize();
  let time = NOW.getTime(), posts = 0;
  const fetcher: typeof fetch = async () => {
    posts++;
    return new Response("", { status: 429, headers: { "retry-after": "3" } });
  };
  const endpoint = "https://stable-429.example/rpc";
  const rpc = new SolanaRpc(endpoint, fetcher, new SolanaRpcBudget({ maxPhysicalRequests: 24,
    minimumIntervalMs: 750, now: () => time, wait: async ms => { time += ms; } }),
  new SolanaRpcPacer(state, () => time, async ms => { time += ms; }));
  await assert.rejects(rpc.call("getGenesisHash", []), { code: "APN_RPC_RATE_LIMITED" });
  assert.equal(posts, 1);
  const next = new SolanaRpc(endpoint, fetcher, new SolanaRpcBudget({ maxPhysicalRequests: 24,
    minimumIntervalMs: 750, now: () => time, wait: async ms => { time += ms; } }),
  new SolanaRpcPacer(new StateStore(temporary.root), () => time, async ms => { time += ms; }));
  await assert.rejects(next.call("getGenesisHash", []), { code: "APN_PROVIDER_UNAVAILABLE" });
  assert.equal(posts, 1);
});

async function privateStableSenderHarness(nearExpiry: boolean) {
  const f = await fixture();
  const prepared = await candidate(f), materials = new SavedOrcaStableMaterialStore(f.root);
  await approveOrcaStableReservation(f.service, materials, f.ports, prepared.operation.operationId,
    { confirm: async () => {} }, f.clock);
  const state = new StateStore(f.root); await state.initialize();
  let time = NOW.getTime(), effect: any = null;
  const physical: Array<{ method: string; start: number }> = [];
  const fetcher: typeof fetch = async (_url, init) => {
    const request = JSON.parse(init!.body as string);
    physical.push({ method: request.method, start: time });
    return new Response(JSON.stringify({ jsonrpc: "2.0", id: request.id,
      result: request.method === "sendTransaction" ? effect.transactionId : SOLANA_GENESIS }),
    { status: 200, headers: { "content-type": "application/json" } });
  };
  const clock = () => new Date(time);
  const budget = new SolanaRpcBudget({ maxPhysicalRequests: 24, minimumIntervalMs: 750,
    now: () => time, wait: async ms => { time += ms; } });
  const rpc = new SolanaRpc("https://stable-source.example/rpc", fetcher, budget,
    new SolanaRpcPacer(state, () => time, async ms => { time += ms; }));
  const stableAccount = sealChainAccount({ schemaVersion: "apn.chain-account.v1", profile: "stable-candidate",
    profileHash: sha256("profile\0stable-candidate"), rail: "solana", network: "mainnet",
    provider: "local", custody: "local_software", address: f.source.owner, createdAt: NOW.toISOString() });
  const custody = { account: async () => stableAccount,
    withSeed: async (_account: unknown, action: (seed: Buffer) => Promise<unknown>) => await action(Buffer.alloc(32, 23)),
    effect: async () => null, effectByOperationId: async () => effect,
    saveEffect: async (_account: unknown, saved: unknown) => { effect = saved; } } as any;
  const bindings = new OrcaStableExecutionBindingStore(f.root), signer = new OrcaStableLocalSigner(custody);
  const sender = new OrcaStableSingleSender(f.service, materials, bindings, custody, rpc, clock);
  const competitorService = new GuardedSwapService(new SwapOperationRepository(f.root), new AssetUsageLedger(f.root));
  const competitor = new OrcaStableSingleSender(competitorService, new SavedOrcaStableMaterialStore(f.root),
    new OrcaStableExecutionBindingStore(f.root), custody, rpc, clock);
  const begun = await beginOrcaStableExecution(f.service, materials, bindings, { admission: f.ports,
    preflight: async () => {
      for (let index = 0; index < 23; index++) {
        if (nearExpiry && index === 22) time = Date.parse(prepared.operation.quote.expiresAt) - 100;
        await rpc.call("getGenesisHash", []);
      }
      return { preview: (await materials.loadStaged(prepared.operation.operationId))!.preview,
        checkedAt: clock().toISOString(), elapsedMs: 17_000, physicalPostCount: budget.physicalRequests,
        simulationHash: "d".repeat(64) };
    }, sign: (operation, binding, account) => signer.sign(operation, binding, account), effects: custody },
  prepared.operation.operationId, clock);
  assert.equal(begun.operation.state, "submitting");
  return { f, sender, competitor, competitorService, materials, bindings, custody, physical,
    operationId: prepared.operation.operationId, staleOperation: begun.operation,
    dropEffect: () => { effect = null; } };
}

test("stable direct sender persists one claim across concurrent callers and transition crash", async (t) => {
  const h = await privateStableSenderHarness(false); t.after(h.f.cleanup);
  (h.f.service as any).recordPossibleSend = async () => { throw new Error("crash after transport"); };
  (h.competitorService as any).recordPossibleSend = async () => { throw new Error("crash after transport"); };
  const results = await Promise.allSettled([h.sender.sendOnce(h.operationId), h.competitor.sendOnce(h.operationId)]);
  assert.equal(results.filter(result => result.status === "rejected").length, 2);
  assert.equal(h.physical.filter(row => row.method === "sendTransaction").length, 1);
  assert.equal((await h.f.service.operations.loadAny(h.operationId))?.state, "submitting");
  await assert.rejects(h.sender.sendOnce(h.operationId), (error) => reason(error) === "orca_stable_effect_boundary");
  await assert.rejects((h.competitor.sendOnce as any)(h.operationId, h.staleOperation),
    (error) => reason(error) === "orca_stable_effect_boundary");
  assert.equal(h.physical.filter(row => row.method === "sendTransaction").length, 1);
  h.dropEffect();
  await assert.rejects(recoverOrcaStableNoSend(h.f.service, h.materials, h.bindings,
    new OrcaStableNoSendProofStore(h.f.root), h.custody, async () => await h.f.ports.localAccount(),
    h.operationId, new Date(NOW.getTime() + 60_000)),
  (error) => reason(error) === "orca_stable_send_claim_exists");
  const lease = await h.f.service.usage.load({ account: h.staleOperation.quote.account, chain: ORCA_SOLANA_CHAIN,
    asset: { kind: "token", identifier: USDC_MINT } }, h.staleOperation.usageLease!.reservationId);
  assert.equal(lease?.state, "reserved");
});

test("stable claim before delayed transport stays observe-only after quote expires", async (t) => {
  const h = await privateStableSenderHarness(true); t.after(h.f.cleanup);
  const result = await h.sender.sendOnce(h.operationId);
  assert.equal(result.state, "unknown_finality");
  assert.equal(h.physical.filter(row => row.method === "sendTransaction").length, 0);
  await assert.rejects(h.sender.sendOnce(h.operationId), (error) => reason(error) === "orca_stable_effect_boundary");
  assert.equal(h.physical.filter(row => row.method === "sendTransaction").length, 0);
});

for (const [label, contents] of [["canonical null", "null\n"], ["invalid object", "{}\n"]] as const) {
  test(`occupied ${label} stable send claim blocks recovery and direct send`, async (t) => {
    const h = await privateStableSenderHarness(false); t.after(h.f.cleanup);
    const claimDirectory = join(h.f.root, "orca-stable-send-claims", h.staleOperation.ownerProfileHash);
    await mkdir(claimDirectory, { recursive: true, mode: 0o700 });
    await writeFile(join(claimDirectory, `${h.operationId}.json`), contents, { mode: 0o600 });
    h.dropEffect();
    await assert.rejects(recoverOrcaStableNoSend(h.f.service, h.materials, h.bindings,
      new OrcaStableNoSendProofStore(h.f.root), h.custody, async () => await h.f.ports.localAccount(),
      h.operationId, new Date(NOW.getTime() + 60_000)), { code: "APN_STATE_CORRUPT" });
    await assert.rejects(h.sender.sendOnce(h.operationId), { code: "APN_STATE_CORRUPT" });
    assert.equal(h.physical.filter(row => row.method === "sendTransaction").length, 0);
    const lease = await h.f.service.usage.load({ account: h.staleOperation.quote.account, chain: ORCA_SOLANA_CHAIN,
      asset: { kind: "token", identifier: USDC_MINT } }, h.staleOperation.usageLease!.reservationId);
    assert.equal(lease?.state, "reserved");
  });
}

test("stable journal marker-before-sign crash never signs on resume; policy drift refuses before marker", async (t) => {
  const f = await fixture(); t.after(f.cleanup);
  const prepared = await candidate(f), materials = new SavedOrcaStableMaterialStore(f.root);
  await approveOrcaStableReservation(f.service, materials, f.ports, prepared.operation.operationId,
    { confirm: async () => {} }, f.clock);
  const bindings = new OrcaStableExecutionBindingStore(f.root);
  let signs = 0;
  const ports = { admission: f.ports, preflight: async () => ({
    preview: (await materials.loadStaged(prepared.operation.operationId))!.preview,
    checkedAt: NOW.toISOString(), elapsedMs: 700, physicalPostCount: 23, simulationHash: "d".repeat(64) }),
    sign: async () => { signs++; throw new Error("simulated crash before signed-effect persistence"); },
    effects: { saveEffect: async () => { throw new Error("must not save"); }, effect: async () => null } } as any;
  f.setActivation("b".repeat(64));
  await assert.rejects(beginOrcaStableExecution(f.service, materials, bindings, ports,
    prepared.operation.operationId, f.clock), (error) => reason(error) === "orca_stable_policy_drift");
  assert.equal((await f.service.operations.loadAny(prepared.operation.operationId))?.submissionMarker, null);
  f.setActivation("a".repeat(64));
  const first = await beginOrcaStableExecution(f.service, materials, bindings, ports,
    prepared.operation.operationId, f.clock);
  assert.equal(first.operation.state, "submitting"); assert.equal(first.signature, null); assert.equal(signs, 1);
  f.setActivation("b".repeat(64));
  await assert.rejects(beginOrcaStableExecution(f.service, materials, bindings, ports,
    prepared.operation.operationId, f.clock), (error) => reason(error) === "orca_stable_observe_only");
  assert.equal(signs, 1);
  assert.equal((await orcaStablePreparedStatus(f.service.operations, materials, f.ports,
    prepared.operation.operationId, new Date(NOW.getTime() + 60_000))).operation.state, "submitting");
  assert.ok(!f.calls.includes("sendTransaction"));
});

async function markedNoSendFixture() {
  const f = await fixture();
  const prepared = await candidate(f);
  const materials = new SavedOrcaStableMaterialStore(f.root);
  const reserved = (await approveOrcaStableReservation(f.service, materials, f.ports,
    prepared.operation.operationId, { confirm: async () => {} }, f.clock)).operation;
  const markerBody = { operationId: reserved.operationId, operationIntegrityHash: reserved.integrityHash,
    unsignedTransactionPayloadHash: reserved.quote.unsignedTransactionPayloadHash, markedAt: NOW.toISOString() };
  const marked = await f.service.operations.transition(reserved.ownerProfileHash, reserved.operationId,
    reserved.integrityHash, "submitting", { submissionMarker: { markerHash: domainHash("apn.swap-submission-marker.v1",
      canonicalJson(markerBody)), markedAt: markerBody.markedAt,
      operationIntegrityHash: markerBody.operationIntegrityHash,
      unsignedTransactionPayloadHash: markerBody.unsignedTransactionPayloadHash } }, NOW);
  const account = sealChainAccount({ schemaVersion: "apn.chain-account.v1", profile: marked.quote.profile,
    profileHash: sha256(`profile\0${marked.quote.profile}`), rail: "solana", network: "mainnet",
    provider: "local", custody: "local_software", address: marked.quote.account, createdAt: NOW.toISOString() });
  const bindings = new OrcaStableExecutionBindingStore(f.root);
  const proofs = new OrcaStableNoSendProofStore(f.root);
  const custody = { effectByOperationId: async () => null } as any;
  const recover = async (now: Date = NOW) => await recoverOrcaStableNoSend(f.service, materials, bindings, proofs,
    custody, async () => account, marked.operationId, now);
  return { f, marked, materials, bindings, proofs, custody, account, recover };
}

test("marked stable recovery proves operation-ID custody absence without a binding, releases exact lease and replays", async (t) => {
  const s = await markedNoSendFixture(); t.after(s.f.cleanup);
  let reads = 0;
  s.custody.effectByOperationId = async (_account: unknown, id: string) => {
    assert.equal(id, s.marked.operationId); reads++; return null;
  };
  const terminal = await s.recover();
  assert.equal(terminal.state, "failed_before_effect");
  assert.equal(terminal.submissionMarker?.markerHash, s.marked.submissionMarker?.markerHash);
  assert.equal(terminal.failureProofHash, terminal.usageLease?.outcomeDigest);
  assert.equal((await s.proofs.load(terminal))?.bindingHash, null);
  assert.equal((await s.recover()).integrityHash, terminal.integrityHash);
  assert.equal(reads, 2);
  assert.ok(!s.f.calls.includes("sendTransaction"));
});

test("marked stable recovery handles a persisted binding after signing failed before custody save", async (t) => {
  const s = await markedNoSendFixture(); t.after(s.f.cleanup);
  const material = (await s.materials.loadStaged(s.marked.operationId))!;
  const binding = await s.bindings.save(s.marked, material, { preview: material.preview,
    checkedAt: NOW.toISOString(), elapsedMs: 700, physicalPostCount: 24, simulationHash: "d".repeat(64) });
  const terminal = await s.recover();
  assert.equal(terminal.state, "failed_before_effect");
  assert.equal((await s.proofs.load(terminal))?.bindingHash, binding.bindingHash);
});

test("marked stable recovery fails closed for durable effects, custody read errors and progressed leases", async (t) => {
  const s = await markedNoSendFixture(); t.after(s.f.cleanup);
  s.custody.effectByOperationId = async () => ({ operationId: s.marked.operationId });
  await assert.rejects(s.recover(), (error) => reason(error) === "orca_stable_signed_effect_exists");
  s.custody.effectByOperationId = async () => { throw new Error("custody unreadable"); };
  await assert.rejects(s.recover(), /custody unreadable/);
  assert.equal(await s.proofs.load(s.marked), null);
  assert.equal((await s.f.service.operations.loadAny(s.marked.operationId))?.state, "submitting");
  s.custody.effectByOperationId = async () => null;
  await s.f.service.usage.transition({ account: s.marked.quote.account, chain: ORCA_SOLANA_CHAIN,
    asset: { kind: "token", identifier: USDC_MINT }, reservationId: s.marked.usageLease!.reservationId,
    policyDigest: s.marked.policyDigest, state: "unknown_finality", now: NOW });
  await assert.rejects(s.recover(), { code: "APN_STATE_CORRUPT" });
  assert.equal(await s.proofs.load(s.marked), null);
});

test("marked stable recovery refuses a saved receipt before opening custody", async (t) => {
  const s = await markedNoSendFixture(); t.after(s.f.cleanup);
  const submitted = await s.f.service.recordPossibleSend(s.marked, "submitted", NOW, {
    receiptHash: "a".repeat(64), transactionHash: "2".repeat(88), observedAt: NOW.toISOString(), finalized: false });
  assert.equal(submitted.receiptProof?.transactionHash, "2".repeat(88));
  s.custody.effectByOperationId = async () => { throw new Error("custody must not open"); };
  await assert.rejects(s.recover(), (error) => reason(error) === "orca_stable_effect_boundary");
});

test("wallet effect writes serialize across operations and binding-absent recovery sees the durable effect", async (t) => {
  const s = await markedNoSendFixture(); t.after(s.f.cleanup);
  let loads = 0, pauseNext = false, release!: () => void, entered!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  const inside = new Promise<void>((resolve) => { entered = resolve; });
  const wrapping = { create: async () => Buffer.alloc(32, 37), load: async () => {
    loads++;
    if (pauseNext) { pauseNext = false; entered(); await gate; }
    return Buffer.alloc(32, 37);
  } };
  const firstStore = new ChainAccountStore(s.f.root, wrapping), secondStore = new ChainAccountStore(s.f.root, wrapping);
  const account = await firstStore.ensureLocal({ profile: s.marked.quote.profile, rail: "solana",
    create: async () => ({ address: s.marked.quote.account, seed: Buffer.alloc(32, 23) }) });
  const stableEffect = { operationId: s.marked.operationId, fingerprint: "a".repeat(64),
    transactionId: "2".repeat(88), rawPayload: "stable signed bytes", rawPayloadHash: sha256("stable signed bytes") };
  const otherEffect = { ...stableEffect, operationId: "b".repeat(64), rawPayload: "other signed bytes",
    rawPayloadHash: sha256("other signed bytes") };
  pauseNext = true;
  const first = firstStore.saveEffect(account, stableEffect);
  await inside;
  const second = secondStore.saveEffect(account, otherEffect);
  let recoveryDone = false;
  const recovery = recoverOrcaStableNoSend(s.f.service, s.materials, s.bindings, s.proofs,
    secondStore, async () => account, s.marked.operationId, NOW).then((value) => {
    recoveryDone = true; return value;
  }, (error: unknown) => { recoveryDone = true; return error; });
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.equal(loads, 1); assert.equal(recoveryDone, false);
  release();
  const completed = await Promise.race([Promise.all([first, second, recovery]),
    new Promise<never>((_resolve, reject) => setTimeout(() => reject(new Error("wallet effect lock deadlocked")), 3_000))]);
  assert.equal(reason(completed[2]), "orca_stable_signed_effect_exists");
  assert.deepEqual(await secondStore.effectByOperationId(account, stableEffect.operationId), stableEffect);
  assert.deepEqual(await secondStore.effectByOperationId(account, otherEffect.operationId), otherEffect);
  assert.equal(await s.proofs.load(s.marked), null);
  assert.equal((await s.f.service.operations.loadAny(s.marked.operationId))?.state, "submitting");
  assert.equal((await s.f.service.usage.load({ account: s.marked.quote.account, chain: ORCA_SOLANA_CHAIN,
    asset: { kind: "token", identifier: USDC_MINT } }, s.marked.usageLease!.reservationId))?.state, "reserved");
});

test("marked stable recovery reconciles a crash after lease transition and serializes competitors", async (t) => {
  const s = await markedNoSendFixture(); t.after(s.f.cleanup);
  const original = s.f.service.usage.transition.bind(s.f.service.usage);
  let crashed = false;
  s.f.service.usage.transition = (async (input: any) => {
    const value = await original(input);
    if (!crashed) { crashed = true; throw new Error("injected crash after lease write"); }
    return value;
  }) as any;
  await assert.rejects(s.recover(), /injected crash/);
  assert.equal((await s.f.service.operations.loadAny(s.marked.operationId))?.state, "submitting");
  assert.equal((await s.proofs.load(s.marked))?.proofHash,
    (await s.f.service.usage.load({ account: s.marked.quote.account, chain: ORCA_SOLANA_CHAIN,
      asset: { kind: "token", identifier: USDC_MINT } }, s.marked.usageLease!.reservationId))?.outcomeDigest);
  let release!: () => void;
  const held = new Promise<void>((resolve) => { release = resolve; });
  let entered!: () => void;
  const enteredPromise = new Promise<void>((resolve) => { entered = resolve; });
  const locked = s.f.service.operations.withLocks([`orca-stable-operation:${s.marked.operationId}`], async () => {
    entered(); await held;
  });
  await enteredPromise;
  let done = false;
  const pending = s.recover().then((value) => { done = true; return value; });
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.equal(done, false);
  release(); await locked;
  assert.equal((await pending).state, "failed_before_effect");
});

test("marked recovery cannot open generic or other-mechanism pre-effect transitions", async (t) => {
  const s = await markedNoSendFixture(); t.after(s.f.cleanup);
  await assert.rejects(s.f.service.failBeforeEffect(s.marked, NOW, "a".repeat(64)),
    { code: "APN_OPERATION_BLOCKED" });
  const { integrityHash: _digest, ...body } = s.marked;
  const changed = { ...body, mechanismDigest: "e".repeat(64) };
  const foreign = { ...changed, integrityHash: domainHash("apn.swap-operation.v1", canonicalJson(changed)) };
  assert.throws(() => transitionSwapOperation(foreign, "failed_before_effect", {}, NOW),
    { code: "APN_OPERATION_BLOCKED" });
  assert.ok(!s.f.calls.includes("sendTransaction"));
});

async function receiptFixture(createAta: boolean) {
  const f = await fixture(!createAta);
  const prepared = await candidate(f), store = new SavedOrcaStableMaterialStore(f.root);
  const approved = await approveOrcaStableReservation(f.service, store, f.ports, prepared.operation.operationId,
    { confirm: async () => {} }, f.clock);
  const markerBody = { operationId: approved.operation.operationId,
    operationIntegrityHash: approved.operation.integrityHash,
    unsignedTransactionPayloadHash: approved.operation.quote.unsignedTransactionPayloadHash, markedAt: NOW.toISOString() };
  const { operationId: _operationId, ...markerFields } = markerBody;
  const operation = await f.service.operations.transition(approved.operation.ownerProfileHash, approved.operation.operationId,
    approved.operation.integrityHash, "submitting", { submissionMarker: { ...markerFields,
      markerHash: domainHash("apn.swap-submission-marker.v1", canonicalJson(markerBody)) } }, NOW);
  const material = (await store.load(operation.operationId, operation))!;
  const unsigned = getTransactionDecoder().decode(Buffer.from(material.preview.unsignedPayload, "base64"));
  const signature = "2".repeat(88);
  const signed = { ...unsigned, signatures: { [f.source.owner]: getBase58Encoder().encode(signature) } } as typeof unsigned;
  const encoded = getBase64EncodedWireTransaction(signed);
  const keys = getCompiledTransactionMessageDecoder().decode(unsigned.messageBytes).staticAccounts;
  const sourceIndex = keys.indexOf(material.preview.sourceAta as never);
  const destinationIndex = keys.indexOf(material.preview.destinationAta as never);
  const preBalances = keys.map(() => 1_000n), postBalances = [...preBalances];
  preBalances[0] = 20_000_000n; postBalances[0] = 20_000_000n - 5_000n - (createAta ? 2_000_000n : 0n);
  const balance = (index: number, mint: string, amount: string) => ({ accountIndex: index, mint, owner: f.source.owner,
    uiTokenAmount: { amount, decimals: 6n } });
  const output = f.source.quote.minimumOutputAtomic;
  const transfers = [
    { program: "spl-token", programId: TOKEN_PROGRAM, parsed: { type: "transfer", info: {
      source: material.preview.sourceAta, destination: ORCA_STABLE_VAULT_A, amount: "1000000", authority: f.source.owner } } },
    { program: "spl-token", programId: TOKEN_PROGRAM, parsed: { type: "transfer", info: {
      source: ORCA_STABLE_VAULT_B, destination: material.preview.destinationAta, amount: output,
      authority: ORCA_STABLE_POOL } } },
  ];
  const setup = [
    { program: "spl-token", programId: TOKEN_PROGRAM, parsed: { type: "getAccountDataSize", info: {
      mint: SOLANA_USDT, extensionTypes: ["immutableOwner"] } } },
    { program: "system", programId: SYSTEM_PROGRAM, parsed: { type: "createAccount", info: {
      source: f.source.owner, newAccount: material.preview.destinationAta, lamports: 2_000_000n,
      space: 165n, owner: TOKEN_PROGRAM } } },
    { program: "spl-token", programId: TOKEN_PROGRAM, parsed: { type: "initializeImmutableOwner", info: {
      account: material.preview.destinationAta } } },
    { program: "spl-token", programId: TOKEN_PROGRAM, parsed: { type: "initializeAccount3", info: {
      account: material.preview.destinationAta, mint: SOLANA_USDT, owner: f.source.owner } } },
  ];
  const signatureStatuses = { context: { slot: 450_687_920n },
    value: [{ slot: 450_687_920n, confirmationStatus: "finalized", err: null }] };
  const transaction = { slot: 450_687_920n, version: 0n, transaction: [encoded, "base64"], meta: {
    err: null, fee: 5_000n, loadedAddresses: { writable: [], readonly: [] }, preBalances, postBalances,
    preTokenBalances: [balance(sourceIndex, USDC_MINT, "2000000"),
      ...createAta ? [] : [balance(destinationIndex, SOLANA_USDT, "0")]],
    postTokenBalances: [balance(sourceIndex, USDC_MINT, "1000000"), balance(destinationIndex, SOLANA_USDT, output)],
    innerInstructions: [...createAta ? [{ index: 2, instructions: setup }] : [],
      { index: createAta ? 3 : 2, instructions: transfers }],
  } };
  return { f, operation, material, signature, signatureStatuses, transaction,
    input: { operation, material, signature, signatureStatuses, transaction, observedAt: NOW } };
}

async function privateStableObserverHarness(revert = false, claimCrash = false) {
  const h = await privateStableSenderHarness(false);
  if (claimCrash) {
    const original = h.f.service.recordPossibleSend.bind(h.f.service);
    (h.f.service as any).recordPossibleSend = async () => { throw new Error("crash after claim"); };
    await assert.rejects(h.sender.sendOnce(h.operationId), /crash after claim/);
    (h.f.service as any).recordPossibleSend = original;
  } else await h.sender.sendOnce(h.operationId);
  const effect = await h.custody.effectByOperationId();
  const receipt = await receiptFixture(false);
  const error = { InstructionError: [3, { Custom: 6000 }] };
  const metadata = receipt.transaction.meta;
  const transaction = { ...receipt.transaction, transaction: [effect.rawPayload, "base64"], meta: revert
    ? { ...metadata, err: error,
      postBalances: [metadata.preBalances[0]! - 5_000n, ...metadata.preBalances.slice(1)],
      postTokenBalances: metadata.preTokenBalances, innerInstructions: [] } : metadata };
  const statuses = { context: { slot: receipt.transaction.slot },
    value: [{ slot: receipt.transaction.slot, confirmationStatus: "finalized", err: revert ? error : null }] };
  const state = new StateStore(h.f.root); await state.initialize();
  let time = NOW.getTime() + 60_000;
  const requests: Array<{ method: string; params: unknown[]; start: number }> = [];
  let statusResult: unknown = statuses, transactionResult: unknown = transaction, genesisResult: unknown = SOLANA_GENESIS;
  const fetcher: typeof fetch = async (_url, init) => {
    const request = JSON.parse(init!.body as string) as { id: string; method: string; params: unknown[] };
    requests.push({ method: request.method, params: request.params, start: time });
    const result = request.method === "getGenesisHash" ? genesisResult :
      request.method === "getSignatureStatuses" ? statusResult : transactionResult;
    return new Response(JSON.stringify({ jsonrpc: "2.0", id: request.id, result },
      (_key, value) => typeof value === "bigint" ? Number(value) : value),
    { status: 200, headers: { "content-type": "application/json" } });
  };
  const newObserver = (service = h.f.service, endpoint = "https://stable-source.example/rpc") => {
    const budget = new SolanaRpcBudget({ maxPhysicalRequests: 3, minimumIntervalMs: 750,
      now: () => time, wait: async ms => { time += ms; } });
    const rpc = new SolanaRpc(endpoint, fetcher, budget,
      new SolanaRpcPacer(state, () => time, async ms => { time += ms; }));
    return new OrcaStableFinalizedObserver(service, h.materials, h.bindings, h.custody, rpc, () => new Date(time));
  };
  return { ...h, receipt, effect, requests, statuses, transaction, newObserver,
    setStatus: (value: unknown) => { statusResult = value; },
    setTransaction: (value: unknown) => { transactionResult = value; },
    setGenesis: (value: unknown) => { genesisResult = value; } };
}

test("public stable observe factory uses paced fake HTTPS, never sends, and preserves marked principal while pending", async (t) => {
  const h = await privateStableObserverHarness(); t.after(h.f.cleanup); t.after(h.receipt.f.cleanup);
  const request = bindArgv(["swap", "solana", "orca", "stable-observe", "--operation", h.operationId]);
  const methods: string[] = [];
  let time = NOW.getTime() + 60_000;
  let status: unknown = { context: { slot: h.transaction.slot }, value: [null] };
  const fetcher: typeof fetch = async (_url, init) => {
    const body = JSON.parse(init!.body as string) as { id: string; method: string; params: unknown[] };
    methods.push(body.method);
    assert.ok(["getGenesisHash", "getSignatureStatuses", "getTransaction"].includes(body.method));
    const result = body.method === "getGenesisHash" ? SOLANA_GENESIS :
      body.method === "getSignatureStatuses" ? status : h.transaction;
    return new Response(JSON.stringify({ jsonrpc: "2.0", id: body.id, result },
      (_key, value) => typeof value === "bigint" ? Number(value) : value),
      { status: 200, headers: { "content-type": "application/json" } });
  };
  const run = async () => await createApnCore(request, { stateRoot: h.f.root,
    chainAccounts: h.custody, solanaRpcUrl: "https://stable-source.example/rpc", solanaRpcFetch: fetcher,
    solanaRpcNow: () => time, solanaRpcWait: async milliseconds => { time += milliseconds; },
    clock: { now: () => new Date(time) } }).execute(request.request);
  const pending = await run();
  assert.equal(pending.ok, true, JSON.stringify(pending));
  assert.equal((pending.data as any).state, "submitted");
  assert.deepEqual(methods, ["getGenesisHash", "getSignatureStatuses"]);
  const statusRequest = bindArgv(["swap", "solana", "orca", "stable-status", "--operation", h.operationId]);
  const statusResult = await createApnCore(statusRequest, { stateRoot: h.f.root, chainAccounts: h.custody,
    clock: { now: () => new Date(time) } }).execute(statusRequest.request);
  assert.equal(statusResult.ok, true);
  assert.equal((statusResult.data as any).phase, "submitted");
  assert.equal((statusResult.data as any).signable, false);
  assert.equal((statusResult.data as any).executable, false);
  assert.equal((statusResult.data as any).signed, null);
  assert.equal((statusResult.data as any).broadcast, null);
  assert.equal((await h.f.service.usage.load({ account: h.staleOperation.quote.account, chain: ORCA_SOLANA_CHAIN,
    asset: { kind: "token", identifier: USDC_MINT } }, h.staleOperation.usageLease!.reservationId))?.state, "submitted");
  status = h.statuses;
  const final = await run();
  assert.equal(final.ok, true, JSON.stringify(final));
  assert.equal((final.data as any).state, "finalized");
  assert.deepEqual(methods.slice(2), ["getGenesisHash", "getSignatureStatuses", "getTransaction"]);
  assert.equal(methods.includes("sendTransaction"), false);
  const replay = await run();
  assert.equal((replay.data as any).state, "finalized");
  assert.equal(methods.length, 5);
  const server = createMcpServer({ stateRoot: h.f.root, chainAccounts: h.custody,
    solanaRpcUrl: "https://stable-source.example/rpc", solanaRpcFetch: fetcher,
    solanaRpcNow: () => time, solanaRpcWait: async milliseconds => { time += milliseconds; },
    clock: { now: () => new Date(time) } });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  const client = new Client({ name: "stable-observe-factory", version: "1" });
  await client.connect(clientTransport);
  t.after(async () => { await client.close(); await server.close(); });
  const mcp = await client.callTool({ name: "apn_swap_solana_orca_stable_observe", arguments: { operation: h.operationId } });
  assert.equal((mcp.structuredContent as any).ok, true);
  assert.equal((mcp.structuredContent as any).data.state, "finalized");
  assert.equal(methods.length, 5);
});

test("private stable observer finalizes exact receipt under concurrent observers and replays without RPC", async (t) => {
  const h = await privateStableObserverHarness(); t.after(h.f.cleanup); t.after(h.receipt.f.cleanup);
  const first = h.newObserver(), second = h.newObserver(h.competitorService);
  const [a, b] = await Promise.all([first.observe(h.operationId), second.observe(h.operationId)]);
  assert.equal(a.state, "finalized"); assert.equal(b.integrityHash, a.integrityHash);
  assert.equal(a.receiptProof?.transactionHash, h.effect.transactionId);
  assert.equal(a.usageLease?.outcomeDigest, a.receiptProof?.receiptHash);
  assert.deepEqual(h.requests.map(row => row.method), ["getGenesisHash", "getSignatureStatuses", "getTransaction"]);
  assert.deepEqual(h.requests[1]?.params, [[h.effect.transactionId], { searchTransactionHistory: true }]);
  assert.deepEqual(h.requests[2]?.params, [h.effect.transactionId,
    { commitment: "finalized", encoding: "base64", maxSupportedTransactionVersion: 0 }]);
  assert.ok(h.requests[1]!.start - h.requests[0]!.start >= 750);
  assert.ok(h.requests[2]!.start - h.requests[1]!.start >= 750);
  assert.equal((await h.newObserver().observe(h.operationId)).integrityHash, a.integrityHash);
  assert.equal(h.requests.length, 3);
});

test("private stable observer proves finalized revert and releases principal only with saved proof", async (t) => {
  const h = await privateStableObserverHarness(true); t.after(h.f.cleanup); t.after(h.receipt.f.cleanup);
  const final = await h.newObserver().observe(h.operationId);
  assert.equal(final.state, "failed_confirmed_revert");
  assert.equal(final.failureProofHash, final.receiptProof?.receiptHash);
  const saved = await new OrcaStableFinalizedObservationStore(h.f.root).load(final);
  assert.equal(saved?.outcome, "reverted");
  assert.deepEqual(saved?.proof, final.receiptProof);
  assert.equal((await h.newObserver().observe(h.operationId)).integrityHash, final.integrityHash);
});

test("private stable observation rejects a changed source, wrong genesis and stale status context with principal held", async (t) => {
  const h = await privateStableObserverHarness(); t.after(h.f.cleanup); t.after(h.receipt.f.cleanup);
  await assert.rejects(h.newObserver(h.f.service, "https://other.example/rpc").observe(h.operationId),
    { code: "APN_OPERATION_BLOCKED" });
  assert.equal(h.requests.length, 0);
  h.setGenesis("not-mainnet");
  await assert.rejects(h.newObserver().observe(h.operationId), { code: "APN_CHAIN_MISMATCH" });
  assert.deepEqual(h.requests.map(row => row.method), ["getGenesisHash"]);
  h.setGenesis(SOLANA_GENESIS);
  h.setStatus({ ...h.statuses, context: { slot: h.transaction.slot - 1n } });
  await assert.rejects(h.newObserver().observe(h.operationId),
    (error) => reason(error) === "orca_stable_receipt_conflict");
  assert.equal((await h.f.service.operations.loadAny(h.operationId))?.state, "submitted");
  const operation = (await h.f.service.operations.loadAny(h.operationId))!;
  assert.equal((await h.f.service.usage.load({ account: operation.quote.account, chain: ORCA_SOLANA_CHAIN,
    asset: { kind: "token", identifier: USDC_MINT } }, operation.usageLease!.reservationId))?.state, "submitted");
  assert.equal(h.requests.filter(row => row.method === "sendTransaction").length, 0);
  assert.equal(h.requests.filter(row => row.method === "getTransaction").length, 1);
});

test("private stable observer repairs claimed submitting crash, then waits on null status or transaction", async (t) => {
  const h = await privateStableObserverHarness(false, true); t.after(h.f.cleanup); t.after(h.receipt.f.cleanup);
  h.setStatus({ value: [null] });
  const pending = await h.newObserver().observe(h.operationId);
  assert.equal(pending.state, "unknown_finality"); assert.equal(pending.usageLease?.state, "unknown_finality");
  assert.deepEqual(h.requests.map(row => row.method), ["getGenesisHash", "getSignatureStatuses"]);
  h.setStatus(h.statuses); h.setTransaction(null);
  assert.equal((await h.newObserver().observe(h.operationId)).state, "unknown_finality");
  assert.equal(await new OrcaStableFinalizedObservationStore(h.f.root).load(pending), null);
  const live = await h.f.service.usage.load({ account: pending.quote.account, chain: ORCA_SOLANA_CHAIN,
    asset: { kind: "token", identifier: USDC_MINT } }, pending.usageLease!.reservationId);
  assert.equal(live?.state, "unknown_finality");
});

test("private stable observer replays proof after crashes before terminal lease and operation writes", async (t) => {
  const h = await privateStableObserverHarness(); t.after(h.f.cleanup); t.after(h.receipt.f.cleanup);
  const observer = h.newObserver();
  const observations = (observer as any).observations;
  const save = observations.save.bind(observations);
  observations.save = async (...args: unknown[]) => { const value = await save(...args); throw new Error("crash after proof"); };
  await assert.rejects(observer.observe(h.operationId), /crash after proof/);
  const marked = await h.f.service.operations.loadAny(h.operationId);
  assert.equal(marked?.state, "submitted");
  assert.ok(await new OrcaStableFinalizedObservationStore(h.f.root).load(marked!));
  const transition = h.f.service.operations.transition.bind(h.f.service.operations);
  (h.f.service.operations as any).transition = async (...args: any[]) => {
    if (args[3] === "finalized") throw new Error("crash after terminal lease");
    return (transition as any)(...args);
  };
  await assert.rejects(h.newObserver().observe(h.operationId), /crash after terminal lease/);
  (h.f.service.operations as any).transition = transition;
  const live = await h.f.service.usage.load({ account: marked!.quote.account, chain: ORCA_SOLANA_CHAIN,
    asset: { kind: "token", identifier: USDC_MINT } }, marked!.usageLease!.reservationId);
  assert.equal(live?.state, "finalized");
  const final = await h.newObserver().observe(h.operationId);
  assert.equal(final.state, "finalized"); assert.equal(final.usageLease?.reservationDigest, live?.reservationDigest);
  assert.deepEqual(h.requests.map(row => row.method), ["getGenesisHash", "getSignatureStatuses", "getTransaction",
    "getGenesisHash", "getGenesisHash"]);
});

test("private stable observer repairs a crash between possible-send lease and operation writes", async (t) => {
  const h = await privateStableObserverHarness(false, true); t.after(h.f.cleanup); t.after(h.receipt.f.cleanup);
  const transition = h.f.service.operations.transition.bind(h.f.service.operations);
  (h.f.service.operations as any).transition = async (...args: any[]) => {
    if (args[3] === "unknown_finality") throw new Error("crash after possible-send lease");
    return (transition as any)(...args);
  };
  await assert.rejects(h.newObserver().observe(h.operationId), /crash after possible-send lease/);
  (h.f.service.operations as any).transition = transition;
  const submitting = (await h.f.service.operations.loadAny(h.operationId))!;
  assert.equal(submitting.state, "submitting");
  assert.equal((await h.f.service.usage.load({ account: submitting.quote.account, chain: ORCA_SOLANA_CHAIN,
    asset: { kind: "token", identifier: USDC_MINT } }, submitting.usageLease!.reservationId))?.state, "unknown_finality");
  assert.equal((await h.newObserver().observe(h.operationId)).state, "finalized");
  assert.equal(h.requests.filter(row => row.method === "getTransaction").length, 1);
});

test("private stable observer keeps principal held on RPC failure and rejects malformed or conflicting evidence", async (t) => {
  const h = await privateStableObserverHarness(); t.after(h.f.cleanup); t.after(h.receipt.f.cleanup);
  h.setStatus({ value: [{ slot: h.transaction.slot, confirmationStatus: "finalized" }] });
  await assert.rejects(h.newObserver().observe(h.operationId), { code: "APN_OPERATION_BLOCKED" });
  h.setStatus(h.statuses);
  h.setTransaction({ ...h.transaction, slot: h.transaction.slot + 1n });
  await assert.rejects(h.newObserver().observe(h.operationId),
    (error) => reason(error) === "orca_stable_receipt_conflict");
  h.setStatus(undefined);
  assert.equal((await h.newObserver().observe(h.operationId)).state, "submitted");
  const op = (await h.f.service.operations.loadAny(h.operationId))!;
  assert.equal(await new OrcaStableFinalizedObservationStore(h.f.root).load(op), null);
  assert.equal((await h.f.service.usage.load({ account: op.quote.account, chain: ORCA_SOLANA_CHAIN,
    asset: { kind: "token", identifier: USDC_MINT } }, op.usageLease!.reservationId))?.state, "submitted");
});

test("private stable observer rejects custody and send-claim mismatch before RPC", async (t) => {
  const h = await privateStableObserverHarness(); t.after(h.f.cleanup); t.after(h.receipt.f.cleanup);
  const account = await h.custody.account();
  h.custody.account = async () => sealChainAccount({ schemaVersion: "apn.chain-account.v1",
    profile: account.profile, profileHash: account.profileHash, rail: "solana", network: "mainnet",
    provider: "local", custody: "local_software", address: account.address,
    createdAt: new Date(NOW.getTime() + 1_000).toISOString() });
  await assert.rejects(h.newObserver().observe(h.operationId), { code: "APN_STATE_CORRUPT" });
  assert.equal(h.requests.length, 0);
  h.custody.account = async () => account;
  h.custody.effectByOperationId = async () => null;
  await assert.rejects(h.newObserver().observe(h.operationId), { code: "APN_STATE_CORRUPT" });
  assert.equal(h.requests.length, 0);
});

test("private stable observer fails closed on occupied malformed finalized proof", async (t) => {
  const h = await privateStableObserverHarness(); t.after(h.f.cleanup); t.after(h.receipt.f.cleanup);
  const op = (await h.f.service.operations.loadAny(h.operationId))!;
  const directory = join(h.f.root, "orca-stable-finalized-observations", op.ownerProfileHash);
  await mkdir(directory, { recursive: true, mode: 0o700 });
  await writeFile(join(directory, `${op.operationId}.json`), "null\n", { mode: 0o600 });
  await assert.rejects(h.newObserver().observe(h.operationId), { code: "APN_STATE_CORRUPT" });
  assert.equal(h.requests.length, 0);
  assert.equal((await h.f.service.operations.loadAny(h.operationId))?.state, "submitted");
});

test("pure stable finalized receipt binds exact principal, output, fee and optional ATA rent", async (t) => {
  for (const createAta of [false, true]) {
    const r = await receiptFixture(createAta); t.after(r.f.cleanup);
    const outcome = await verifyOrcaStableFinalizedReceipt(r.input);
    assert.equal(outcome?.outcome, "succeeded");
    assert.equal(outcome.proof.transactionHash, r.signature);
  }
});

test("pure stable receipt leaves nonfinalized evidence pending and proves a finalized revert", async (t) => {
  const r = await receiptFixture(true); t.after(r.f.cleanup);
  assert.equal(await verifyOrcaStableFinalizedReceipt({ ...r.input,
    signatureStatuses: { context: r.signatureStatuses.context, value: [{ ...r.signatureStatuses.value[0], confirmationStatus: "confirmed" }] } }), null);
  const err = { InstructionError: [3, { Custom: 6000 }] };
  const reverted = { ...r.transaction, meta: { ...r.transaction.meta, err,
    postBalances: [...r.transaction.meta.preBalances.slice(0, 1).map((value) => value - 5_000n),
      ...r.transaction.meta.preBalances.slice(1)],
    postTokenBalances: [r.transaction.meta.preTokenBalances[0]], innerInstructions: [] } };
  const proof = await verifyOrcaStableFinalizedReceipt({ ...r.input, transaction: reverted,
    signatureStatuses: { context: r.signatureStatuses.context, value: [{ ...r.signatureStatuses.value[0], err }] } });
  assert.equal(proof?.outcome, "reverted");
});

test("pure stable receipt rejects changed token deltas, CPI, fee, slot and signed message", async (t) => {
  const r = await receiptFixture(false); t.after(r.f.cleanup);
  const conflict = (error: unknown) => reason(error) === "orca_stable_receipt_conflict";
  const base = r.transaction.meta;
  const changes = [
    { transaction: { ...r.transaction, meta: { ...base, postTokenBalances: [
      { ...base.postTokenBalances[0], uiTokenAmount: { amount: "1000001", decimals: 6n } }, base.postTokenBalances[1]] } } },
    { transaction: { ...r.transaction, meta: { ...base, innerInstructions: [
      { index: 2, instructions: [base.innerInstructions[0]!.instructions[0]] }] } } },
    { transaction: { ...r.transaction, meta: { ...base, fee: 5_001n } } },
    { transaction: { ...r.transaction, slot: 450_687_921n } },
    { signature: "3".repeat(88) },
  ];
  for (const change of changes) await assert.rejects(verifyOrcaStableFinalizedReceipt({ ...r.input, ...change }), conflict);
});

test("pure stable receipt treats missing evidence as pending and refuses ambiguous finality or ATA setup", async (t) => {
  const r = await receiptFixture(true); t.after(r.f.cleanup);
  const conflict = (error: unknown) => reason(error) === "orca_stable_receipt_conflict";
  assert.equal(await verifyOrcaStableFinalizedReceipt({ ...r.input, signatureStatuses: { context: r.signatureStatuses.context, value: [null] } }), null);
  assert.equal(await verifyOrcaStableFinalizedReceipt({ ...r.input, transaction: null }), null);
  await assert.rejects(verifyOrcaStableFinalizedReceipt({ ...r.input, signatureStatuses: {
    value: [{ ...r.signatureStatuses.value[0], err: { InstructionError: [3, "Failure"] } }] } }), conflict);
  await assert.rejects(verifyOrcaStableFinalizedReceipt({ ...r.input, transaction: { ...r.transaction,
    meta: { ...r.transaction.meta, innerInstructions: [{ ...r.transaction.meta.innerInstructions[0],
      instructions: [r.transaction.meta.innerInstructions[0]!.instructions[0]] },
      r.transaction.meta.innerInstructions[1]] } } }), conflict);
  await assert.rejects(verifyOrcaStableFinalizedReceipt({ ...r.input, transaction: { ...r.transaction,
    meta: { ...r.transaction.meta, postBalances: r.transaction.meta.preBalances } } }), conflict);
});

test("pure stable receipt rejects out-of-range or noncanonical token balances", async (t) => {
  const r = await receiptFixture(false); t.after(r.f.cleanup);
  const conflict = (error: unknown) => reason(error) === "orca_stable_receipt_conflict";
  for (const amount of ["18446744073709551616", "-1", "1e6", "01000000"]) {
    for (const field of ["preTokenBalances", "postTokenBalances"] as const) {
      const balances = r.transaction.meta[field];
      const changed = [{ ...balances[0], uiTokenAmount: { amount, decimals: 6n } }, ...balances.slice(1)];
      await assert.rejects(verifyOrcaStableFinalizedReceipt({ ...r.input,
        transaction: { ...r.transaction, meta: { ...r.transaction.meta, [field]: changed } } }), conflict);
    }
  }
});

test("pure stable receipt requires explicit status and transaction errors with known finality", async (t) => {
  const r = await receiptFixture(false); t.after(r.f.cleanup);
  const conflict = (error: unknown) => reason(error) === "orca_stable_receipt_conflict";
  const status = r.signatureStatuses.value[0]!;
  for (const changed of [
    { slot: status.slot, confirmationStatus: "finalized" },
    { ...status, err: undefined }, { ...status, err: 0 }, { ...status, err: {} },
    { ...status, err: { InstructionError: undefined } },
    { ...status, confirmationStatus: "unknown" }, { slot: status.slot, err: null },
  ]) await assert.rejects(verifyOrcaStableFinalizedReceipt({ ...r.input,
    signatureStatuses: { context: r.signatureStatuses.context, value: [changed] } }), conflict);
  for (const meta of [{ ...r.transaction.meta, err: undefined }, { ...r.transaction.meta, err: 0 }]) {
    await assert.rejects(verifyOrcaStableFinalizedReceipt({ ...r.input,
      transaction: { ...r.transaction, meta } }), conflict);
  }
});

test("pure stable revert accepts only canonical Solana transaction error variants", async (t) => {
  const r = await receiptFixture(true); t.after(r.f.cleanup);
  const postBalances = [...r.transaction.meta.preBalances];
  postBalances[0] = postBalances[0]! - 5_000n;
  const check = (err: unknown) => verifyOrcaStableFinalizedReceipt({ ...r.input,
    signatureStatuses: { context: r.signatureStatuses.context, value: [{ ...r.signatureStatuses.value[0], err }] },
    transaction: { ...r.transaction, meta: { ...r.transaction.meta, err, postBalances,
      postTokenBalances: [r.transaction.meta.preTokenBalances[0]], innerInstructions: [] } } });
  for (const valid of ["AccountInUse", { DuplicateInstruction: 2n },
    { InstructionError: [3n, "InvalidInstructionData"] }, { InstructionError: [3, { Custom: 6000n }] },
    { InsufficientFundsForRent: { account_index: 1n } },
    { ProgramExecutionTemporarilyRestricted: { account_index: 1 } }]) {
    assert.equal((await check(valid))?.outcome, "reverted");
  }
  for (const invalid of ["InventedFailure", "", { InstructionError: [] },
    { InstructionError: 123 }, { InstructionError: [3] }, { InstructionError: [3, "InventedFailure"] },
    { InstructionError: [-1, "InvalidInstructionData"] }, { InstructionError: [256, "InvalidInstructionData"] },
    { InstructionError: [3, { Custom: -1 }] }, { InstructionError: [3, { Custom: 4_294_967_296n }] },
    { DuplicateInstruction: -1 }, { InsufficientFundsForRent: { account_index: "1" } },
    { ProgramExecutionTemporarilyRestricted: { account_index: 1, extra: 2 } }]) {
    await assert.rejects(check(invalid), (error) => reason(error) === "orca_stable_receipt_conflict");
  }
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
