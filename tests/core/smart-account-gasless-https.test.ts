import assert from "node:assert/strict";
import dns from "node:dns/promises";
import { EventEmitter } from "node:events";
import https from "node:https";
import { syncBuiltinESMExports } from "node:module";
import { performance } from "node:perf_hooks";
import test, { type TestContext } from "node:test";
import { setImmediate as nextTurn } from "node:timers/promises";
import { GaslessHttps } from "../../src/gasless/https.js";

function wire(t: TestContext) {
  const requests: Array<{ options: any; body: unknown; destroyed: number;
    respond(status: number, headers?: Record<string, string>, chunks?: Buffer[], event?: string): void }> = [];
  let rows = [{ address: "8.8.8.8", family: 4 }], remote = "8.8.8.8", dnsCalls = 0;
  let delayed: Array<() => void> | null = null;
  t.mock.method(dns, "lookup", async () => {
    dnsCalls++;
    if (delayed !== null) await new Promise<void>(resolve => delayed!.push(resolve));
    return rows;
  });
  t.mock.method(https, "request", (_endpoint: URL, options: any, callback: (response: any) => void) => {
    const request = new EventEmitter() as any;
    const entry = { options, body: undefined as unknown, destroyed: 0,
      respond(statusCode: number, headers: Record<string, string> = {}, chunks = [Buffer.from("{}")], event = "end") {
        const response = new EventEmitter() as any;
        Object.assign(response, { statusCode, headers, destroy() {} }); callback(response);
        for (const chunk of chunks) response.emit("data", chunk);
        response.emit(event);
      } };
    request.destroy = () => { entry.destroyed++; queueMicrotask(() => request.emit("error", new Error("synthetic-secret"))); };
    request.end = (body: unknown) => { entry.body = body; queueMicrotask(() => {
      const socket = new EventEmitter() as any; socket.remoteAddress = remote;
      request.emit("socket", socket); socket.emit("connect");
    }); };
    requests.push(entry); return request;
  });
  syncBuiltinESMExports(); t.after(() => { t.mock.restoreAll(); syncBuiltinESMExports(); });
  return { requests, get dnsCalls() { return dnsCalls; }, setRows(value: typeof rows) { rows = value; },
    setRemote(value: string) { remote = value; }, delayDns() { delayed = []; },
    releaseDns() { const pending = delayed ?? []; delayed = null; for (const done of pending) done(); } };
}
function clock(t: TestContext) {
  let monotonic = 0;
  t.mock.method(performance, "now", () => monotonic);
  t.mock.timers.enable({ apis: ["setTimeout", "Date"] });
  return { tick(ms: number) { monotonic += ms; t.mock.timers.tick(ms); },
    elapseWithoutTimers(ms: number) { monotonic += ms; } };
}
const ENDPOINT = "https://relay.example/platform/v2/x402/verify";
const rejectSafe = (promise: Promise<unknown>, code = "APN_PROVIDER_UNAVAILABLE") => assert.rejects(promise,
  (error: any) => error.code === code && !/synthetic-secret|private\.example/u.test(String(error.message)));

test("actual GaslessHttps pins DNS and TLS defaults, writes one exact body, and refuses changed or private addresses", async t => {
  const mock = wire(t), transport = new GaslessHttps();
  const pending = transport.request(ENDPOINT, "POST", '{"fixture":true}', 64, "APN_HTTP_CONFIG");
  await nextTurn(); assert.equal(mock.dnsCalls, 1); assert.equal(mock.requests.length, 1);
  const sent = mock.requests[0]!;
  assert.equal(sent.options.agent, false); assert.equal(sent.options.rejectUnauthorized, undefined);
  assert.equal(sent.options.headers["accept-encoding"], "identity"); assert.equal(sent.body, '{"fixture":true}');
  let lookup: unknown[] = [];
  sent.options.lookup("relay.example", {}, (...args: unknown[]) => { lookup = args; });
  assert.deepEqual(lookup, [null, "8.8.8.8", 4]); sent.respond(200);
  assert.deepEqual(await pending, { status: 200, body: "{}" });
  mock.setRows([{ address: "127.0.0.1", family: 4 }]);
  await assert.rejects(transport.request(ENDPOINT, "POST", "{}", 64, "APN_HTTP_CONFIG"), { code: "APN_HTTP_CONFIG" });
  assert.equal(mock.requests.length, 1);
  mock.setRows([{ address: "8.8.8.8", family: 4 }]); mock.setRemote("1.1.1.1");
  await rejectSafe(transport.request(ENDPOINT, "POST", "{}", 64, "APN_HTTP_CONFIG"));
  assert.equal(mock.requests.length, 2); assert.equal(mock.requests[1]!.destroyed, 1);
});
test("queued signed requests expire in their original deadline and never obtain a late slot", async t => {
  const mock = wire(t), timer = clock(t), transport = new GaslessHttps();
  const failures = Array.from({ length: 34 }, () => rejectSafe(transport.request(ENDPOINT, "POST", "synthetic-secret", 64, "APN_HTTP_CONFIG")));
  await nextTurn(); assert.equal(mock.requests.length, 2); assert.equal(mock.dnsCalls, 2);
  await rejectSafe(transport.request(ENDPOINT, "POST", "synthetic-secret", 64, "APN_HTTP_CONFIG"));
  timer.tick(14_999); await nextTurn(); assert.equal(mock.requests.length, 2);
  timer.tick(1); await Promise.all(failures); await nextTurn();
  assert.equal(mock.requests.length, 2); assert.deepEqual(mock.requests.map(r => r.destroyed), [1, 1]);
  // Late socket/response events and all 32 cancelled queue entries cannot consume or release a slot again.
  for (const entry of mock.requests) entry.respond(200);
  const next = Array.from({ length: 3 }, () => transport.request(ENDPOINT, "GET", null, 64, "APN_HTTP_CONFIG"));
  await nextTurn(); assert.equal(mock.requests.length, 4);
  mock.requests[2]!.respond(200); await nextTurn(); assert.equal(mock.requests.length, 5);
  mock.requests[3]!.respond(200); mock.requests[4]!.respond(200); await Promise.all(next);
  assert.deepEqual(mock.requests.slice(0, 2).map(r => r.destroyed), [1, 1]);
});
test("a queued request gets only the remaining second after fourteen seconds in the queue", async t => {
  const mock = wire(t), timer = clock(t), transport = new GaslessHttps();
  const first = transport.request(ENDPOINT, "GET", null, 64, "APN_HTTP_CONFIG");
  const second = rejectSafe(transport.request(ENDPOINT, "GET", null, 64, "APN_HTTP_CONFIG"));
  const queued = rejectSafe(transport.request(ENDPOINT, "POST", "synthetic-secret", 64, "APN_HTTP_CONFIG"));
  await nextTurn(); timer.tick(14_000); mock.requests[0]!.respond(200); await first; await nextTurn();
  assert.equal(mock.requests.length, 3); assert.equal(mock.requests[2]!.body, "synthetic-secret");
  timer.tick(999); await nextTurn(); assert.equal(mock.requests[2]!.destroyed, 0);
  timer.tick(1); await Promise.all([second, queued]);
  assert.equal(mock.requests[2]!.destroyed, 1); assert.equal(mock.requests.length, 3);
});
test("DNS expiration discards late answers and releases slots without ever sending a signed body", async t => {
  const mock = wire(t), timer = clock(t), transport = new GaslessHttps(); mock.delayDns();
  const pending = Array.from({ length: 3 }, () => rejectSafe(transport.request(ENDPOINT, "POST", "synthetic-secret", 64, "APN_RPC_CONFIG"), "APN_RPC_AMBIGUOUS"));
  await nextTurn(); assert.equal(mock.dnsCalls, 2); assert.equal(mock.requests.length, 0);
  timer.tick(15_000); await Promise.all(pending); mock.releaseDns(); await nextTurn();
  assert.equal(mock.requests.length, 0); assert.equal(mock.dnsCalls, 2);
  const fresh = transport.request(ENDPOINT, "GET", null, 64, "APN_HTTP_CONFIG");
  await nextTurn(); assert.equal(mock.requests.length, 1); mock.requests[0]!.respond(200); await fresh;
});
test("deadline checks prevent dispatch after event-loop delay even before timeout callbacks run", async t => {
  const mock = wire(t), timer = clock(t), transport = new GaslessHttps(); mock.delayDns();
  const pending = rejectSafe(transport.request(ENDPOINT, "POST", "synthetic-secret", 64, "APN_HTTP_CONFIG"));
  await nextTurn(); timer.elapseWithoutTimers(15_001); mock.releaseDns(); await pending;
  assert.equal(mock.requests.length, 0);
});
test("wall-clock rollback cannot extend the monotonic transport deadline", async t => {
  const mock = wire(t), timer = clock(t), transport = new GaslessHttps();
  const pending = rejectSafe(transport.request(ENDPOINT, "POST", "synthetic-secret", 64, "APN_HTTP_CONFIG"));
  await nextTurn(); t.mock.timers.setTime(0); timer.tick(15_000); await pending;
  assert.equal(mock.requests.length, 1); assert.equal(mock.requests[0]!.destroyed, 1);
});
test("redirects, malformed lengths, encoding, oversized streams and invalid UTF-8 reject without retry or raw errors", async t => {
  const mock = wire(t), transport = new GaslessHttps();
  const cases: Array<[number, Record<string, string>, Buffer[], string?]> = [
    [302, { location: "https://private.example/synthetic-secret" }, []], [200, { "content-encoding": "gzip" }, []],
    [200, { "content-length": "65" }, []], [200, { "content-length": "-1" }, []],
    [200, { "content-length": "01" }, []], [200, { "content-length": "2" }, [Buffer.from("1")]],
    [200, { "content-length": "1" }, [Buffer.from("{}")]], [200, {}, [Buffer.alloc(65)]],
    [200, {}, [Buffer.from([0xc0, 0x80])]], [200, {}, [], "aborted"], [200, {}, [], "error"],
  ];
  for (const [status, headers, chunks, event] of cases) {
    const count = mock.requests.length;
    const rejected = rejectSafe(transport.request(ENDPOINT, "GET", null, 64, "APN_HTTP_CONFIG"));
    await nextTurn(); mock.requests.at(-1)!.respond(status, headers, chunks, event); await rejected;
    assert.equal(mock.requests.length, count + 1); assert.equal(mock.requests.at(-1)!.destroyed, 1);
  }
});
