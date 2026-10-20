/**
 * QA 0.5.51 X402-RESULT-SHA256-001: the public `sha256` of a seller result is the plain SHA-256 of the body bytes; the
 * stored domain-separated hash keeps its value and is published under its own name with its rule. The bytes are the
 * paid QuickNode answer of operation 532db8f8… (45 bytes); no payment is repeated.
 */
import assert from "node:assert/strict";
import test from "node:test";
import { domainHash, sha256 } from "../../src/canonical.js";
import { projectPublicX402Result, validatePublicX402Result } from "../../src/x402-public-artifacts.js";
import { sealX402Result, validateX402Result, X402_RESULT_HASH_RULE, type X402ResultRecord } from "../../src/x402-state-integrity.js";

const BODY = Buffer.from('{"jsonrpc":"2.0","id":1,"result":"0x325bf45"}', "utf8");
const BODY_SHA256 = "616221447bed11088d4f7dd8c92f30842db92ba8d75c2658b0a7cd5a55da2541";
const DOMAIN_HASH = "e8f29c43de63b3b305a5fccc7574a0eb2cf9adcd134ef251f8d2f4a9eeeb9d4e";

function stored(bytes: Buffer, kind: "base64" | "utf8", mediaType: string): X402ResultRecord {
  return sealX402Result({ schemaVersion: kind === "base64" ? "apn.x402.result.v2" : "apn.x402.result.v1", operationId: "5".repeat(64),
    mediaType, bodyEncoding: kind, bodyText: bytes.toString(kind), resultHash: domainHash("apn.x402.result-body.v1", bytes),
    byteLength: bytes.length.toString(), responseStatus: "200", createdAt: "2026-10-19T10:00:00.000Z" });
}

test("the captured opaque result publishes its real body SHA-256 and the stored domain hash under its own name", () => {
  const record = validateX402Result(stored(BODY, "base64", "application/json"));
  assert.equal(record.resultHash, DOMAIN_HASH, "the stored internal hash and every link to it are unchanged");
  const view = projectPublicX402Result({ variant: "local", result: record }) as unknown as Record<string, unknown>;
  assert.deepEqual(view, { kind: "x402_result", media_type: "application/json", body_encoding: "base64", body: BODY.toString("base64"),
    sha256: BODY_SHA256, byte_length: "45", result_hash: DOMAIN_HASH, result_hash_rule: X402_RESULT_HASH_RULE });
  // A client's ordinary checksum of the decoded body now matches.
  assert.equal(sha256(Buffer.from(view.body as string, "base64")), view.sha256);
  for (const forged of [{ ...view, sha256: DOMAIN_HASH }, { ...view, result_hash: BODY_SHA256 }, { ...view, result_hash_rule: "sha256(body)" }, { ...view, byte_length: "44" }]) {
    assert.throws(() => validatePublicX402Result(forged), TypeError);
  }
});

test("text and JSON results carry the same two names; JSON keeps its parsed body", () => {
  const text = Buffer.from("plain answer ✓", "utf8");
  const textView = projectPublicX402Result({ variant: "local", result: validateX402Result(stored(text, "utf8", "text/plain")) }) as unknown as Record<string, unknown>;
  assert.equal(textView.body, "plain answer ✓"); assert.equal(textView.sha256, sha256(text));
  assert.equal(textView.result_hash, domainHash("apn.x402.result-body.v1", text)); assert.equal(textView.byte_length, String(text.length));
  assert.throws(() => validatePublicX402Result({ ...textView, sha256: textView.result_hash }), TypeError);
  const jsonView = projectPublicX402Result({ variant: "local", result: validateX402Result(stored(BODY, "utf8", "application/json")) }) as unknown as Record<string, unknown>;
  assert.deepEqual(jsonView.body, { jsonrpc: "2.0", id: 1, result: "0x325bf45" });
  assert.equal(jsonView.sha256, BODY_SHA256); assert.equal(jsonView.result_hash, DOMAIN_HASH); assert.equal(jsonView.result_hash_rule, X402_RESULT_HASH_RULE);
});

test("a normalized provider result keeps its plain SHA-256 of the canonical JSON and no domain hash", () => {
  const canonical = '{"ok":true}';
  const view = projectPublicX402Result({ variant: "normalized_provider_json", result: { classification: "normalized_provider_json", canonical_json: canonical,
    sha256: sha256(canonical), byte_length: String(Buffer.byteLength(canonical)) } as never }) as unknown as Record<string, unknown>;
  assert.equal(view.sha256, sha256(canonical)); assert.equal(Object.hasOwn(view, "result_hash"), false);
});
