import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import type { ClientRequest, IncomingMessage } from "node:http";
import type { request } from "node:https";
import test from "node:test";
import { ApnError } from "../../src/errors.js";
import { createTronHttpsFetch } from "../../src/tron/https.js";
import { TronRpc } from "../../src/tron/rpc.js";

function offline(interval?: string, dns?: (call: number) => Promise<void>, failWait?: (count: number) => boolean,
  customWait?: (signal: AbortSignal) => Promise<void>) {
  let now = 0, dnsCalls = 0, waitCalls = 0;
  const starts: number[] = [], waits: number[] = [];
  const requestHttps = ((_url: URL, _options: unknown, receive: (incoming: IncomingMessage) => void) => {
    starts.push(now);
    const outgoing = new EventEmitter() as ClientRequest;
    outgoing.destroy = (() => outgoing) as ClientRequest["destroy"];
    outgoing.end = (() => {
      queueMicrotask(() => {
        const incoming = new EventEmitter() as IncomingMessage;
        incoming.statusCode = 200;
        incoming.headers = { "content-type": "application/json", "content-length": "2" };
        incoming.destroy = (() => incoming) as IncomingMessage["destroy"];
        receive(incoming);
        queueMicrotask(() => { incoming.emit("data", Buffer.from("{}")); incoming.emit("end"); });
      });
      return outgoing;
    }) as ClientRequest["end"];
    return outgoing;
  }) as unknown as typeof request;
  const resolve = (async () => {
    dnsCalls++;
    await dns?.(dnsCalls);
    return [{ address: "8.8.8.8", family: 4 as const }];
  }) as Parameters<typeof createTronHttpsFetch>[1];
  const fetcher = createTronHttpsFetch(requestHttps, resolve, { minimumPostStartIntervalMs: interval,
    now: () => now, wait: async (milliseconds, signal) => {
      waitCalls++; waits.push(milliseconds);
      if (failWait?.(waitCalls)) throw new Error("private-wait-canary");
      if (customWait !== undefined) { await customWait(signal); return; }
      await new Promise<void>((done) => setImmediate(done));
      now += milliseconds;
    } });
  return { rpc: new TronRpc("https://rpc.example/private-url-canary", fetcher), fetcher, starts, waits,
    setNow: (value: number) => { now = value; }, dnsCalls: () => dnsCalls };
}

test("optional TRON pacing starts exactly ten physical POSTs one second apart", async () => {
  const { rpc, starts, waits } = offline("1000");
  for (let i = 0; i < 10; i++) await rpc.call("wallet/getaccount", { address: String(i) });
  assert.deepEqual(starts, Array.from({ length: 10 }, (_, i) => i * 1_000));
  assert.deepEqual(waits, Array(9).fill(1_000));
});

test("concurrent TRON calls serialize physical POST starts without adding requests", async () => {
  const { rpc, starts } = offline("1000");
  await Promise.all(Array.from({ length: 10 }, (_, i) => rpc.call("wallet/getaccount", { address: String(i) })));
  assert.deepEqual(starts, Array.from({ length: 10 }, (_, i) => i * 1_000));
});

test("variable DNS completion cannot bunch or reorder physical POST starts", async () => {
  let releaseFirst!: () => void;
  const firstDns = new Promise<void>((resolve) => { releaseFirst = resolve; });
  const { rpc, starts, waits, setNow } = offline("1000", async (call) => { if (call === 1) await firstDns; });
  const first = rpc.call("wallet/getaccount", { address: "first" });
  await new Promise<void>((resolve) => setImmediate(resolve));
  setNow(1_000);
  await rpc.call("wallet/getaccount", { address: "second" });
  assert.deepEqual(starts, [1_000]);
  setNow(1_200);
  releaseFirst();
  await first;
  assert.deepEqual(waits, [800]);
  assert.deepEqual(starts, [1_000, 2_000]);
});

test("unset and zero pacing preserve unpaced physical POSTs", async () => {
  for (const interval of [undefined, "0"]) {
    const { rpc, starts, waits } = offline(interval);
    await Promise.all(Array.from({ length: 10 }, () => rpc.call("wallet/getaccount", {})));
    assert.deepEqual(starts, Array(10).fill(0));
    assert.deepEqual(waits, []);
  }
});

test("invalid TRON pacing fails before DNS or POST and reveals no setting text", async () => {
  for (const interval of ["", "00", "01", "-1", "1.5", "1001", "9999", "private-token-canary"]) {
    const { rpc, starts, dnsCalls } = offline(interval);
    await assert.rejects(rpc.call("wallet/getaccount", {}), (error: unknown) => {
      assert.ok(error instanceof ApnError);
      assert.equal(error.code, "APN_RPC_CONFIG");
      if (interval !== "") assert.equal(JSON.stringify(error).includes(interval), false);
      return true;
    });
    assert.equal(dnsCalls(), 0);
    assert.deepEqual(starts, []);
  }
});

test("interrupted physical-start wait refuses POST with a sanitized error and releases the queue", async () => {
  const { rpc, starts } = offline("1000", undefined, (count) => count === 1);
  await rpc.call("wallet/getaccount", {});
  await assert.rejects(rpc.call("wallet/getaccount", {}), (error: unknown) => {
    assert.ok(error instanceof ApnError);
    assert.equal(error.code, "APN_RPC_PROTOCOL");
    assert.deepEqual(error.details, { reason: "pacing_deadline", rpcMethod: "wallet/getaccount" });
    assert.equal(JSON.stringify(error).includes("private-"), false);
    return true;
  });
  assert.equal(starts.length, 1);
  await rpc.call("wallet/getaccount", {});
  assert.deepEqual(starts, [0, 1_000]);
});

test("deadline cancellation during pacing never opens a physical POST", async () => {
  const { rpc, fetcher, starts } = offline("1000", undefined, undefined, async (signal) => await new Promise<void>((_resolve, reject) => {
    signal.addEventListener("abort", () => reject(new Error("private-abort-canary")), { once: true });
  }));
  await rpc.call("wallet/getaccount", {});
  const controller = new AbortController();
  const pending = fetcher(new URL("https://rpc.example/private-url-canary/wallet/getaccount"), { body: "{}", signal: controller.signal });
  await new Promise<void>((resolve) => setImmediate(resolve));
  controller.abort();
  await assert.rejects(pending, (error: unknown) => {
    assert.ok(error instanceof ApnError);
    assert.equal(error.code, "APN_RPC_PROTOCOL");
    assert.deepEqual(error.details, { reason: "pacing_deadline" });
    assert.equal(JSON.stringify(error).includes("private-"), false);
    return true;
  });
  assert.deepEqual(starts, [0]);
});
