import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import type { IncomingMessage } from "node:http";
import { request as httpsRequest } from "node:https";
import test from "node:test";
import { AwalX402Adapter } from "../../src/awal-x402-adapter.js";
import { bindArgv, bindMcpInput } from "../../src/command-binder.js";
import { COMMANDS } from "../../src/command-catalog.js";
import { HttpsX402Http } from "../../src/x402-http.js";
import {
  decodeX402RequestBody, normalizeX402HttpRequest, validateFrozenX402HttpRequest, x402HttpRequestBinding,
} from "../../src/x402-http-request.js";
import { providerHttpRequest, validateProviderHttpRequest } from "../../src/provider-x402-http-request.js";
import { sealX402Result, validateX402Result } from "../../src/x402-state-integrity.js";
import { opaqueHttpResult } from "../../src/x402-opaque-result.js";
import { paidObservation } from "./x402-helpers.js";
import { X402_URL } from "./x402-vectors.js";
import { canonicalPaymentRequiredHeader, X402_PAYMENT_REQUIRED, X402_REQUIREMENTS } from "./x402-vectors.js";
import { decodePaymentRequiredHeader, inspectCandidates } from "../../src/x402-codec.js";

function request(overrides: Record<string, unknown> = {}) {
  return normalizeX402HttpRequest({
    schemaVersion: "apn.http-request.v1", url: X402_URL, method: "POST", headers: {}, bodyBase64: null, ...overrides,
  });
}

for (const [name, method, body] of [
  ["absent GET", "GET", null], ["absent POST", "POST", null], ["empty POST", "POST", ""],
  ["JSON bytes", "POST", Buffer.from('{ "planId": "synthetic", "idempotencyKey": "seller-001" }\n').toString("base64")],
  ["form bytes", "POST", Buffer.from("city=Denpasar&empty=").toString("base64")],
  ["binary bytes", "POST", "AAH/"], ["PUT bytes", "PUT", "AQ=="], ["PATCH bytes", "PATCH", "AA=="],
  ["custom method", "CUSTOM", null], ["explicit GET bytes", "GET", "AQ=="],
] as const) {
  test(`generic HTTP preserves ${name} through the production HTTPS adapter`, async () => {
    const httpRequest = request({ method, bodyBase64: body, headers: { "Content-Type": "application/octet-stream", "Idempotency-Key": "seller-001" } });
    const http = new HttpsX402Http();
    let observed = false;
    Object.assign(http, {
      resolveAddresses: async () => [{ address: "1.1.1.1", family: 4 }],
      request: ((_endpoint: URL, options: { method: string; headers: Record<string, string> }, callback: (response: IncomingMessage) => void) => {
        assert.equal(options.method, method);
        assert.equal(options.headers["content-type"], "application/octet-stream");
        assert.equal(options.headers["idempotency-key"], "seller-001");
        assert.equal(options.headers["content-length"], body === null ? undefined : String(Buffer.from(body, "base64").length));
        const outgoing = new EventEmitter();
        return Object.assign(outgoing, {
          destroy() {},
          end(bytes: Buffer | undefined) {
            assert.deepEqual(bytes, body === null ? undefined : Buffer.from(body, "base64"));
            observed = true;
            const response = Object.assign(new EventEmitter(), {
              statusCode: 402, rawHeaders: [], rawTrailers: [], socket: { authorized: true, remoteAddress: "1.1.1.1" }, destroy() {},
            });
            callback(response as unknown as IncomingMessage);
            response.emit("end");
          },
        });
      }) as unknown as typeof httpsRequest,
    });
    assert.equal((await http.get({ url: X402_URL, httpRequest })).status, 402);
    assert.equal(observed, true);
  });
}

test("CLI and MCP bind identical POST requests, including explicit zero bytes", () => {
  const definition = COMMANDS.find((entry) => entry.path.join(" ") === "x402 fetch prepare")!;
  const cli = bindArgv(["x402", "fetch", "prepare", "--url", X402_URL, "--profile", "default", "--rpc-url", "https://rpc.example",
    "--idempotency-key", "generic-request-001", "--method", "post", "--headers-json", '{"Content-Type":"application/json"}', "--body-base64", ""]);
  const mcp = bindMcpInput(definition, { url: X402_URL, profile: "default", rpc_url: "https://rpc.example",
    idempotency_key: "generic-request-001", method: "post", headers_json: '{"Content-Type":"application/json"}', body_base64: "" });
  assert.deepEqual(cli, mcp);
  assert.equal((cli.request as { httpRequest?: { bodyBase64: unknown } }).httpRequest?.bodyBase64, "");
  assert.throws(() => bindArgv(["x402", "inspect", "--url", X402_URL, "--headers-json", '{"x-test":"one","x-test":"two"}']));
});

test("HTTP request identity binds URL, method, headers and absent versus empty versus exact bytes", () => {
  const original = request();
  const hash = x402HttpRequestBinding(original);
  for (const change of [{ url: "https://seller.example/other" }, { method: "PUT" }, { headers: { "x-test": "value" } },
    { bodyBase64: "" }, { bodyBase64: "AA==" }, { bodyBase64: "AQ==" }]) {
    assert.notDeepEqual(x402HttpRequestBinding(request(change)), hash);
  }
  assert.deepEqual(x402HttpRequestBinding(request({ headers: { "X-B": "b", "X-A": "a" } })),
    x402HttpRequestBinding(request({ headers: { "x-a": "a", "x-b": "b" } })));
  assert.equal(decodeX402RequestBody(null), undefined);
  assert.deepEqual(decodeX402RequestBody(""), Buffer.alloc(0));
  assert.throws(() => validateFrozenX402HttpRequest(X402_URL, { ...original, method: "post" }));
  assert.throws(() => validateFrozenX402HttpRequest("https://seller.example/other", original));
});

test("generic HTTP preserves safety gates without parsing application bodies", () => {
  for (const change of [{ method: "CONNECT" }, { method: "TRACE" }, { method: "POST\r\nX: y" },
    { url: "http://seller.example/" }, { url: "https://127.0.0.1/" }, { bodyBase64: "AR==" },
    { bodyBase64: Buffer.alloc(65537).toString("base64") }, { headers: { "X-Test": "a", "x-test": "b" } }]) {
    assert.throws(() => request(change));
  }
  for (const name of ["host", "authorization", "cookie", "payment-signature", "x-payment", "content-length", "transfer-encoding", "x-forwarded-for"]) {
    assert.throws(() => request({ headers: { [name]: "injected" } }));
  }
  const malformedJson = Buffer.from("{ definitely not JSON }").toString("base64");
  assert.equal(request({ headers: { "content-type": "application/json" }, bodyBase64: malformedJson }).bodyBase64, malformedJson);
  assert.equal(decodeX402RequestBody(Buffer.alloc(65536).toString("base64"))?.length, 65536);
});

test("provider request bindings retain legacy GET identity and detect opaque-request tampering", () => {
  const legacy = providerHttpRequest(new URL(X402_URL));
  validateProviderHttpRequest(legacy);
  assert.equal(legacy.httpRequest, undefined);
  const generic = providerHttpRequest(new URL(X402_URL), request());
  validateProviderHttpRequest(generic);
  assert.notEqual(generic.requestDigest, legacy.requestDigest);
  assert.throws(() => validateProviderHttpRequest({ ...generic, httpRequest: request({ method: "PUT" }) }));
  assert.throws(() => validateProviderHttpRequest({ ...generic, bodyState: "present" }));
});

test("Coinbase refuses bodies it cannot preserve before resolving or launching the provider", async () => {
  let resolutions = 0;
  const adapter = new AwalX402Adapter(async () => { resolutions += 1; throw new Error("must not resolve"); });
  adapter.assertCompatibleRequest(request());
  for (const bodyBase64 of ["", "e30=", "AAH/"]) {
    await assert.rejects(adapter.execute({ url: X402_URL, httpRequest: request({ bodyBase64 }), amountAtomic: "1",
      correlationId: "a".repeat(64), requestDigest: "b".repeat(64) }), /cannot forward opaque body bytes unchanged/u);
  }
  assert.equal(resolutions, 0);
});

test("opaque 2xx results preserve binary and non-JSON bytes in versioned durable artifacts", () => {
  for (const status of [200, 201, 202, 204, 206]) {
    const bytes = status === 204 ? Buffer.alloc(0) : Buffer.from([0, 255, 1]);
    const result = opaqueHttpResult({ ...paidObservation(), status, rawHeaderPairs: [], bodyBytes: bytes });
    assert.ok(result);
    const sealed = sealX402Result({ schemaVersion: "apn.x402.result.v2", operationId: "a".repeat(64),
      ...result, bodyEncoding: "base64", responseStatus: String(status), createdAt: "2026-09-06T00:00:00.000Z" });
    assert.deepEqual(Buffer.from(validateX402Result(sealed).bodyText, "base64"), bytes);
    assert.throws(() => validateX402Result(sealX402Result({ ...sealed, bodyText: "AQ==" })));
  }
  assert.equal(opaqueHttpResult({ ...paidObservation(), status: 402 }), undefined);
});

test("bounded seller metadata is opaque while payment-critical fields remain strict", () => {
  const wire = { ...X402_PAYMENT_REQUIRED, customMetadata: { rating: 4.5 },
    resource: { ...X402_PAYMENT_REQUIRED.resource, tags: { sellerSpecific: true }, description: "x".repeat(2000), custom: [0.25] },
    accepts: [{ ...X402_REQUIREMENTS, outputSchema: { type: "object" },
      extra: { ...X402_REQUIREMENTS.extra, custom: { rating: 4.5 } } }],
  };
  const decoded = decodePaymentRequiredHeader(canonicalPaymentRequiredHeader(wire));
  assert.equal(inspectCandidates(decoded, X402_URL).length, 1);
  for (const change of [{ network: "eip155:1" }, { amount: "-1" }, { payTo: "not-an-address" }, { scheme: "other" },
    { extra: { ...X402_REQUIREMENTS.extra, assetTransferMethod: "permit2" } }]) {
    const unsupported = decodePaymentRequiredHeader(canonicalPaymentRequiredHeader({ ...wire, accepts: [{ ...wire.accepts[0], ...change }] }));
    assert.equal(inspectCandidates(unsupported, X402_URL).length, 0);
  }
  assert.throws(() => decodePaymentRequiredHeader(canonicalPaymentRequiredHeader({ ...wire,
    accepts: [{ ...wire.accepts[0], maxTimeoutSeconds: 60.5 }] })));
});

test("Coinbase launcher forwards absent-body POST and headers without a data argument", async () => {
  let args: readonly string[] = [];
  const adapter = new AwalX402Adapter(async () => "/synthetic/awal.js", (_executable, actual, options) => {
    args = actual;
    assert.equal(options.shell, false);
    throw new Error("synthetic child not created");
  });
  const httpRequest = request({ headers: { "idempotency-key": "seller-001" } });
  const result = await adapter.execute({ url: X402_URL, httpRequest, amountAtomic: "1",
    correlationId: "a".repeat(64), requestDigest: "b".repeat(64) });
  assert.equal(result.disposition, "not_started");
  assert.equal(args[args.indexOf("-X") + 1], "POST");
  assert.equal(args[args.indexOf("-h") + 1], '{"idempotency-key":"seller-001"}');
  assert.equal(args.includes("-d"), false);
});
