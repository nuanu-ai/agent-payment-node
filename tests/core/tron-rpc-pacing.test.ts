import assert from "node:assert/strict";
import test from "node:test";
import { ApnError } from "../../src/errors.js";
import { TronRpc } from "../../src/tron/rpc.js";

function offline(interval?: string) {
  let now = 0;
  const starts: number[] = [], waits: number[] = [];
  const fetcher = (async () => {
    starts.push(now);
    return new Response("{}", { headers: { "content-type": "application/json" } });
  }) as typeof fetch;
  const rpc = new TronRpc("https://rpc.example", fetcher, { minimumPostStartIntervalMs: interval,
    now: () => now, wait: async (milliseconds) => { waits.push(milliseconds); await new Promise<void>((resolve) => setImmediate(resolve)); now += milliseconds; } });
  return { rpc, starts, waits };
}

test("optional TRON pacing starts exactly ten sequential POSTs one second apart", async () => {
  const { rpc, starts, waits } = offline("1000");
  for (let i = 0; i < 10; i++) await rpc.call("wallet/getaccount", { address: String(i) });
  assert.deepEqual(starts, Array.from({ length: 10 }, (_, i) => i * 1_000));
  assert.deepEqual(waits, Array(9).fill(1_000));
});

test("concurrent TRON calls serialize POST starts without adding requests", async () => {
  const { rpc, starts } = offline("1000");
  await Promise.all(Array.from({ length: 10 }, (_, i) => rpc.call("wallet/getaccount", { address: String(i) })));
  assert.deepEqual(starts, Array.from({ length: 10 }, (_, i) => i * 1_000));
});

test("unset and zero pacing preserve unpaced POSTs", async () => {
  for (const interval of [undefined, "0"]) {
    const { rpc, starts, waits } = offline(interval);
    await Promise.all(Array.from({ length: 10 }, () => rpc.call("wallet/getaccount", {})));
    assert.deepEqual(starts, Array(10).fill(0));
    assert.deepEqual(waits, []);
  }
});

test("invalid TRON pacing fails before POST and reveals no setting text", async () => {
  for (const interval of ["", "00", "01", "-1", "1.5", "1001", "9999", "private-token-canary"]) {
    const { rpc, starts } = offline(interval);
    await assert.rejects(rpc.call("wallet/getaccount", {}), (error: unknown) => {
      assert.ok(error instanceof ApnError);
      assert.equal(error.code, "APN_RPC_CONFIG");
      if (interval !== "") assert.equal(JSON.stringify(error).includes(interval), false);
      return true;
    });
    assert.deepEqual(starts, []);
  }
});

test("interrupted pacing refuses the next POST with a sanitized error and releases the queue", async () => {
  let now = 0, calls = 0, waits = 0;
  const fetcher = (async () => { calls++; return new Response("{}", { headers: { "content-type": "application/json" } }); }) as typeof fetch;
  const rpc = new TronRpc("https://rpc.example/private-url-canary", fetcher, { minimumPostStartIntervalMs: "1000",
    now: () => now, wait: async (milliseconds) => { waits++; if (waits === 1) throw new Error("private-error-canary"); now += milliseconds; } });
  await rpc.call("wallet/getaccount", {});
  await assert.rejects(rpc.call("wallet/getaccount", {}), (error: unknown) => {
    assert.ok(error instanceof ApnError);
    assert.equal(error.code, "APN_RPC_PROTOCOL");
    assert.deepEqual(error.details, { reason: "pacing_deadline", rpcMethod: "wallet/getaccount" });
    assert.equal(JSON.stringify(error).includes("private-"), false);
    return true;
  });
  assert.equal(calls, 1);
  await rpc.call("wallet/getaccount", {});
  assert.equal(calls, 2);
  assert.equal(now, 1_000);
});
