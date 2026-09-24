import assert from "node:assert/strict";
import test from "node:test";
import { UsdtCommandReadBudget } from "../../src/gasless-usdt/command-prepare.js";
import type { GaslessTransport } from "../../src/gasless/https.js";
import { StateStore } from "../../src/state.js";
import { temporaryState } from "./helpers.js";

const ENDPOINT = "https://public.pimlico.io/v2/1/rpc";

test("gasless USDT physical reads persist the public Pimlico 20/min family gap across sessions and stop at seven", async t => {
  const temporary = await temporaryState(); t.after(temporary.cleanup);
  let now = 1_000, attempts = 0;
  const starts: number[] = [], waits: number[] = [];
  const transport: GaslessTransport = { request: async () => { starts.push(now); attempts += 1; return { status: 200, body: "{}" }; } };
  const state = new StateStore(temporary.root), clock = () => now, wait = async (milliseconds: number) => {
    waits.push(milliseconds); now += milliseconds;
  };
  const first = new UsdtCommandReadBudget(state, transport, clock, wait);
  await first.request(ENDPOINT, "POST", "{}", 1024, "APN_RPC_CONFIG");
  const sibling = new UsdtCommandReadBudget(state, transport, clock, wait);
  await sibling.request(ENDPOINT, "POST", "{}", 1024, "APN_RPC_CONFIG");
  assert.deepEqual(starts, [1_000, 4_000]);
  assert.deepEqual(waits, [3_000]);
  for (let index = 1; index < 7; index += 1) await sibling.request(ENDPOINT, "POST", "{}", 1024, "APN_RPC_CONFIG");
  assert.equal(sibling.count(), 7);
  assert.equal(attempts, 8);
  await assert.rejects(() => sibling.request(ENDPOINT, "POST", "{}", 1024, "APN_RPC_CONFIG"),
    { code: "APN_RPC_CONFIG" });
  assert.equal(attempts, 8);
  assert.equal(starts.every((value, index) => index === 0 || value - starts[index - 1]! >= 3_000), true);
});

test("gasless USDT 429 cooldown and total deadline refuse before another transport attempt", async t => {
  const temporary = await temporaryState(); t.after(temporary.cleanup);
  let now = 1_000, attempts = 0;
  const transport: GaslessTransport = { request: async () => { attempts += 1; return { status: 429, body: "" }; } };
  const state = new StateStore(temporary.root), clock = () => now, wait = async (milliseconds: number) => { now += milliseconds; };
  const first = new UsdtCommandReadBudget(state, transport, clock, wait);
  await assert.rejects(() => first.request(ENDPOINT, "POST", "{}", 1024, "APN_RPC_CONFIG"));
  const second = new UsdtCommandReadBudget(state, transport, clock, wait);
  await assert.rejects(() => second.request(ENDPOINT, "POST", "{}", 1024, "APN_RPC_CONFIG"),
    { code: "APN_PROVIDER_UNAVAILABLE" });
  assert.equal(attempts, 1);
  now += 60_001;
  await assert.rejects(() => second.request(ENDPOINT, "POST", "{}", 1024, "APN_RPC_CONFIG"),
    { code: "APN_RPC_AMBIGUOUS" });
  assert.equal(attempts, 1);
});
