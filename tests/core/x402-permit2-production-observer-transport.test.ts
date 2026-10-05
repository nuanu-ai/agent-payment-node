import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import dns from "node:dns/promises";
import https from "node:https";
import { syncBuiltinESMExports } from "node:module";
import test from "node:test";
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
