import assert from "node:assert/strict";
import test from "node:test";
import { runCli } from "../../src/cli.js";
import { EvmDirectRpcGuard } from "../../src/evm-direct-rpc-guard.js";
import { ApnError } from "../../src/errors.js";
import { HttpsBaseRpc } from "../../src/rpc.js";
import { StateStore } from "../../src/state.js";
import { EVM_REQUEST, ensureDirectWallet, evmCore } from "./evm-helpers.js";
import { activateDirectPolicy, directAdmission } from "./direct-allowlist-helpers.js";
import { DIRECT_EVM_NETWORKS } from "../../src/evm-direct-networks.js";
import { directEvmStepBudget } from "../../src/evm-direct-reads.js";
import { temporaryState } from "./helpers.js";

test("every direct network's CLI prepare installs a durable guard capped by its read plan before any network request", async t => {
  const temporary = await temporaryState(); t.after(temporary.cleanup);
  const setup = evmCore(temporary.root);
  const wallet = await ensureDirectWallet(setup);
  await activateDirectPolicy(temporary.root, "default", { accounts: { evm: wallet.address }, now: setup.clock.now(),
    admissions: DIRECT_EVM_NETWORKS.map(network => directAdmission(network.caip2, null)) });
  const original = HttpsBaseRpc.prototype.armEvmDirectRpcGuard;
  const seen: { guard?: EvmDirectRpcGuard | undefined } = {};
  HttpsBaseRpc.prototype.armEvmDirectRpcGuard = function (...args: Parameters<typeof original>) {
    original.apply(this, args);
    seen.guard = (this as unknown as { directGuard: EvmDirectRpcGuard }).directGuard;
    throw new ApnError("APN_RPC_PROTOCOL", "Synthetic stop before network");
  };
  t.after(() => { HttpsBaseRpc.prototype.armEvmDirectRpcGuard = original; });
  for (const network of DIRECT_EVM_NETWORKS) {
    seen.guard = undefined;
    const result = await runCli(["pay", "transfer", "prepare-asset", "--profile", "default",
      "--chain", network.caip2, "--asset", "native", "--rpc-url", "https://rpc.example",
      "--to", EVM_REQUEST.recipient, "--amount", EVM_REQUEST.amount,
      "--max-fee-wei", EVM_REQUEST.maxFeeWei, "--idempotency-key", `guard-state-cli-${network.chainId}`], {},
    { stateRoot: temporary.root, native: setup.local, wrappingSecret: setup.wrapping });
    assert.equal(result.error?.code, "APN_RPC_PROTOCOL", `${network.name}: ${JSON.stringify(result.error)}`);
    const guarded = seen.guard as EvmDirectRpcGuard | undefined;
    assert.ok(guarded, `${network.name}: the production runtime constructed a state-backed guard`);
    const cap = directEvmStepBudget(network.chainId, "prepare");
    let starts = 0;
    for (let index = 0; index < cap; index += 1) await guarded.post(`https://rpc.provider${network.chainId}-${index}.example`, async () => { starts += 1; });
    await assert.rejects(guarded.post("https://rpc.example", async () => { starts += 1; }), { code: "APN_RPC_BUDGET_EXCEEDED" });
    assert.equal(starts, cap);
  }
});

test("direct EVM guard counts physical POSTs, caps at 24 and persists 750 ms starts", async t => {
  const temporary = await temporaryState(); t.after(temporary.cleanup);
  const state = new StateStore(temporary.root); await state.initialize();
  let now = 1_000_000, starts = 0;
  const wait = async (ms: number) => { now += ms; };
  const first = new EvmDirectRpcGuard(state, 24, () => now, wait);
  for (let n = 0; n < 24; n += 1) {
    await first.post("https://arbitrum-one-rpc.publicnode.com", async () => { starts += 1; return null; });
  }
  assert.equal(first.physicalRequests, 24);
  assert.equal(starts, 24);
  await assert.rejects(first.post("https://arbitrum-one-rpc.publicnode.com", async () => { starts += 1; }),
    { code: "APN_RPC_BUDGET_EXCEEDED" });
  assert.equal(starts, 24);
  const before = now;
  const second = new EvmDirectRpcGuard(state, 24, () => now, wait);
  await second.post("https://base-rpc.publicnode.com", async () => { starts += 1; });
  assert.equal(now - before, 750);
  assert.equal(starts, 25);
  const third = new EvmDirectRpcGuard(state, 24, () => now, wait);
  await third.post("https://eth-rpc.publicnode.com", async () => { starts += 1; });
  assert.equal(now - before, 1_500, "Arbitrum, Base and Ethereum share persisted publicnode family pacing");
});

test("separate direct EVM guards pace from physical completion under the shared family lock", async t => {
  const temporary = await temporaryState(); t.after(temporary.cleanup);
  const state = new StateStore(temporary.root); await state.initialize();
  let entered!: () => void;
  const firstEntered = new Promise<void>(resolve => { entered = resolve; });
  let completed = 0, secondEntry = 0;
  const first = new EvmDirectRpcGuard(state);
  const second = new EvmDirectRpcGuard(state);
  const active = first.post("https://arbitrum-one-rpc.publicnode.com", async () => {
    entered();
    await new Promise(resolve => setTimeout(resolve, 100));
    completed = Date.now();
  });
  await firstEntered;
  const waiting = second.post("https://base-rpc.publicnode.com", async () => { secondEntry = Date.now(); });
  await Promise.all([active, waiting]);
  assert.ok(secondEntry - completed >= 750, `physical completion gap ${secondEntry - completed}`);
});

test("direct EVM guard makes a single attempt on 429 and retains provider cooldown", async t => {
  const temporary = await temporaryState(); t.after(temporary.cleanup);
  const state = new StateStore(temporary.root); await state.initialize();
  let now = 2_000_000, attempts = 0;
  const guard = new EvmDirectRpcGuard(state, 24, () => now, async ms => { now += ms; });
  await assert.rejects(guard.post("https://arbitrum-one-rpc.publicnode.com", async () => {
    attempts += 1;
    throw new ApnError("APN_RPC_PROTOCOL", "HTTP failure", { httpStatus: 429 });
  }), { code: "APN_RPC_RATE_LIMITED" });
  assert.equal(attempts, 1);
  const after = new EvmDirectRpcGuard(state, 24, () => now, async ms => { now += ms; });
  await assert.rejects(after.post("https://arbitrum-one-rpc.publicnode.com", async () => { attempts += 1; }),
    { code: "APN_PROVIDER_UNAVAILABLE" });
  assert.equal(attempts, 1);
});

test("direct Arbitrum guard treats HTTP 403 as terminal without retry", async t => {
  const temporary = await temporaryState(); t.after(temporary.cleanup);
  const state = new StateStore(temporary.root); await state.initialize();
  let attempts = 0;
  const guard = new EvmDirectRpcGuard(state, 24, () => 2_000_000, async () => {});
  await assert.rejects(guard.post("https://arbitrum-one-rpc.publicnode.com", async () => {
    attempts += 1;
    throw new ApnError("APN_RPC_PROTOCOL", "HTTP failure", { httpStatus: 403 });
  }), { code: "APN_RPC_PROTOCOL", details: { httpStatus: 403 } });
  assert.equal(attempts, 1);
  assert.equal(guard.physicalRequests, 1);
});

test("direct EVM guard names its pre-transport refusal without a POST: the provider family cooling down, then the cap spent", async t => {
  const temporary = await temporaryState(); t.after(temporary.cleanup);
  const state = new StateStore(temporary.root); await state.initialize();
  let now = 3_000_000, attempts = 0;
  const wait = async (ms: number) => { now += ms; }, endpoint = "https://ethereum-rpc.publicnode.com";
  await assert.rejects(new EvmDirectRpcGuard(state, 24, () => now, wait).post("https://base-rpc.publicnode.com", async () => {
    attempts += 1; throw new ApnError("APN_RPC_PROTOCOL", "HTTP failure", { httpStatus: 429 });
  }), { code: "APN_RPC_RATE_LIMITED" });
  const guard = new EvmDirectRpcGuard(state, 1, () => now, wait), cooling = { code: "APN_PROVIDER_UNAVAILABLE", details: { reason: "rpc_provider_cooldown" } };
  await assert.rejects(guard.assertCanPost(endpoint), cooling);
  await assert.rejects(guard.post(endpoint, async () => { attempts += 1; }), cooling, "post() refuses alike");
  assert.deepEqual([attempts, guard.physicalRequests], [1, 0]);
  now += 30_000;
  await guard.assertCanPost(endpoint);
  await guard.post(endpoint, async () => { attempts += 1; });
  await assert.rejects(guard.assertCanPost(endpoint), { code: "APN_RPC_BUDGET_EXCEEDED", details: { physicalRequests: 1, maxPhysicalRequests: 1 } });
  assert.deepEqual([attempts, guard.physicalRequests], [2, 1]);
});
