import assert from "node:assert/strict";
import test from "node:test";
import { runCli } from "../../src/cli.js";
import { EvmDirectRpcGuard } from "../../src/evm-direct-rpc-guard.js";
import { ApnError } from "../../src/errors.js";
import { HttpsBaseRpc } from "../../src/rpc.js";
import { StateStore } from "../../src/state.js";
import { EVM_REQUEST, ensureDirectWallet, evmCore } from "./evm-helpers.js";
import { temporaryState } from "./helpers.js";

test("Arbitrum CLI prepare installs durable direct RPC guard before any network request", async t => {
  const temporary = await temporaryState(); t.after(temporary.cleanup);
  const setup = evmCore(temporary.root);
  await ensureDirectWallet(setup);
  const original = HttpsBaseRpc.prototype.armEvmDirectRpcGuard;
  let guarded: EvmDirectRpcGuard | undefined;
  HttpsBaseRpc.prototype.armEvmDirectRpcGuard = function () {
    original.call(this);
    guarded = (this as unknown as { directGuard: EvmDirectRpcGuard }).directGuard;
    throw new ApnError("APN_RPC_PROTOCOL", "Synthetic stop before network");
  };
  t.after(() => { HttpsBaseRpc.prototype.armEvmDirectRpcGuard = original; });
  const result = await runCli(["pay", "transfer", "prepare-asset", "--profile", "default",
    "--chain", "eip155:42161", "--asset", "native", "--rpc-url", "https://arbitrum-one-rpc.publicnode.com",
    "--to", EVM_REQUEST.recipient, "--amount", EVM_REQUEST.amount,
    "--max-fee-wei", EVM_REQUEST.maxFeeWei, "--idempotency-key", "arbitrum-guard-state-cli-0001"], {},
  { stateRoot: temporary.root, native: setup.local, wrappingSecret: setup.wrapping });
  assert.equal(result.error?.code, "APN_RPC_PROTOCOL");
  assert.ok(guarded, "the production runtime constructed a state-backed guard");
  let starts = 0;
  for (let index = 0; index < 24; index += 1) {
    await guarded.post(`https://rpc.provider${index}.example`, async () => { starts += 1; });
  }
  await assert.rejects(guarded.post("https://arbitrum-one-rpc.publicnode.com", async () => { starts += 1; }),
    { code: "APN_RPC_BUDGET_EXCEEDED" });
  assert.equal(starts, 24);
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
