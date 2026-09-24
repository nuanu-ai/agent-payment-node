import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import https from "node:https";
import { syncBuiltinESMExports } from "node:module";
import test from "node:test";
import { ApnError } from "../../src/errors.js";
import { failureEnvelope } from "../../src/output.js";
import { HttpsBaseRpc } from "../../src/rpc.js";

const canary = "private-rpc-token-and-request-canary";

for (const status of [403, 429, 500]) test(`DIRECT RPC HTTP ${status} reports only method and status after one attempt`, async (t) => {
  let attempts = 0;
  let resumed = 0;
  t.mock.method(https, "request", (_endpoint: URL, _options: unknown, receive: (response: unknown) => void) => {
    attempts += 1;
    const request = new EventEmitter() as any;
    request.setTimeout = () => request;
    request.end = (_body: string) => {
      queueMicrotask(() => {
        const response = new EventEmitter() as any;
        response.statusCode = status;
        response.statusMessage = canary;
        response.headers = { "x-provider-secret": canary, location: `https://${canary}.example` };
        response.resume = () => { resumed += 1; response.emit("data", Buffer.from(canary)); response.emit("end"); };
        receive(response);
      });
      return request;
    };
    return request;
  });
  syncBuiltinESMExports();
  t.after(() => { t.mock.restoreAll(); syncBuiltinESMExports(); });

  const rpc = new HttpsBaseRpc(`https://8.8.8.8/${canary}?key=${canary}`);
  const call = rpc as unknown as { call(method: string, params: readonly unknown[]): Promise<unknown> };
  let failure: ApnError | undefined;
  try { await call.call("eth_getBalance", [canary]); }
  catch (error) { if (error instanceof ApnError) failure = error; else throw error; }
  assert.ok(failure);
  assert.equal(failure.code, "APN_RPC_PROTOCOL");
  assert.deepEqual(failure.details, { rpcMethod: "eth_getBalance", httpStatus: status });
  assert.equal(attempts, 1);
  assert.equal(resumed, 1);
  const output = failureEnvelope("transfer.prepare", "request-id", failure);
  assert.deepEqual(output.error?.details, { rpcMethod: "eth_getBalance", httpStatus: status });
  assert.equal(JSON.stringify({ message: failure.message, details: failure.details, output }).includes(canary), false);
});
