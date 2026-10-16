import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import { canonicalJson, hashObject } from "../../src/canonical.js";
import { bindX402HttpRequest, normalizeX402HttpRequest, x402HttpRequestBinding } from "../../src/x402-http-request.js";
import { parseRpcBatchResultEnvelope, parseRpcResultEnvelope } from "../../src/rpc-envelope.js";
import { parseJsonWithDuplicateRejection } from "../../src/x402-strict-json.js";

const URL = "https://example.com/";
const own = (value: unknown, key: string) => Object.prototype.hasOwnProperty.call(value, key);

test("canonical JSON keeps an own __proto__ member and is unchanged for every other object", () => {
  const withMember = JSON.parse('{"b":1,"__proto__":"x"}') as unknown;
  assert.equal(canonicalJson(withMember), '{"__proto__":"x","b":1}');
  assert.notEqual(hashObject(withMember), hashObject({ b: 1 }));
  assert.notEqual(canonicalJson(JSON.parse('{"__proto__":"one"}')), canonicalJson(JSON.parse('{"__proto__":"two"}')));
  // Stored hashes never contained such a member, so their canonical bytes must not move.
  const ordinary = { b: 1, a: [{ d: null, c: "x", e: undefined }], constructor: "c", prototype: true };
  const bytes = '{"a":[{"c":"x","d":null}],"b":1,"constructor":"c","prototype":true}';
  assert.equal(canonicalJson(ordinary), bytes);
  assert.equal(hashObject(ordinary), createHash("sha256").update(bytes).digest("hex"));
  assert.equal(Object.getPrototypeOf({}), Object.prototype, "the global prototype is untouched");
});

test("the strict parser defines __proto__ as data in every spelling and still rejects duplicates", () => {
  for (const [raw, value] of [
    ['{"__proto__":"value"}', "value"], ['{"__proto__":null}', null], ['{"__proto__":42}', 42],
    ['{"__proto__":true}', true], ['{"\\u005f_proto__":"value"}', "value"],
  ] as const) {
    const parsed = parseJsonWithDuplicateRejection(raw) as Record<string, unknown>;
    assert.equal(own(parsed, "__proto__"), true, raw);
    assert.deepEqual(Object.getOwnPropertyDescriptor(parsed, "__proto__")?.value, value, raw);
    assert.equal(Object.getPrototypeOf(parsed), Object.prototype, raw);
  }
  const nested = parseJsonWithDuplicateRejection('{"__proto__":{"secret":"value"},"x":1}') as Record<string, unknown>;
  assert.equal(Object.getPrototypeOf(nested), Object.prototype, "an object value never becomes the prototype");
  assert.equal((nested as { secret?: unknown }).secret, undefined);
  assert.deepEqual(Object.keys(nested), ["__proto__", "x"]);
  assert.throws(() => parseJsonWithDuplicateRejection('{"__proto__":"one","__proto__":"two"}'), { code: "APN_HTTP_PROTOCOL" });
});

test("x402 request headers reject __proto__ in any case and hash every other header change", () => {
  for (const headers of ['{"__proto__":"one"}', '{"__PROTO__":"one"}', '{"\\u005f_proto__":"one"}', '{"__proto__":{"a":"b"}}']) {
    assert.throws(() => bindX402HttpRequest({ "--url": URL, "--headers-json": headers }), { code: "APN_INVALID_INPUT" }, headers);
  }
  assert.throws(() => normalizeX402HttpRequest({
    schemaVersion: "apn.http-request.v1", url: URL, method: "GET", headers: JSON.parse('{"__proto__":"one"}') as unknown, bodyBase64: null,
  }), { code: "APN_INVALID_INPUT" }, "the MCP path parses with JSON.parse and must be refused too");
  const hash = (headers: string) => x402HttpRequestBinding(bindX402HttpRequest({ "--url": URL, "--headers-json": headers }).httpRequest).httpRequestHash;
  assert.notEqual(hash('{"x-qa":"one"}'), hash('{"x-qa":"two"}'));
  assert.notEqual(hash('{"x-qa":"one"}'), hash("{}"));
  assert.equal(hash('{"constructor":"one"}') === hash("{}"), false);
});

test("strict JSON-RPC envelopes reject an extra __proto__ member like any other extra key", () => {
  assert.deepEqual(parseRpcResultEnvelope('{"jsonrpc":"2.0","id":"1","result":[]}', "1"), []);
  assert.throws(() => parseRpcResultEnvelope('{"jsonrpc":"2.0","id":"1","result":[],"__proto__":1}', "1"), { code: "APN_RPC_PROTOCOL" });
  assert.throws(() => parseRpcBatchResultEnvelope('[{"jsonrpc":"2.0","id":1,"result":[],"__proto__":1}]', [1]), { code: "APN_RPC_PROTOCOL" });
});
