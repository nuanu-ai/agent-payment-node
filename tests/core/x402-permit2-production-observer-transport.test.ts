import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import dns from "node:dns/promises";
import https from "node:https";
import { syncBuiltinESMExports } from "node:module";
import test from "node:test";
import { HttpsBaseRpc } from "../../src/rpc.js";
import { StateStore } from "../../src/state.js";
import { observePermit2Production } from "../../src/x402-permit2/production-observer.js";
import { Permit2ObserverRpc } from "../../src/x402-permit2/production-observer-rpc.js";
import { observerFixture } from "./x402-permit2-production-observer-fixture.js";

const flush = async () => await new Promise<void>(resolve => setImmediate(resolve));

test("observer deadline includes unresolved DNS and late public resolution cannot construct HTTPS", async t => {
  const f = await observerFixture(t); (f.input as { mode: string }).mode = "expired_unused";
  let release!: (value: { address: string; family: number }[]) => void, lookups = 0, constructed = 0;
  t.mock.method(dns, "lookup", () => { lookups++; return new Promise(resolve => { release = resolve; }); });
  t.mock.method(https, "request", () => { constructed++; throw new Error("unexpected HTTPS construction"); });
  syncBuiltinESMExports();
  t.mock.timers.enable({ apis: ["setTimeout"] });
  let returned: Awaited<ReturnType<typeof observePermit2Production>> | undefined;
  const pending = observePermit2Production({ ...f.input, rpcUrl: "https://rpc.example/private", signed: null,
    mode: "expired_unused", locator: null }).then(result => { returned = result; return result; });
  assert.equal(lookups, 1);
  t.mock.timers.tick(20_000); await flush();
  const heldBeforeResolution = returned?.projection.outcome === "hold";
  // Always release the owned mocked lookup, including on baseline, so a failed regression leaves no suspended work.
  release([{ address: "8.8.8.8", family: 4 }]);
  const result = await pending; await flush();
  assert.equal(heldBeforeResolution, true, "deadline must return HOLD before DNS resolves");
  assert.equal(result.proof, null); assert.equal(constructed, 0); assert.equal(lookups, 1);
  assert.equal(result.projection.rpc.physicalDispatches, 0); assert.equal(result.projection.rpc.errors, 1);
});

test("ordinary public hostname retains DNS validation and original finite batch sequence", async t => {
  const f = await observerFixture(t); let lookups = 0;
  t.mock.method(dns, "lookup", async () => { lookups++; return [{ address: "8.8.8.8", family: 4 }]; });
  syncBuiltinESMExports();
  const result = await observePermit2Production({ ...f.input, rpcUrl: "https://rpc.example/private" });
  assert.equal(result.projection.outcome, "settled"); assert.equal(lookups, 1); assert.equal(f.batches.length, 4);
});

test("hostname with nonpublic DNS result holds before HTTPS construction", async t => {
  const f = await observerFixture(t);
  t.mock.method(dns, "lookup", async () => [{ address: "127.0.0.1", family: 4 }]); syncBuiltinESMExports();
  const result = await observePermit2Production({ ...f.input, rpcUrl: "https://rpc.example/private" });
  assert.equal(result.projection.outcome, "hold"); assert.equal(result.projection.rpc.physicalDispatches, 0); assert.equal(f.batches.length, 0);
});

test("already closed observer transport aborts before dispatch", async t => {
  const f = await observerFixture(t), rpc = new Permit2ObserverRpc(f.input.rpcUrl, new StateStore(f.input.stateRoot));
  rpc.close(); await assert.rejects(rpc.batch([{ method: "eth_chainId", params: [] }]));
  assert.equal(rpc.metrics().physicalDispatches, 0); assert.equal(rpc.metrics().errors, 1); assert.equal(f.batches.length, 0);
});

test("synchronous HTTPS constructor throw is admitted but not physically constructed", async t => {
  const f = await observerFixture(t); let constructionAttempts = 0;
  t.mock.method(https, "request", () => { constructionAttempts++; throw new Error("fixture constructor failure"); }); syncBuiltinESMExports();
  const result = await observePermit2Production(f.input);
  assert.equal(result.projection.outcome, "hold"); assert.equal(constructionAttempts, 1);
  assert.equal(result.projection.rpc.attempts, 1); assert.equal(result.projection.rpc.admissions, 1);
  assert.equal(result.projection.rpc.physicalDispatches, 0); assert.equal(result.projection.rpc.errors, 1);
});

test("asynchronous transport failure after HTTPS construction counts one physical request without retry", async t => {
  const f = await observerFixture(t); let constructed = 0;
  t.mock.method(https, "request", () => {
    constructed++;
    const request = new EventEmitter() as any; request.setTimeout = () => request;
    request.end = () => { queueMicrotask(() => request.emit("error", new Error("fixture async failure"))); return request; };
    return request;
  }); syncBuiltinESMExports();
  const result = await observePermit2Production(f.input);
  assert.equal(result.projection.outcome, "hold"); assert.equal(constructed, 1);
  assert.equal(result.projection.rpc.attempts, 1); assert.equal(result.projection.rpc.admissions, 1);
  assert.equal(result.projection.rpc.physicalDispatches, 1); assert.equal(result.projection.rpc.errors, 1);
});

for (const stage of ["read", "write"] as const) test(`whole observer deadline includes gated pacing ${stage} without late admission`, async t => {
  const f = await observerFixture(t); (f.input as { mode: string }).mode = "expired_unused";
  let release!: () => void, entered!: () => void, completed!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  const gated = new Promise<void>(resolve => { entered = resolve; });
  const finished = new Promise<void>(resolve => { completed = resolve; });
  let actualRpc: HttpsBaseRpc | undefined, unhandled = 0;
  const onUnhandled = () => { unhandled++; }; process.on("unhandledRejection", onUnhandled);
  t.after(() => process.removeListener("unhandledRejection", onUnhandled));
  const originalBatch = HttpsBaseRpc.prototype.batchCall;
  t.mock.method(HttpsBaseRpc.prototype, "batchCall", function(this: HttpsBaseRpc, calls: Parameters<typeof originalBatch>[0]) {
    actualRpc = this;
    return originalBatch.call(this, calls).then(result => { completed(); return result; }, error => { completed(); throw error; });
  });
  if (stage === "read") {
    const original = StateStore.prototype.loadRpcProviderPacing;
    t.mock.method(StateStore.prototype, "loadRpcProviderPacing", async function(this: StateStore, family: string) {
      entered(); await gate; return await original.call(this, family);
    });
  } else {
    const original = StateStore.prototype.writeRpcProviderCooldown;
    t.mock.method(StateStore.prototype, "writeRpcProviderCooldown", async function(this: StateStore, family: string, until: number) {
      entered(); await gate; await original.call(this, family, until);
    });
  }
  t.mock.timers.enable({ apis: ["setTimeout"] });
  let returned: Awaited<ReturnType<typeof observePermit2Production>> | undefined;
  const pending = observePermit2Production({ ...f.input, signed: null, mode: "expired_unused", locator: null })
    .then(result => { returned = result; return result; });
  await gated;
  t.mock.timers.tick(20_000); await flush();
  const heldBeforeRelease = returned?.projection.outcome === "hold";
  const constructedAtDeadline = f.batches.length;
  // Let owned durable work finish before temp-state cleanup, including when exercising the old baseline.
  release(); const result = await pending; await finished; await flush();
  assert.equal(heldBeforeRelease, true, "shared deadline must return HOLD while pacing I/O is still gated");
  assert.equal(constructedAtDeadline, 0);
  assert.equal(result.proof, null); assert.equal(result.projection.rpc.physicalDispatches, 0);
  assert.equal(result.projection.rpc.errors, 1); assert.equal(f.batches.length, 0);
  assert.ok(actualRpc); assert.equal(actualRpc.observationMetrics.admissions, 0);
  assert.equal(actualRpc.observationMetrics.physicalDispatches, 0); assert.equal(unhandled, 0);
});
