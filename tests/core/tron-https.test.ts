import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import type { ClientRequest, IncomingMessage } from "node:http";
import type { request } from "node:https";
import test from "node:test";
import { ApnError } from "../../src/errors.js";
import { createTronHttpsFetch } from "../../src/tron/https.js";
import { TronRpc } from "../../src/tron/rpc.js";

const canary = "private-key-and-rpc-token-canary";

function offlineFetch(reply?: { status: number; contentType: string; body: string }) {
  let calls = 0;
  const requestHttps = ((_endpoint: URL, _options: unknown, receive: (incoming: IncomingMessage) => void) => {
    calls++;
    const outgoing = new EventEmitter() as ClientRequest;
    outgoing.destroy = (() => outgoing) as ClientRequest["destroy"];
    outgoing.end = (() => {
      if (reply !== undefined) queueMicrotask(() => {
        const incoming = new EventEmitter() as IncomingMessage;
        incoming.statusCode = reply.status;
        incoming.statusMessage = canary;
        incoming.headers = { "content-type": reply.contentType, "content-length": String(Buffer.byteLength(reply.body)), "x-secret": canary };
        incoming.destroy = (() => incoming) as IncomingMessage["destroy"];
        receive(incoming);
        queueMicrotask(() => { incoming.emit("data", Buffer.from(reply.body)); incoming.emit("end"); });
      });
      return outgoing;
    }) as ClientRequest["end"];
    return outgoing;
  }) as unknown as typeof request;
  const resolve = async () => [{ address: "8.8.8.8", family: 4 as const }];
  return { fetcher: createTronHttpsFetch(requestHttps, resolve), calls: () => calls };
}

async function rpcError(fetcher: typeof fetch): Promise<ApnError> {
  try { await new TronRpc(`https://rpc.example/${canary}`, fetcher).call("wallet/getaccount", { privateKey: canary }); }
  catch (error) { assert.ok(error instanceof ApnError); return error; }
  assert.fail("RPC call unexpectedly succeeded");
}

function safe(error: ApnError): void {
  assert.equal(JSON.stringify({ message: error.message, details: error.details }).includes(canary), false);
  assert.equal(error.details?.rpcMethod, "wallet/getaccount");
}

test("TRON HTTPS keeps a 429 status and method without response or request secrets", async () => {
  const offline = offlineFetch({ status: 429, contentType: `text/plain; ${canary}`, body: canary });
  const error = await rpcError(offline.fetcher);
  assert.equal(error.code, "APN_RPC_PROTOCOL");
  assert.deepEqual(error.details, { reason: "http_status", httpStatus: "429", rpcMethod: "wallet/getaccount" });
  assert.equal(offline.calls(), 1);
  safe(error);
});

test("TRON HTTPS identifies invalid Content-Type and JSON without leaking bodies", async () => {
  const contentType = await rpcError(offlineFetch({ status: 200, contentType: `text/html; ${canary}`, body: canary }).fetcher);
  assert.deepEqual(contentType.details, { reason: "content_type", rpcMethod: "wallet/getaccount" });
  safe(contentType);
  const malformed = await rpcError(offlineFetch({ status: 200, contentType: "application/json", body: `{${canary}` }).fetcher);
  assert.equal(malformed.code, "APN_RPC_PROTOCOL");
  assert.deepEqual(malformed.details, { rpcMethod: "wallet/getaccount", reason: "invalid_json" });
  safe(malformed);
});

test("TRON HTTPS distinguishes an aborted deadline without retry", async () => {
  const offline = offlineFetch();
  const controller = new AbortController();
  const pending = offline.fetcher(new URL(`https://rpc.example/${canary}/wallet/getaccount`), { body: `{\"secret\":\"${canary}\"}`, signal: controller.signal });
  await new Promise<void>((resolve) => setImmediate(resolve));
  assert.equal(offline.calls(), 1);
  controller.abort();
  await assert.rejects(pending, (error: unknown) => {
    assert.ok(error instanceof ApnError);
    assert.equal(error.code, "APN_RPC_PROTOCOL");
    assert.deepEqual(error.details, { reason: "deadline" });
    assert.equal(JSON.stringify(error).includes(canary), false);
    return true;
  });
  assert.equal(offline.calls(), 1);
});
