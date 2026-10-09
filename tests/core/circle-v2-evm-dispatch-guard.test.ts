import { ApnError } from "../../src/errors.js";
import assert from "node:assert/strict";
import test, { type TestContext } from "node:test";
import https from "node:https";
import { EventEmitter } from "node:events";
import { syncBuiltinESMExports } from "node:module";
import { setImmediate as nextTurn } from "node:timers/promises";
import { BridgeHttps } from "../../src/lifi/https.js";
import { CircleRpc } from "../../src/circle-v2-evm/rpc.js";
function wire(t: TestContext) {
  const entries: Array<{ request: any; socket: any; bodies: unknown[]; destroyed: number; respond(): void }> = [];
  t.mock.method(https, "request", (_url: unknown, _options: unknown, callback: (r: any) => void) => {
    const request = new EventEmitter() as any, socket = new EventEmitter() as any; socket.remoteAddress = "8.8.8.8";
    const entry = { request, socket, bodies: [] as unknown[], destroyed: 0, respond() { const response = new EventEmitter() as any; Object.assign(response, { statusCode: 200, headers: {}, destroy() {} }); callback(response); response.emit("data", Buffer.from("{}")); response.emit("end"); } };
    request.end = (body: unknown) => entry.bodies.push(body); request.destroy = () => { entry.destroyed++; };
    entries.push(entry); queueMicrotask(() => { request.emit("socket", socket); socket.emit("connect"); }); return request;
  });
  syncBuiltinESMExports(); t.after(() => { t.mock.restoreAll(); syncBuiltinESMExports(); }); return entries;
}
const resolver = async () => [{ address: "8.8.8.8", family: 4 as const }];
const endpoint = "https://rpc.example/rpc", body = '{"method":"eth_sendRawTransaction","params":["sealed-fixture"]}';
test("expired DNS authority produces zero physical POST requests", async t => {
  const entries = wire(t); let valid = true, release!: () => void;
  const transport = new BridgeHttps(async () => { await new Promise<void>(r => { release = r; }); return resolver(); });
  const pending = transport.request(endpoint, "POST", body, 64, "APN_RPC_CONFIG", () => { if (!valid) throw new ApnError("APN_OPERATION_BLOCKED", "expired_exact_consent"); });
  const rejected = assert.rejects(pending, /expired_exact_consent/); await nextTurn(); valid = false; release(); await rejected; assert.equal(entries.length, 0);
});
test("expired queue authority produces zero physical POST requests after a slot frees", async t => {
  const entries = wire(t), transport = new BridgeHttps(resolver); let valid = true;
  const first = transport.request(endpoint, "GET", null, 64, "APN_RPC_CONFIG"), second = transport.request(endpoint, "GET", null, 64, "APN_RPC_CONFIG");
  await nextTurn(); assert.equal(entries.length, 2);
  const pending = transport.request(endpoint, "POST", body, 64, "APN_RPC_CONFIG", () => { if (!valid) throw new ApnError("APN_OPERATION_BLOCKED", "expired_exact_consent"); }); const rejected = assert.rejects(pending, /expired_exact_consent/);
  valid = false; entries[0]!.respond(); entries[1]!.respond(); await Promise.all([first, second, rejected]); assert.equal(entries.length, 2);
});
test("expired TLS authority writes no POST body; valid TLS authority writes exact bytes once", async t => {
  const entries = wire(t), transport = new BridgeHttps(resolver); let valid = true;
  const pending = transport.request(endpoint, "POST", body, 64, "APN_RPC_CONFIG", () => { if (!valid) throw new ApnError("APN_OPERATION_BLOCKED", "expired_exact_consent"); }); const rejected = assert.rejects(pending, /expired_exact_consent/);
  await nextTurn(); assert.equal(entries[0]!.bodies.length, 0); valid = false; entries[0]!.socket.emit("secureConnect"); await rejected; assert.equal(entries[0]!.bodies.length, 0); assert.equal(entries[0]!.destroyed, 1);
  valid = true; const success = transport.request(endpoint, "POST", body, 64, "APN_RPC_CONFIG", () => { if (!valid) throw new ApnError("APN_OPERATION_BLOCKED", "expired_exact_consent"); }); await nextTurn(); entries[1]!.socket.emit("secureConnect"); assert.deepEqual(entries[1]!.bodies, [body]); entries[1]!.respond(); await success;
});
test("Circle raw-send RPC requires a private dispatch guard before touching transport", async () => {
  let requests = 0; const rpc = new CircleRpc(endpoint, 42161, { request: async () => { requests++; throw new Error("unexpected"); } });
  await assert.rejects(rpc.call("eth_sendRawTransaction", ["sealed-fixture"]), /financial_rpc_consent/); assert.equal(requests, 0);
});

test("one-millisecond bound policy expiration after DNS or TLS writes zero signed POST bytes", async t => {
  const entries = wire(t); let now = 1000, release!: () => void;
  const guard = () => { if (now >= 1001) throw new ApnError("APN_OPERATION_BLOCKED", "bound_policy_window_expired"); };
  const dns = new BridgeHttps(async () => { await new Promise<void>(r => { release = r; }); return resolver(); });
  const queued = dns.request(endpoint, "POST", body, 64, "APN_RPC_CONFIG", guard), dnsRejected = assert.rejects(queued, /bound_policy_window_expired/);
  await nextTurn(); now++; release(); await dnsRejected; assert.equal(entries.length, 0);
  now = 1000; const tls = new BridgeHttps(resolver), pending = tls.request(endpoint, "POST", body, 64, "APN_RPC_CONFIG", guard), tlsRejected = assert.rejects(pending, /bound_policy_window_expired/);
  await nextTurn(); assert.equal(entries[0]!.bodies.length, 0); now++; entries[0]!.socket.emit("secureConnect"); await tlsRejected; assert.equal(entries[0]!.bodies.length, 0);
});
