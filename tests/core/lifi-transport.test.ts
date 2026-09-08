import assert from "node:assert/strict";
import dns from "node:dns/promises";
import { EventEmitter } from "node:events";
import https from "node:https";
import { syncBuiltinESMExports } from "node:module";
import test, { type TestContext } from "node:test";
import { setImmediate as nextTurn } from "node:timers/promises";
import { BridgeHttps } from "../../src/lifi/https.js";

function mockWire(t: TestContext) {
  const requests: Array<{ endpoint: URL; options: any; body: unknown; respond: (status: number, headers: Record<string, string>, chunks: Buffer[], event?: string) => void; destroyCount: number }> = [];
  let dnsCalls = 0, dnsRows = [{ address: "8.8.8.8", family: 4 }], remoteAddress = "8.8.8.8";
  t.mock.method(dns, "lookup", async () => { dnsCalls++; return dnsRows; });
  t.mock.method(https, "request", (endpoint: URL, options: any, callback: (response: any) => void) => {
    const request = new EventEmitter() as any;
    const entry = { endpoint, options, body: undefined as unknown, destroyCount: 0,
      respond(statusCode: number, headers: Record<string, string>, chunks: Buffer[], event?: string) {
        const response = new EventEmitter() as any;
        Object.assign(response, { statusCode, headers, destroy() {} }); callback(response);
        for (const chunk of chunks) response.emit("data", chunk);
        response.emit(event ?? "end");
      } };
    request.destroy = () => { entry.destroyCount++; };
    request.end = (body: unknown) => { entry.body = body; queueMicrotask(() => {
      const socket = new EventEmitter() as any; socket.remoteAddress = remoteAddress;
      request.emit("socket", socket); socket.emit("connect");
    }); };
    requests.push(entry); return request;
  });
  syncBuiltinESMExports(); t.after(() => { t.mock.restoreAll(); syncBuiltinESMExports(); });
  return { requests, get dnsCalls() { return dnsCalls; }, setDns(rows: typeof dnsRows) { dnsRows = rows; }, setRemote(value: string) { remoteAddress = value; } };
}

test("LI.FI transport pins public DNS, sends exact JSON once with default TLS and rejects private or changing addresses", async (t) => {
  const wire = mockWire(t), transport = new BridgeHttps();
  const pending = transport.request("https://relay.example/v1/routes", "POST", '{"bound":true}', 64, "APN_HTTP_CONFIG");
  await nextTurn(); assert.equal(wire.dnsCalls, 1); assert.equal(wire.requests.length, 1);
  const sent = wire.requests[0]!; assert.equal(sent.options.agent, false); assert.equal(sent.options.rejectUnauthorized, undefined);
  assert.equal(sent.options.headers["accept-encoding"], "identity"); assert.equal(sent.body, '{"bound":true}');
  let resolved: unknown[] = []; sent.options.lookup("relay.example", {}, (...args: unknown[]) => { resolved = args; });
  assert.deepEqual(resolved, [null, "8.8.8.8", 4]); sent.respond(200, {}, [Buffer.from('{"ok":true}')]);
  assert.deepEqual(await pending, { status: 200, body: '{"ok":true}' });
  wire.setDns([{ address: "127.0.0.1", family: 4 }]);
  await assert.rejects(transport.request("https://relay.example/v1/routes", "GET", null, 64, "APN_HTTP_CONFIG"), { code: "APN_HTTP_CONFIG" });
  assert.equal(wire.requests.length, 1);
  wire.setDns([{ address: "8.8.8.8", family: 4 }]); wire.setRemote("1.1.1.1");
  const failure = assert.rejects(transport.request("https://relay.example/v1/routes", "GET", null, 64, "APN_HTTP_CONFIG"), { code: "APN_PROVIDER_UNAVAILABLE" });
  await failure; assert.equal(wire.requests.length, 2); assert.equal(wire.requests[1]!.destroyCount, 1);
});

test("LI.FI transport rejects redirects, compression, declared/streamed oversize, invalid UTF-8 and interrupted bodies without retry", async (t) => {
  const wire = mockWire(t), transport = new BridgeHttps();
  const cases: Array<[number, Record<string, string>, Buffer[], string?]> = [
    [302, { location: "https://private.example/secret" }, []], [200, { "content-encoding": "gzip" }, []],
    [200, { "content-length": "65" }, []], [200, { "content-length": "-1" }, []], [200, {}, [Buffer.alloc(65)]],
    [200, {}, [Buffer.from([0xc0, 0x80])]], [200, {}, [], "aborted"], [200, {}, [], "error"],
  ];
  for (const [status, headers, chunks, event] of cases) {
    const count = wire.requests.length;
    const failure = assert.rejects(transport.request("https://8.8.8.8/v1/routes", "GET", null, 64, "APN_HTTP_CONFIG"),
      (error: any) => error.code === "APN_PROVIDER_UNAVAILABLE" && !/private.example|secret/u.test(error.message));
    await nextTurn(); wire.requests.at(-1)!.respond(status, headers, chunks, event); await failure;
    assert.equal(wire.requests.length, count + 1);
  }
});

test("LI.FI transport admits at most two concurrent requests and releases each queued request exactly once", async (t) => {
  const wire = mockWire(t), transport = new BridgeHttps();
  const pending = Array.from({ length: 5 }, () => transport.request("https://8.8.8.8/v1/status", "GET", null, 64, "APN_HTTP_CONFIG"));
  await nextTurn(); assert.equal(wire.requests.length, 2);
  wire.requests[0]!.respond(200, {}, [Buffer.from("0")]); await nextTurn(); assert.equal(wire.requests.length, 3);
  wire.requests[1]!.respond(200, {}, [Buffer.from("1")]); await nextTurn(); assert.equal(wire.requests.length, 4);
  wire.requests[2]!.respond(200, {}, [Buffer.from("2")]); await nextTurn(); assert.equal(wire.requests.length, 5);
  wire.requests[3]!.respond(200, {}, [Buffer.from("3")]); wire.requests[4]!.respond(200, {}, [Buffer.from("4")]);
  assert.deepEqual((await Promise.all(pending)).map((r) => r.body), ["0", "1", "2", "3", "4"]);
});

test("LI.FI transport 15-second deadline destroys the one request and does not retry", async (t) => {
  const wire = mockWire(t); t.mock.timers.enable({ apis: ["setTimeout", "Date"] });
  const failure = assert.rejects(new BridgeHttps().request("https://8.8.8.8/v1/status", "GET", null, 64, "APN_RPC_CONFIG"), { code: "APN_RPC_AMBIGUOUS" });
  await nextTurn(); assert.equal(wire.requests.length, 1); t.mock.timers.tick(14_999); assert.equal(wire.requests[0]!.destroyCount, 0);
  t.mock.timers.tick(1); await failure; assert.equal(wire.requests[0]!.destroyCount, 1); assert.equal(wire.requests.length, 1);
});
