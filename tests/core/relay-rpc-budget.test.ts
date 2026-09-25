import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";
import { ApnError } from "../../src/errors.js";
import { RelayRpcInvocation } from "../../src/relay/rpc-budget.js";
import { StateStore } from "../../src/state.js";
import { temporaryState } from "./helpers.js";

const origin = "https://ethereum-rpc.publicnode.com";
const read = [{ method: "eth_chainId", params: [] }] as const;
const raw = `0x${"ab".repeat(40)}` as const;

test("24 physical POSTs include batches and raw sends; a 25th is refused before transport", async t => {
  const temp = await temporaryState(); t.after(temp.cleanup);
  const state = new StateStore(temp.root); await state.initialize();
  const starts: number[] = [];
  const transport = {
    batchCall: async () => { starts.push(Date.now()); return ["0x1"]; },
    submitRawTransaction: async () => { starts.push(Date.now()); return `0x${"aa".repeat(32)}` as const; },
  };
  const first = new RelayRpcInvocation(state, origin, transport);
  await first.rpc.batchCall(read);
  for (let index = 1; index < 24; index++) {
    if (index === 10 || index === 20) await first.rpc.submitRawTransaction(raw);
    else await first.rpc.batchCall(read);
  }
  assert.equal(starts.length, 24);
  for (let index = 1; index < starts.length; index++) assert.ok(starts[index]! - starts[index - 1]! >= 500);
  await assert.rejects(first.rpc.batchCall(read), { code: "APN_RPC_BUDGET_EXCEEDED" });
  assert.equal(starts.length, 24);
  const entries = await readdir(join(temp.root, "rpc-provider-pacing"));
  assert.equal(entries.length, 1);
  assert.match(entries[0]!, /^[a-f0-9]{64}\.json$/u);
  const persisted = await readFile(join(temp.root, "rpc-provider-pacing", entries[0]!), "utf8");
  assert.doesNotMatch(persisted + entries[0]!, /requestId|apiKey|ethereum-rpc|https:\/\//u);
});

test("concurrent runtime instances sharing state serialize POST starts", async t => {
  const temp = await temporaryState(); t.after(temp.cleanup);
  const state = new StateStore(temp.root); await state.initialize();
  const starts: number[] = [];
  const transport = { batchCall: async () => { starts.push(Date.now()); return ["0x1"]; },
    submitRawTransaction: async () => { starts.push(Date.now()); return `0x${"aa".repeat(32)}` as const; } };
  const left = new RelayRpcInvocation(state, origin, transport);
  const right = new RelayRpcInvocation(state, origin, transport);
  await Promise.all([left.rpc.batchCall(read), right.rpc.submitRawTransaction(raw)]);
  assert.equal(starts.length, 2);
  assert.ok(Math.abs(starts[1]! - starts[0]!) >= 500);
});

test("HTTP 429 is a single physical attempt with no automatic retry", async t => {
  const temp = await temporaryState(); t.after(temp.cleanup);
  const state = new StateStore(temp.root); await state.initialize();
  let attempts = 0;
  const transport = { batchCall: async () => { attempts++; throw new ApnError("APN_RPC_PROTOCOL", "Synthetic HTTP 429", { httpStatus: 429 }); },
    submitRawTransaction: async () => { attempts++; return `0x${"aa".repeat(32)}` as const; } };
  const invocation = new RelayRpcInvocation(state, origin, transport);
  await assert.rejects(invocation.rpc.batchCall(read), { code: "APN_RPC_RATE_LIMITED" });
  assert.equal(attempts, 1);
});

test("contended persistent provider lock refuses before transport", async t => {
  const temp = await temporaryState(); t.after(temp.cleanup);
  const holder = new StateStore(temp.root); await holder.initialize();
  const contender = new StateStore(temp.root, { lockWaitMs: 0 });
  let entered!: () => void, release!: () => void;
  const active = new Promise<void>(resolve => { entered = resolve; });
  const held = new Promise<void>(resolve => { release = resolve; });
  const familyHash = (await readdir(join(temp.root, "rpc-provider-pacing"))).length;
  assert.equal(familyHash, 0);
  const { sha256 } = await import("../../src/canonical.js");
  const lockKey = `rpc-provider-family:${sha256("rpc-provider-family\0publicnode.com")}`;
  const holding = holder.withLocks([lockKey], async () => { entered(); await held; });
  await active;
  let attempts = 0;
  const invocation = new RelayRpcInvocation(contender, origin, {
    batchCall: async () => { attempts++; return ["0x1"]; },
    submitRawTransaction: async () => { attempts++; return `0x${"aa".repeat(32)}` as const; },
  });
  try { await assert.rejects(invocation.rpc.batchCall(read), { code: "APN_STATE_BUSY" }); }
  finally { release(); await holding; }
  assert.equal(attempts, 0);
});
