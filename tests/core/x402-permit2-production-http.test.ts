import assert from "node:assert/strict";
import dns from "node:dns/promises";
import { EventEmitter } from "node:events";
import https from "node:https";
import { syncBuiltinESMExports } from "node:module";
import { performance } from "node:perf_hooks";
import test, { type TestContext } from "node:test";
import { setImmediate as nextTurn } from "node:timers/promises";
import { StateStore } from "../../src/state.js";
import { AllowlistPolicyStore } from "../../src/allowlist-policy-store.js";
import { walletCustodyLock } from "../../src/encrypted-wallet-store.js";
import { Permit2ProductionSigningFence } from "../../src/x402-permit2/production-signing-fence.js";
import { Permit2ProductionJournal } from "../../src/x402-permit2/production-journal.js";
import { sendPermit2Production } from "../../src/x402-permit2/production-send.js";
import { productionUsageIdentity } from "../../src/x402-permit2/production-repository.js";
import { paidHttpFixture } from "./x402-permit2-production-http-fixture.js";
import { protocolSecond } from "./x402-permit2-production-protocol-fixture.js";

async function until(predicate: () => boolean) { const deadline = Date.now() + 10_000; while (!predicate() && Date.now() < deadline) await nextTurn(); assert.ok(predicate(), "synthetic stage reached"); }
function wire(t: TestContext) {
  const requests: any[] = []; let rows = [{ address: "8.8.8.8", family: 4 }], delayed: (() => void) | undefined;
  let pause = false, calls = 0, afterDns: (() => Promise<void>) | undefined;
  t.mock.method(dns, "lookup", async () => { calls++; if (pause) await new Promise<void>(resolve => { delayed = resolve; }); await afterDns?.(); return rows; });
  t.mock.method(https, "request", (endpoint: URL, options: any, callback: (r: any) => void) => {
    const req = new EventEmitter() as any, socket = new EventEmitter() as any;
    socket.authorized = true; socket.remoteAddress = "8.8.8.8";
    const entry = { endpoint, options, req, socket, ends: 0, destroyed: 0, body: undefined as any,
      tls() { req.emit("socket", socket); socket.emit("secureConnect"); },
      respond(statusCode = 200, rawHeaders: string[] = [], rawTrailers: string[] = [], body = Buffer.from("{}")) {
        const response = new EventEmitter() as any;
        Object.assign(response, { statusCode, rawHeaders, rawTrailers, socket, destroy() {} }); callback(response);
        response.emit("data", body); response.emit("end");
      } };
    req.destroy = () => { entry.destroyed++; queueMicrotask(() => req.emit("error", new Error("synthetic-private-error"))); };
    req.end = (body: any) => { entry.ends++; entry.body = body; }; requests.push(entry); return req;
  });
  syncBuiltinESMExports(); t.after(() => { t.mock.restoreAll(); syncBuiltinESMExports(); });
  return { requests, calls: () => calls, pauseDns() { pause = true; }, releaseDns() { pause = false; delayed?.(); },
    rows(value: typeof rows) { rows = value; }, afterDns(value: () => Promise<void>) { afterDns = value; } };
}
function clock(t: TestContext) {
  let ms = 0; const pending: Array<{ at: number; fired: boolean; action: () => void }> = [], original = globalThis.setTimeout;
  t.mock.method(performance, "now", () => ms);
  // Only the actual native's 20000ms budget is deterministic. Kernel lock acquisition/retry timers stay real.
  t.mock.method(globalThis, "setTimeout", (action: (...args: any[]) => void, delay?: number, ...args: any[]) => {
    if (delay !== 20_000) return original(action, delay, ...args);
    pending.push({ at: ms + delay, fired: false, action: () => action(...args) }); return {} as ReturnType<typeof setTimeout>;
  });
  return { tick(value: number) { ms += value; for (const task of pending) if (!task.fired && task.at <= ms) { task.fired = true; task.action(); } },
    elapse(value: number) { ms += value; } };
}
async function first(t: TestContext, maxTimeoutSeconds = 120) { const f = await paidHttpFixture(t, "sign-and-submit-once", false, maxTimeoutSeconds);
  return { ...f, submit: () => f.send() }; }
async function held(f: Awaited<ReturnType<typeof first>>) { const r = (await f.records.findOperation(f.id))!;
  assert.equal(r.state, "request_pending"); assert.equal(r.exposureJournal!.request!.attempt, 1); assert.equal((await f.lease()).state, "unknown_finality"); }
/** A later send after the one attempt: refused, or status only; either way nothing is sent. */
async function resend(f: Awaited<ReturnType<typeof first>>) { await f.submit().then(r => assert.equal(r.outcome, null), () => undefined); }

test("actual paid first grant sends exactly stored request/header once only after authorized pinned TLS; no custody crypto or RPC", async t => {
  const f = await first(t), mock = wire(t), before = [f.keys(), f.signatures(), f.batches.length], saved = (await f.records.findOperation(f.id))!;
  const pending = f.submit(); await until(() => mock.requests.length === 1); const sent = mock.requests[0]; assert.equal(sent.ends, 0);
  sent.tls(); await until(() => sent.ends === 1);
  const request = saved.material.checked.request;
  assert.equal(sent.endpoint.toString(), request.url); assert.equal(sent.options.method, request.method);
  assert.equal(sent.options.headers["PAYMENT-SIGNATURE"], saved.exposureJournal!.signed!.paymentSignatureHeader);
  for (const [key, value] of Object.entries(request.headers)) assert.equal(sent.options.headers[key], value);
  assert.deepEqual(sent.body, request.bodyBase64 === null ? undefined : Buffer.from(request.bodyBase64, "base64"));
  assert.equal(sent.options.rejectUnauthorized, true); assert.ok(sent.options.ca.length); assert.equal(sent.options.agent, false);
  let pin: unknown[] = []; sent.options.lookup("seller.example", {}, (...args: unknown[]) => { pin = args; }); assert.deepEqual(pin, [null, "8.8.8.8", 4]);
  sent.respond(200, ["payment-response", "untrusted-hint"]); const result = await pending;
  assert.equal(result.outcome?.kind, "observed"); if (result.outcome?.kind === "observed") assert.equal(result.outcome.observation.status, 200);
  assert.deepEqual([f.keys(), f.signatures(), f.batches.length], before); await held(f); await resend(f); assert.equal(mock.requests.length, 1);
});

// Since 0.5.53 the generic x402 transport carries Permit2 PAYMENT-SIGNATURE headers for `x402 fetch`; the production
// lane's single request stays bound to its own journal, fence and approval, which is what this test proves.
test("a changed origin cannot mark or send", async t => {
  const f = await first(t), mock = wire(t), origin = f.signed.origin, other = "f".repeat(64);
  for (const changed of [{ ...origin, signedHash: other }, { ...origin, leaseDigest: other }, { ...origin, approval: { ...origin.approval, completedAt: 0 } }])
    await assert.rejects(sendPermit2Production(f.journal, f.fence, changed, f.now));
  assert.equal(mock.requests.length, 0); assert.equal(mock.calls(), 0); assert.equal((await f.records.findOperation(f.id))!.exposureJournal!.request, null);
});
for (const binding of ["id", "root", "fence"] as const) test(`wrong ${binding} refuses before the marker without HTTPS`, async t => {
  const f = await first(t), mock = wire(t), origin = f.signed.origin;
  const journal = binding === "root" ? { root: `${f.root}/wrong` } as Permit2ProductionJournal : f.journal;
  const fence = binding === "fence" ? new Permit2ProductionSigningFence(`${f.root}/wrong`, f.input.rpcUrl, f.now) : f.fence;
  await assert.rejects(sendPermit2Production(journal, fence, binding === "id" ? { ...origin, approval: { ...origin.approval, operationId: "f".repeat(64) } } : origin, f.now));
  assert.equal(mock.requests.length, 0); assert.equal((await f.records.findOperation(f.id))!.exposureJournal!.request, null);
});
test("another journal instance of the same state sends the same single attempt", async t => {
  const f = await first(t), mock = wire(t);
  const pending = sendPermit2Production(new Permit2ProductionJournal(f.root, f.preparation, f.now), f.fence, f.signed.origin, f.now);
  await until(() => mock.requests.length === 1); const sent = mock.requests[0]; sent.tls(); await until(() => sent.ends === 1); sent.respond();
  assert.equal((await pending).outcome?.kind, "observed"); await resend(f); assert.equal(mock.requests.length, 1); await held(f);
});
test("a sign-only origin cannot mark or make any dedicated HTTPS request", async t => {
  const f = await paidHttpFixture(t, "sign-only"), mock = wire(t); await assert.rejects(f.send()); assert.equal(mock.requests.length, 0);
  assert.equal((await f.records.findOperation(f.id))!.exposureJournal!.request, null);
});
test("an expired original approval refuses before the marker and sends nothing", async t => {
  const f = await first(t), mock = wire(t); f.advance(63); await assert.rejects(f.submit());
  assert.equal(mock.requests.length, 0); assert.equal((await f.records.findOperation(f.id))!.exposureJournal!.request, null);
  assert.equal((await f.lease()).state, "unknown_finality");
});
for (const fault of ["private-dns", "policy", "lease", "ui-expiry", "deadline"] as const) test(`after DNS ${fault} denies construction with durable attempt1`, async t => {
  const f = await first(t), mock = wire(t), timer = clock(t);
  let dnsFinished = false;
  if (fault === "policy") {
    const store = new AllowlistPolicyStore(f.root), active = await store.read("owner"); await f.revoke();
    const original = AllowlistPolicyStore.prototype.readUnderProfileLock;
    // Hold the real active snapshot through admission; the post-DNS read sees the real revoked disk state.
    t.mock.method(AllowlistPolicyStore.prototype, "readUnderProfileLock", async function(this: AllowlistPolicyStore, profile: string) {
      return dnsFinished ? original.call(this, profile) : active;
    });
  }
  if (fault === "private-dns") mock.rows([{ address: "8.8.8.8", family: 4 }, { address: "127.0.0.1", family: 4 }]);
  mock.afterDns(async () => {
    if (fault === "ui-expiry") f.advance(63); if (fault === "deadline") timer.elapse(20_000);
    dnsFinished = true;
    if (fault === "lease") await f.usage.transition({ ...productionUsageIdentity(f.record), reservationId: f.record.usageReservationId,
      policyDigest: f.record.material.owner.policyDigest, state: "finalized", outcomeDigest: "e".repeat(64), expectedCurrentStates: ["unknown_finality"], now: f.now() });
  });
  const result = await f.submit(); assert.equal(result.outcome?.kind, "held"); assert.equal(mock.requests.length, 0); await resend(f);
  if (fault !== "lease") await held(f);
});
for (const fault of ["unauthorized", "ip", "ui-expiry", "deadline"] as const) test(`TLS ${fault} never ends payment request`, async t => {
  const f = await first(t), mock = wire(t), timer = clock(t), pending = f.submit(); await until(() => mock.requests.length === 1); const sent = mock.requests[0];
  if (fault === "unauthorized") sent.socket.authorized = false; if (fault === "ip") sent.socket.remoteAddress = "1.1.1.1";
  if (fault === "ui-expiry") f.advance(63); if (fault === "deadline") timer.elapse(20_000);
  sent.tls(); assert.equal((await pending).outcome?.kind, "held"); assert.equal(sent.ends, 0); await held(f); await resend(f);
});
test("20000ms deadline returns held while delayed genuine TLS owner drains under custody lock; no late end/replay", async t => {
  const f = await first(t), mock = wire(t), timer = clock(t), pending = f.submit(); await until(() => mock.requests.length === 1);
  let release!: () => void, entered = false, acquired = false;
  const original = StateStore.prototype.loadWalletArtifacts;
  const blocker = t.mock.method(StateStore.prototype, "loadWalletArtifacts", async function(this: StateStore, ...args: Parameters<typeof original>) {
    entered = true; await new Promise<void>(resolve => { release = resolve; }); return original.apply(this, args);
  });
  const sent = mock.requests[0]; sent.tls(); await until(() => entered);
  const contender = f.state.withLocks([walletCustodyLock(f.state, "owner")], async () => { acquired = true; });
  timer.tick(20_000); assert.equal((await pending).outcome?.kind, "held"); await nextTurn(); assert.equal(acquired, false); assert.equal(sent.ends, 0);
  release(); await contender; assert.equal(acquired, true); assert.equal(sent.ends, 0);
  blocker.mock.restore(); await resend(f); assert.equal(mock.requests.length, 1); await held(f);
});
test("20000ms timeout after one end remains held attempt1 and cannot issue a second constructor", async t => {
  const f = await first(t), mock = wire(t), timer = clock(t), pending = f.submit(); await until(() => mock.requests.length === 1);
  const sent = mock.requests[0]; sent.tls(); await until(() => sent.ends === 1); timer.tick(20_000);
  assert.equal((await pending).outcome?.kind, "held"); sent.respond(); await nextTurn(); assert.equal(sent.ends, 1); assert.ok(sent.destroyed);
  await resend(f); assert.equal(mock.requests.length, 1); await held(f);
});
test("20000ms late DNS cannot construct after caller returns held or release custody before its read drains", async t => {
  const f = await first(t), mock = wire(t), timer = clock(t); mock.pauseDns(); const pending = f.submit(); await until(() => mock.calls() === 1);
  let acquired = false; const contender = f.state.withLocks([walletCustodyLock(f.state, "owner")], async () => { acquired = true; });
  timer.tick(20_000); assert.equal((await pending).outcome?.kind, "held"); await nextTurn(); assert.equal(acquired, false); assert.equal(mock.requests.length, 0);
  mock.releaseDns(); await contender; assert.equal(acquired, true); assert.equal(mock.requests.length, 0); await resend(f); await held(f);
});
test("TLS signing deadline expires at31000ms while original UI remains within60000ms; zero end", async t => {
  const f = await first(t, 30), mock = wire(t), pending = f.submit(); await until(() => mock.requests.length === 1);
  const sent = mock.requests[0]; f.advance(32); sent.tls(); assert.equal((await pending).outcome?.kind, "held"); assert.equal(sent.ends, 0); await held(f);
});
test("TLS policy expiry at21000ms denies end using genuine captured policy while UI/signature stay live", async t => {
  const f = await paidHttpFixture(t, "sign-and-submit-once", false, 120, new Date((protocolSecond + 20) * 1000).toISOString());
  const mock = wire(t);
  const pending = f.send(); await until(() => mock.requests.length === 1);
  const sent = mock.requests[0]; f.advance(22); sent.tls(); assert.equal((await pending).outcome?.kind, "held"); assert.equal(sent.ends, 0);
  assert.equal((await f.records.findOperation(f.id))!.exposureJournal!.request!.attempt, 1);
});
for (const fault of ["duplicate", "alias", "folded", "trailer", "redirect"] as const) test(`response ${fault} cannot become payment proof or trigger another attempt`, async t => {
  const f = await first(t), mock = wire(t), pending = f.submit(); await until(() => mock.requests.length === 1); const sent = mock.requests[0]; sent.tls(); await until(() => sent.ends === 1);
  const headers = fault === "duplicate" ? ["payment-response", "a", "Payment-Response", "b"] : fault === "alias" ? ["payment-response", "a", "x-payment-response", "b"] : fault === "folded" ? ["payment-response", "a,b"] : [];
  sent.respond(fault === "redirect" ? 302 : 200, headers, fault === "trailer" ? ["payment-response", "a"] : []);
  assert.equal((await pending).outcome?.kind, "held"); await held(f); await resend(f); assert.equal(mock.requests.length, 1);
});
test("paid HTTP402 remains an untrusted observation with attempt1 held and no challenge retry", async t => {
  const f = await first(t), mock = wire(t), pending = f.submit(); await until(() => mock.requests.length === 1);
  const sent = mock.requests[0]; sent.tls(); await until(() => sent.ends === 1);
  sent.respond(402, ["payment-required", "untrusted-next-offer", "payment-response", "untrusted-hint"]);
  const result = await pending; assert.equal(result.outcome?.kind, "observed");
  if (result.outcome?.kind === "observed") assert.equal(result.outcome.observation.status, 402);
  await held(f); await resend(f); assert.equal(mock.requests.length, 1); assert.equal(sent.ends, 1);
});
test("post-send transport error returns safe held status without raw data or a second request", async t => {
  const f = await first(t), mock = wire(t), pending = f.submit(); await until(() => mock.requests.length === 1);
  const sent = mock.requests[0]; sent.tls(); await until(() => sent.ends === 1); sent.req.emit("error", new Error("synthetic-private-error"));
  const result = await pending; assert.equal(result.outcome?.kind, "held");
  for (const secret of ["synthetic-private-error", sent.endpoint.toString(), sent.options.headers["PAYMENT-SIGNATURE"]]) assert.equal(JSON.stringify(result).includes(secret), false);
  await held(f); await resend(f); assert.equal(mock.requests.length, 1); assert.equal(sent.ends, 1);
});
