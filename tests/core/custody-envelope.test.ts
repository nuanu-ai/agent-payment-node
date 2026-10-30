/** The one custody envelope (CORE-15): every buffer it creates is zeroed, and its failures reach the store's own errors. */
import assert from "node:assert/strict";
import test, { mock } from "node:test";

const crypto = await import("node:crypto");
const salts: Buffer[] = [], keys: ArrayBuffer[] = [], pieces: Buffer[] = [];
type Streaming = { update(...args: unknown[]): Buffer; final(...args: unknown[]): Buffer };
/** The real cipher, its update/final outputs recorded by reference (bytes, arguments and errors unchanged). */
function recorded<C>(cipher: C): C {
  const c = cipher as unknown as Streaming, update = c.update.bind(c), final = c.final.bind(c);
  c.update = (...args) => { const out = update(...args); pieces.push(out); return out; };
  c.final = (...args) => { const out = final(...args); pieces.push(out); return out; };
  return cipher;
}
const real = crypto as unknown as { createCipheriv(...args: unknown[]): unknown; createDecipheriv(...args: unknown[]): unknown };
// Only what custody-envelope.ts and canonical.ts import: a builtin cannot be re-exported whole.
mock.module("node:crypto", { namedExports: { createCipheriv: (...args: unknown[]) => recorded(real.createCipheriv(...args)),
  createDecipheriv: (...args: unknown[]) => recorded(real.createDecipheriv(...args)), createHash: crypto.createHash,
  randomBytes: (size: number) => { const bytes = crypto.randomBytes(size); salts.push(bytes); return bytes; },
  hkdfSync: (...args: Parameters<typeof crypto.hkdfSync>) => { const key = crypto.hkdfSync(...args); keys.push(key); return key; },
} });
const { ApnError } = await import("../../src/errors.js");
const { openCanonicalJson, openEnvelope, sealCanonicalJson, sealEnvelope } = await import("../../src/custody-envelope.js");
const { gcmAuthenticationFailure, isGcmAuthenticationError } = await import("./crypto-auth-failure.js");
type Spec = import("../../src/custody-envelope.js").EnvelopeSpec<{ readonly id: string; readonly salt: string; readonly nonce: string }>;

const failures: unknown[][] = [], causes: unknown[] = [];
const spec: Spec = { info: h => `test\0${h.id}`, aad: h => h, maxFieldBytes: 64,
  fail: (failure, field, cause) => { failures.push([failure, field, cause instanceof Error ? cause.message : cause]); causes.push(cause); throw new ApnError("APN_STATE_CORRUPT", `${failure}:${field}`); } };
const secret = Buffer.alloc(32, 3);
const zero = (bytes: Uint8Array) => bytes.every(byte => byte === 0);
const header = (salt: string, nonce: string) => ({ id: "a", salt, nonce });

test("sealing zeroes the plaintext, the salt and nonce bytes and the derived key; the caller keeps the secret", () => {
  salts.length = 0; keys.length = 0;
  const plaintext = Buffer.from("{\"a\":1}", "utf8");
  const sealed = sealEnvelope(secret, spec, header, plaintext);
  assert.equal(sealed.header.salt, sealed.salt); assert.equal(sealed.header.nonce, sealed.nonce);
  assert.ok(zero(plaintext)); assert.equal(salts.length, 2); assert.ok(salts.every(zero));
  assert.equal(keys.length, 1); assert.ok(zero(new Uint8Array(keys[0]!)));
  assert.ok(!zero(secret), "the wrapping secret belongs to the caller, which zeroes it");
});

test("opening hands the plaintext to the store once, then zeroes it and the key, also on refusal", async () => {
  const sealed = sealCanonicalJson(secret, spec, header, { a: 1 });
  keys.length = 0; let seen: Buffer | undefined;
  const value = await openEnvelope(secret, spec, sealed.header, sealed, plaintext => { seen = plaintext; return plaintext.toString("utf8"); });
  assert.equal(value, "{\"a\":1}"); assert.ok(seen !== undefined && zero(seen)); assert.ok(zero(new Uint8Array(keys[0]!)));
  keys.length = 0; failures.length = 0; causes.length = 0;
  await assert.rejects(openEnvelope(Buffer.alloc(32, 4), spec, sealed.header, sealed, () => "unreachable"), { code: "APN_STATE_CORRUPT" });
  // The decipher's own error, worded by the linked OpenSSL (crypto-auth-failure.ts); the consumer never ran.
  assert.deepEqual(failures.map(([failure, field]) => [failure, field]), [["authentication", null]]);
  assert.equal(causes.length, 1); assert.ok(isGcmAuthenticationError(causes[0]), `not an AES-GCM authentication failure: ${String(causes[0])}`);
  assert.ok(zero(new Uint8Array(keys[0]!)));
});

test("every update and final output is zeroed: sealing, opening, a wrong tag, key or AAD, a store refusal and a validator crash", async () => {
  // Regression: update() returned the plaintext before final() authenticated it,
  // and only the concatenation was zeroed, also when final() threw on a wrong tag.
  const outputs = async (action: () => unknown) => {
    pieces.length = 0;
    try { await action(); } catch { /* the refusal itself is asserted elsewhere */ }
    return pieces.map(piece => [piece.length > 0, zero(piece)]);
  };
  const value = { secret: "s".repeat(24) };
  assert.deepEqual(await outputs(() => sealCanonicalJson(secret, spec, header, value)), [[true, true], [false, true]], "seal: update and final");
  const sealed = sealCanonicalJson(secret, spec, header, value);
  let atUse: unknown;
  assert.deepEqual(await outputs(() => openEnvelope(secret, spec, sealed.header, sealed, plaintext => {
    // The pieces are zeroed before the store sees the plaintext, which has memory of its own (not a slice of the shared pool).
    atUse = [pieces.map(zero), plaintext.byteOffset, plaintext.buffer.byteLength === plaintext.length];
    return plaintext.toString("utf8");
  })), [[true, true], [false, true]], "open: update and final");
  assert.deepEqual(atUse, [[true, true], 0, true]);
  const tag = Buffer.from(sealed.tag, "base64"); tag[0]! ^= 1;
  assert.deepEqual(await outputs(() => openEnvelope(secret, spec, sealed.header, { ...sealed, tag: tag.toString("base64") }, () => "unreachable")),
    [[true, true]], "a wrong tag: final() threw after update() returned the plaintext");
  assert.deepEqual(await outputs(() => openEnvelope(Buffer.alloc(32, 4), spec, sealed.header, sealed, () => "unreachable")), [[true, true]], "a wrong key");
  assert.deepEqual(await outputs(() => openEnvelope(secret, { ...spec, aad: h => ({ ...h, extra: true }) }, sealed.header, sealed, () => "unreachable")),
    [[true, true]], "a changed AAD");
  assert.deepEqual(await outputs(() => openCanonicalJson(secret, spec, sealed.header, sealed, () => { throw new ApnError("APN_OPERATION_BLOCKED", "store refusal"); })),
    [[true, true], [false, true]], "a store refusal");
  assert.deepEqual(await outputs(() => openCanonicalJson(secret, spec, sealed.header, sealed, () => { throw new TypeError("validator crashed"); })),
    [[true, true], [false, true]], "a validator crash");
});

test("strict base64, exact lengths and the store's size bound are checked before any key is derived", async () => {
  const sealed = sealCanonicalJson(secret, spec, header, { a: 1 });
  const cases: readonly [Partial<Record<"salt" | "nonce" | "ciphertext" | "tag", string>>, string, string][] = [
    [{ tag: `${sealed.tag}A` }, "encoding", "tag"], [{ salt: sealed.salt.replace(/=*$/u, "") }, "encoding", "salt"],
    [{ nonce: Buffer.alloc(16).toString("base64") }, "decoding", "nonce"], [{ ciphertext: "" }, "decoding", "ciphertext"],
    [{ ciphertext: Buffer.alloc(65).toString("base64") }, "decoding", "ciphertext"], [{ tag: "AB==" }, "decoding", "tag"],
  ];
  for (const [change, failure, field] of cases) {
    keys.length = 0; failures.length = 0;
    await assert.rejects(openEnvelope(secret, spec, sealed.header, { ...sealed, ...change }, () => "unreachable"), { code: "APN_STATE_CORRUPT" });
    assert.deepEqual(failures, [[failure, field, null]], JSON.stringify(change)); assert.equal(keys.length, 0);
  }
});

test("canonical JSON is required; an APN error from the store passes through, any other error is authentication", async () => {
  const pretty = sealEnvelope(secret, spec, header, Buffer.from("{ \"a\": 1 }", "utf8"));
  failures.length = 0;
  await assert.rejects(openCanonicalJson(secret, spec, pretty.header, pretty, value => value), { code: "APN_STATE_CORRUPT" });
  assert.deepEqual(failures, [["canonical_plaintext", null, null]]);
  const sealed = sealCanonicalJson(secret, spec, header, { a: 1 });
  failures.length = 0;
  await assert.rejects(openCanonicalJson(secret, spec, sealed.header, sealed, () => { throw new ApnError("APN_OPERATION_BLOCKED", "store refusal"); }),
    { code: "APN_OPERATION_BLOCKED", message: "store refusal" });
  await assert.rejects(openCanonicalJson(secret, spec, sealed.header, sealed, () => { throw new TypeError("validator crashed"); }), { code: "APN_STATE_CORRUPT" });
  assert.deepEqual(failures, [["authentication", null, "validator crashed"]]);
  assert.deepEqual(await openCanonicalJson(secret, spec, sealed.header, sealed, value => value), { a: 1 });
  await assert.rejects(openCanonicalJson(secret, spec, { ...sealed.header, id: "b" }, sealed, value => value), { code: "APN_STATE_CORRUPT" },
    "the AAD binds the header");
});

test("only the two exact AES-GCM authentication-failure forms count as one", () => {
  assert.equal(gcmAuthenticationFailure("Error", undefined, "Unsupported state or unable to authenticate data"), true);
  assert.equal(gcmAuthenticationFailure("Error", "ERR_OSSL_BAD_DECRYPT", "error:1C800064:Provider routines::bad decrypt"), true);
  for (const [name, code, message] of [["Error", "ERR_OSSL_BAD_DECRYPT", "Unsupported state or unable to authenticate data"],
    ["Error", null, "error:1C800064:Provider routines::bad decrypt"], ["TypeError", null, "Unsupported state or unable to authenticate data"],
    ["Error", "ERR_OSSL_EVP_BAD_DECRYPT", "error:1C800064:Provider routines::bad decrypt"], ["Error", null, "validator crashed"],
    ["ApnError", "APN_STATE_CORRUPT", "authentication:null"]] as const) {
    assert.equal(gcmAuthenticationFailure(name, code, message), false, `${name} ${code} ${message}`);
  }
  assert.equal(isGcmAuthenticationError(new TypeError("Unsupported state or unable to authenticate data")), false);
});
