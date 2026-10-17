import assert from "node:assert/strict";
import test from "node:test";
import { getCompiledTransactionMessageDecoder, getTransactionDecoder } from "@solana/kit";
import { bindArgv } from "../../src/command-binder.js";
import { ApnCore } from "../../src/core.js";
import { ApnError } from "../../src/errors.js";
import { StateStore } from "../../src/state.js";
import type { TtyTransferApprovalOptions } from "../../src/tty-approval.js";
import { swapMechanismDigest } from "../../src/swap/pin.js";
import { swapRouteOf } from "../../src/swap/route-admission.js";
import { solanaSwapCommandRequests, SOLANA_SWAP_PLAN_HEADROOM_REQUESTS } from "../../src/swap/solana-read-plan.js";
import { createOrcaKeylessRuntime, orcaRuntimeSelector } from "../../src/swap/orca-solana/runtime-factory.js";
import { ORCA_POOLS } from "../../src/swap/orca-solana/pools.js";
import { ORCA_STABLE_GUARDED_MECHANISM_PIN } from "../../src/swap/orca-solana/stable-mechanism.js";
import { temporaryState } from "./helpers.js";
import { FakeOrcaRpc, orcaOwner, orcaPolicy, PROFILE, signatureOf } from "./orca-solana-helpers.js";
import { FakeOrcaTokenRpc, POOL, USDC_IN, usdcUsdtPolicy } from "./orca-usdc-usdt-helpers.js";

function reason(error: unknown): string { return error instanceof ApnError ? String(error.details?.reason ?? error.code) : String(error); }

async function flow(root: string, mechanism: unknown = ORCA_STABLE_GUARDED_MECHANISM_PIN) {
  let clockMs = Date.parse("2026-10-17T10:00:00.000Z"); const clock = { now: () => new Date(clockMs) };
  const owner = await orcaOwner(root), rpc = await FakeOrcaTokenRpc.create(owner.address);
  const policy = usdcUsdtPolicy(owner.address, clock.now(), mechanism as never);
  let printed = "", prompts = 0;
  const terminal: NonNullable<TtyTransferApprovalOptions["openTerminal"]> = async () => ({ fd: 11, write: async (text: string) => { printed += text; },
    read: async function* () { prompts += 1; yield Buffer.from(`${/Type ([0-9a-f]{6}) and press Enter/u.exec(printed)?.[1] ?? ""}\n`); },
    close: async () => undefined });
  const runtime = createOrcaKeylessRuntime({ state: owner.state, clock, rpc, accounts: owner.accounts, verifyPins: async () => [], foreground: "tty",
    pool: POOL, policy: async (profile) => profile === PROFILE ? policy : null, tty: { isTerminal: () => true, openTerminal: terminal } });
  const quote = async (amount = USDC_IN) => await runtime.quote({ profile: PROFILE, account: owner.address, amountAtomic: amount.toString(),
    slippageBps: 50, ownerSlippageCapBps: 100, computeUnitLimit: 250_000, computeUnitPriceMicroLamports: "0" }, clock.now()) as {
      quoteHash: string; quote: { minimumOutputAtomic: string }; fees: Record<string, string> };
  return { runtime, rpc, owner, clock, quote, printed: () => printed, prompts: () => prompts, advance: (ms: number) => { clockMs += ms; } };
}

test("USDC to USDT runs through the generic keyless route: quote, prepare, one consent, one send, finalized receipt", async (t) => {
  const temporary = await temporaryState(); t.after(temporary.cleanup);
  const f = await flow(temporary.root);
  const quoted = await f.quote();
  const quoteCalls = [...f.rpc.calls]; f.rpc.calls = [];
  const prepared = await f.runtime.prepare({ profile: PROFILE, quoteHash: quoted.quoteHash, idempotencyKey: "orca-usdc-usdt-0001" }, f.clock.now());
  assert.equal(prepared.state, "awaiting_approval"); assert.equal(prepared.approvalCapAtomic, "0");
  // A policy written for the former stable lane (its full pin) admits the new lane by route.
  assert.equal(prepared.mechanismDigest, swapMechanismDigest(POOL.mechanismPin));
  assert.equal(prepared.protocolRegistryDigest, POOL.protocolRegistry.registryDigest);
  assert.deepEqual([prepared.quote.sourceAsset.identifier, prepared.quote.destinationAsset.identifier], [POOL.mintA, POOL.mintB]);
  assert.equal(f.rpc.calls.length, 0, "prepare makes no RPC call");
  const sent = await f.runtime.approveAndExecute(prepared.operationId, f.clock.now());
  const approveCalls = [...f.rpc.calls]; f.rpc.calls = [];
  assert.equal(sent.state, "submitted"); assert.equal(f.rpc.sends.length, 1); assert.equal(f.prompts(), 1, "exactly one owner consent");
  assert.deepEqual(f.rpc.simulations.map((row) => row.replace), [true, false], "quote simulation, then the exact signed-to-be bytes");
  const message = getCompiledTransactionMessageDecoder().decode(getTransactionDecoder().decode(Buffer.from(f.rpc.sends[0]!, "base64")).messageBytes);
  if (message.version !== 0) throw new Error("expected a v0 message");
  assert.equal(message.instructions.length, 4, "compute limit, compute price, idempotent USDT account, swap");
  for (const line of ["You send: 1 USDC (1000000 atomic)", "USDT goes to your own token account", "Minimum in: ", "fails the swap below this",
    "(USDC/USDT, tick spacing 1)", "0.01% LP fee", "Maximum SOL leaving the wallet (fee and rent only): ", "Token approval cap: 0"]) {
    assert.ok(f.printed().includes(line), line);
  }
  f.rpc.status = "finalized"; f.advance(20_000);
  const finalized = await f.runtime.status(sent.operationId, f.clock.now());
  const statusCalls = [...f.rpc.calls];
  assert.equal(finalized.state, "finalized"); assert.equal(finalized.receiptProof?.transactionHash, signatureOf(f.rpc.sends[0]!));
  assert.equal(finalized.usageLease?.state, "finalized"); assert.equal(f.rpc.sends.length, 1);
  // RPC per step through the fake port (program pins stubbed; the ten-key market read already goes out as two pages).
  assert.deepEqual({ quote: quoteCalls.length, approve: approveCalls.length, status: statusCalls.length }, { quote: 8, approve: 11, status: 2 });
  assert.equal(approveCalls.filter((method) => method === "sendTransaction").length, 1);
  // The physical plan of the shared Orca commands covers this pool unchanged: plus the program pin header read, and on
  // approve the finalized transaction read when the send has already landed.
  assert.equal(solanaSwapCommandRequests("swap.orca.quote")! - SOLANA_SWAP_PLAN_HEADROOM_REQUESTS, quoteCalls.length + 1);
  assert.equal(solanaSwapCommandRequests("swap.orca.approve")! - SOLANA_SWAP_PLAN_HEADROOM_REQUESTS, approveCalls.length + 2);
});

test("USDC to USDT creates a missing USDT account inside the swap and bounds SOL to fee and rent", async (t) => {
  const temporary = await temporaryState(); t.after(temporary.cleanup);
  const f = await flow(temporary.root, swapRouteOf(POOL.mechanismPin));
  f.rpc.destinationBefore = null;
  const quoted = await f.quote();
  assert.equal(quoted.fees.destinationAccountRentLamports, f.rpc.rent.toString());
  assert.equal(quoted.fees.maximumSolSpendLamports, (f.rpc.fee + f.rpc.rent).toString());
  const prepared = await f.runtime.prepare({ profile: PROFILE, quoteHash: quoted.quoteHash, idempotencyKey: "orca-usdc-usdt-0002" }, f.clock.now());
  const sent = await f.runtime.approveAndExecute(prepared.operationId, f.clock.now());
  f.rpc.status = "finalized"; f.advance(20_000);
  assert.equal((await f.runtime.status(sent.operationId, f.clock.now())).state, "finalized");
  assert.ok(f.printed().includes("created in this transaction"));
});

test("USDC to USDT refuses short balances, shortfalls and a wrong debit before anything is signed", async (t) => {
  const temporary = await temporaryState(); t.after(temporary.cleanup);
  const f = await flow(temporary.root);
  f.rpc.sourceBefore = 999_999n;
  await assert.rejects(f.quote(), (error) => error instanceof ApnError && error.code === "APN_INSUFFICIENT_ASSET" && reason(error) === "orca_insufficient_source");
  f.rpc.sourceBefore = null;
  await assert.rejects(f.quote(), (error) => reason(error) === "orca_source_account_absent");
  f.rpc.sourceBefore = 2_000_000n; f.rpc.ownerLamports = 4_000n;
  await assert.rejects(f.quote(), (error) => reason(error) === "orca_insufficient_sol");
  f.rpc.ownerLamports = 20_000_000n; f.rpc.outputAboveMinimum = -1n;
  await assert.rejects(f.quote(), (error) => reason(error) === "orca_simulation_output_shortfall");
  f.rpc.outputAboveMinimum = 0n; f.rpc.debitAdjustment = 1n;
  await assert.rejects(f.quote(), (error) => reason(error) === "orca_simulation_protocol");
  f.rpc.debitAdjustment = 0n;
  const quoted = await f.quote();
  const prepared = await f.runtime.prepare({ profile: PROFILE, quoteHash: quoted.quoteHash, idempotencyKey: "orca-usdc-usdt-0003" }, f.clock.now());
  f.rpc.outputAboveMinimum = -1n;
  await assert.rejects(f.runtime.approveAndExecute(prepared.operationId, f.clock.now()), (error) => reason(error) === "orca_simulation_output_shortfall");
  const released = await f.runtime.status(prepared.operationId, f.clock.now());
  assert.equal(released.state, "failed_before_effect"); assert.equal(released.submissionMarker, null); assert.equal(f.rpc.sends.length, 0);
});

test("a finalized failed USDC to USDT swap releases the principal as failed_confirmed_revert", async (t) => {
  const temporary = await temporaryState(); t.after(temporary.cleanup);
  const f = await flow(temporary.root);
  const quoted = await f.quote();
  const prepared = await f.runtime.prepare({ profile: PROFILE, quoteHash: quoted.quoteHash, idempotencyKey: "orca-usdc-usdt-0004" }, f.clock.now());
  const sent = await f.runtime.approveAndExecute(prepared.operationId, f.clock.now());
  f.rpc.status = "finalized_error"; f.advance(20_000);
  const reverted = await f.runtime.status(sent.operationId, f.clock.now());
  assert.equal(reverted.state, "failed_confirmed_revert"); assert.equal(reverted.usageLease?.state, "failed_confirmed_revert");
});

test("each pool runs only in its own runtime: --pool selects quote, the saved quote selects prepare, the lane selects status", async (t) => {
  const temporary = await temporaryState(); t.after(temporary.cleanup);
  const f = await flow(temporary.root);
  const solUsdc = createOrcaKeylessRuntime({ state: f.owner.state, clock: f.clock, accounts: f.owner.accounts, verifyPins: async () => [],
    rpc: new FakeOrcaRpc(f.owner.address, f.owner.wsol, f.owner.usdc, f.owner.oracle), foreground: "tty", pool: ORCA_POOLS["sol-usdc"],
    policy: async () => orcaPolicy(f.owner.address, f.clock.now()) });
  const quoted = await f.quote();
  await assert.rejects(solUsdc.prepare({ profile: PROFILE, quoteHash: quoted.quoteHash, idempotencyKey: "orca-usdc-usdt-0005" }, f.clock.now()),
    (error) => reason(error) === "orca_pool_mismatch");
  const built: string[] = [];
  const core = new ApnCore({ state: new StateStore(f.owner.state.root), clock: f.clock,
    orcaRuntime: orcaRuntimeSelector((pool) => { built.push(pool.id); return pool.id === "usdc-usdt" ? f.runtime : solUsdc; }) });
  const argv = ["swap", "solana", "orca", "quote", "--profile", PROFILE, "--account", f.owner.address, "--amount", USDC_IN.toString(),
    "--slippage-bps", "50", "--owner-slippage-cap-bps", "100", "--compute-unit-limit", "250000", "--compute-unit-price", "0"];
  assert.throws(() => bindArgv(argv), (error) => error instanceof ApnError && error.code === "APN_INVALID_INPUT");
  assert.throws(() => bindArgv([...argv, "--pool", "sol-usdt"]), (error) => error instanceof ApnError && error.code === "APN_INVALID_INPUT");
  const request = bindArgv([...argv, "--pool", "usdc-usdt"]).request;
  assert.equal((request as { pool?: string }).pool, "usdc-usdt");
  const cliQuote = await core.execute(request);
  assert.equal(cliQuote.ok, true, JSON.stringify(cliQuote.error));
  const quoteHash = (cliQuote.data as { quoteHash: string }).quoteHash;
  const prepared = await core.execute({ command: "swap.orca.prepare", profile: PROFILE, quoteHash, idempotencyKey: "orca-usdc-usdt-0006" });
  assert.equal(prepared.ok, true, JSON.stringify(prepared.error));
  const operationId = (prepared.operation as { operationId: string }).operationId;
  const status = await core.execute({ command: "swap.orca.status", operationId });
  assert.equal(status.proof_class, "awaiting_approval");
  assert.deepEqual(built, ["usdc-usdt"]);
  const inventory = await core.execute({ command: "swap.orca.inventory" });
  const pools = (inventory.data as { pools: { pool: string; route: unknown }[] }).pools;
  assert.deepEqual(pools.map((row) => row.pool), ["sol-usdc", "usdc-usdt"]);
  assert.deepEqual(pools[1]!.route, swapRouteOf(ORCA_STABLE_GUARDED_MECHANISM_PIN));
});
