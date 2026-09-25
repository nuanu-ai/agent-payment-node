import assert from "node:assert/strict";
import test from "node:test";
import { ApnError } from "../../src/errors.js";
import { EvmDirectRpcGuard } from "../../src/evm-direct-rpc-guard.js";
import { RelayArbitrumSourceFinalityObserver, type RelayArbitrumExpectedEffect } from "../../src/relay/arbitrum-source-finality.js";
import { StateStore } from "../../src/state.js";
import { temporaryState } from "./helpers.js";

const hash = (digit: string) => `0x${digit.repeat(64)}` as `0x${string}`;
const owner = "0x0B4Dd0C3dA001Fa146EEd3f80B01860BEF6B8a14";
const target = "0x1111111111111111111111111111111111111111";
const deposit: RelayArbitrumExpectedEffect = { transactionHash: hash("a"), from: owner, to: target,
  data: "0x12345678", valueWei: 0n };
const approval: RelayArbitrumExpectedEffect = { transactionHash: hash("b"), from: owner, to: target,
  data: "0x095ea7b3", valueWei: 0n };
const inclusion = hash("c"), safe = hash("d");
const receipt = (effect: RelayArbitrumExpectedEffect) => ({ transactionHash: effect.transactionHash,
  blockNumber: "0x64", blockHash: inclusion, status: "0x1" });
const tx = (effect: RelayArbitrumExpectedEffect) => ({ hash: effect.transactionHash, from: effect.from,
  to: effect.to, input: effect.data, value: "0x0", chainId: "0xa4b1", blockNumber: "0x64", blockHash: inclusion });
type Mutation = (rows: unknown[], leg: number, pass: number) => void;

async function setup(mutate?: Mutation, guardLimit = 24,
  effects: readonly RelayArbitrumExpectedEffect[] = [deposit]) {
  const temp = await temporaryState();
  const state = new StateStore(temp.root); await state.initialize();
  let posts = 0, clock = 1_000_000;
  const requests: string[][] = [];
  const rpc = { batchCall: async (calls: readonly { method: string; params: readonly unknown[] }[]) => {
    const leg = Math.floor(posts / 2), pass = posts % 2;
    requests.push(calls.map(call => call.method)); posts++;
    const effect = effects[leg]!;
    const rows: unknown[] = pass === 0
      ? ["0xa4b1", tx(effect), receipt(effect), { number: "0x70", hash: safe }]
      : [{ number: "0x64", hash: inclusion }, { number: "0x70", hash: safe }, tx(effect), receipt(effect)];
    mutate?.(rows, leg, pass);
    return rows;
  } };
  const observer = new RelayArbitrumSourceFinalityObserver("https://arb-rpc.publicnode.com", state, rpc,
    () => new EvmDirectRpcGuard(state, guardLimit, () => clock, async ms => { clock += ms; }));
  return { observer, cleanup: temp.cleanup, requests, posts: () => posts, clock: () => clock };
}

test("approval and deposit require exact canonical safe source receipts within four physical POSTs", async t => {
  const f = await setup(undefined, 24, [approval, deposit]); t.after(f.cleanup);
  const proof = await f.observer.observe(deposit, approval);
  assert.equal(proof?.proofClass, "canonical_safe_source_receipts");
  assert.equal(proof?.deposit.transactionHash, deposit.transactionHash);
  assert.equal(proof?.approval?.transactionHash, approval.transactionHash);
  assert.equal(proof?.destinationDeliveryProven, false);
  assert.equal(proof?.causalLinkCryptographicallyProven, false);
  assert.equal(proof?.paidAcceptance, false);
  assert.equal(f.posts(), 4);
  assert.equal(f.clock(), 1_002_250);
  assert.deepEqual(f.requests, [
    ["eth_chainId", "eth_getTransactionByHash", "eth_getTransactionReceipt", "eth_getBlockByNumber"],
    ["eth_getBlockByNumber", "eth_getBlockByNumber", "eth_getTransactionByHash", "eth_getTransactionReceipt"],
    ["eth_chainId", "eth_getTransactionByHash", "eth_getTransactionReceipt", "eth_getBlockByNumber"],
    ["eth_getBlockByNumber", "eth_getBlockByNumber", "eth_getTransactionByHash", "eth_getTransactionReceipt"],
  ]);
});

test("canonical reorg, unsafe head, changed receipt, revert and missing transaction remain unproven", async t => {
  const cases: Mutation[] = [
    (rows, _, pass) => { if (pass === 1) rows[0] = { number: "0x64", hash: hash("e") }; },
    (rows, _, pass) => { if (pass === 0) rows[3] = { number: "0x63", hash: safe }; },
    (rows, _, pass) => { if (pass === 1) rows[3] = { ...rows[3] as object, blockHash: hash("e") }; },
    (rows, _, pass) => { if (pass === 0) rows[2] = { ...rows[2] as object, status: "0x0" }; },
    (rows, _, pass) => { if (pass === 0) rows[1] = null; },
  ];
  for (const mutate of cases) {
    const f = await setup(mutate); t.after(f.cleanup);
    assert.equal(await f.observer.observe(deposit), null);
    assert.ok(f.posts() <= 2);
  }
});

test("failed approval blocks deposit reads; malformed receipt status fails protocol", async t => {
  const failed = await setup((rows, leg, pass) => {
    if (leg === 0 && pass === 0) rows[2] = { ...rows[2] as object, status: "0x0" };
  }, 24, [approval, deposit]); t.after(failed.cleanup);
  assert.equal(await failed.observer.observe(deposit, approval), null);
  assert.equal(failed.posts(), 2);
  const malformed = await setup((rows, _, pass) => {
    if (pass === 0) rows[2] = { ...rows[2] as object, status: "0x2" };
  }); t.after(malformed.cleanup);
  await assert.rejects(malformed.observer.observe(deposit), { code: "APN_RPC_PROTOCOL" });
});

test("chain and exact source transaction envelope mutations fail closed", async t => {
  const cases: Mutation[] = [
    (rows, _, pass) => { if (pass === 0) rows[0] = "0x1"; },
    (rows, _, pass) => { if (pass === 0) rows[1] = { ...rows[1] as object, chainId: "0x1" }; },
    (rows, _, pass) => { if (pass === 0) rows[1] = { ...rows[1] as object, from: target }; },
    (rows, _, pass) => { if (pass === 0) rows[1] = { ...rows[1] as object, to: owner }; },
    (rows, _, pass) => { if (pass === 0) rows[1] = { ...rows[1] as object, input: "0xdeadbeef" }; },
    (rows, _, pass) => { if (pass === 0) rows[1] = { ...rows[1] as object, value: "0x1" }; },
  ];
  for (const [index, mutate] of cases.entries()) {
    const f = await setup(mutate); t.after(f.cleanup);
    await assert.rejects(f.observer.observe(deposit), { code: index === 0 ? "APN_CHAIN_MISMATCH" : "APN_RPC_PROTOCOL" });
    assert.ok(f.posts() <= 2);
  }
});

test("malformed batch, timeout, terminal 429 and hard request cap cannot return proof", async t => {
  const malformed = await setup((rows, _, pass) => { if (pass === 0) rows.pop(); }); t.after(malformed.cleanup);
  await assert.rejects(malformed.observer.observe(deposit), { code: "APN_RPC_PROTOCOL" });
  assert.equal(malformed.posts(), 1);
  const limited = await setup(undefined, 1); t.after(limited.cleanup);
  await assert.rejects(limited.observer.observe(deposit), { code: "APN_RPC_BUDGET_EXCEEDED" });
  assert.equal(limited.posts(), 1);
  const temp = await temporaryState(); t.after(temp.cleanup);
  const state = new StateStore(temp.root); await state.initialize();
  let attempts = 0;
  for (const failure of [new ApnError("APN_RPC_AMBIGUOUS", "timeout"),
    new ApnError("APN_RPC_PROTOCOL", "rate limited", { httpStatus: 429 })]) {
    const observer = new RelayArbitrumSourceFinalityObserver("https://arb-rpc.publicnode.com", state,
      { batchCall: async () => { attempts++; throw failure; } });
    await assert.rejects(observer.observe(deposit), { code: failure.details?.httpStatus === 429 ? "APN_RPC_RATE_LIMITED" : "APN_RPC_AMBIGUOUS" });
  }
  assert.equal(attempts, 2);
});
