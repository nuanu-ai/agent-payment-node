import assert from "node:assert/strict";
import test from "node:test";
import {
  canonicalizeNormalizedProviderJson,
  isSafeNormalizedProviderJson,
  NORMALIZED_PROVIDER_JSON_LIMITS,
} from "../../src/normalized-provider-json.js";

test("normalized provider JSON accepts deterministic JSON values and source-shaped objects", () => {
  const input = {
    z: null,
    a: [true, false, 27.5, "clear", { wind: -0 }],
    forecast: Object.assign(Object.create(null) as Record<string, unknown>, { ok: true }),
  };
  assert.equal(
    canonicalizeNormalizedProviderJson(input),
    '{"a":[true,false,27.5,"clear",{"wind":0}],"forecast":{"ok":true},"z":null}',
  );
  assert.equal(isSafeNormalizedProviderJson(input), true);

  const shared = { ok: true };
  assert.equal(canonicalizeNormalizedProviderJson([shared, shared]), '[{"ok":true},{"ok":true}]');
});

test("normalized provider JSON enforces inclusive structural limits", () => {
  const depth16 = nestedArrays(16);
  assert.equal(isSafeNormalizedProviderJson(depth16), true);
  assert.equal(isSafeNormalizedProviderJson(nestedArrays(17)), false);

  assert.equal(isSafeNormalizedProviderJson(Array.from({ length: 1024 }, () => null)), true);
  assert.equal(isSafeNormalizedProviderJson(Array.from({ length: 1025 }, () => null)), false);

  const keys256 = Object.fromEntries(Array.from({ length: 256 }, (_, index) => [`k${index}`, null]));
  const keys257 = { ...keys256, overflow: null };
  assert.equal(isSafeNormalizedProviderJson(keys256), true);
  assert.equal(isSafeNormalizedProviderJson(keys257), false);

  assert.equal(isSafeNormalizedProviderJson(nodeBudget(false)), true);
  assert.equal(isSafeNormalizedProviderJson(nodeBudget(true)), false);
});

test("normalized provider JSON enforces exact string and canonical-byte limits", () => {
  assert.equal(isSafeNormalizedProviderJson("x".repeat(32_768)), true);
  assert.equal(isSafeNormalizedProviderJson("x".repeat(32_769)), false);

  const exact = Object.fromEntries([
    ...Array.from({ length: 7 }, (_, index) => [`k${index}`, "x".repeat(32_768)]),
    ["k7", "x".repeat(32_703)],
  ]);
  const canonical = canonicalizeNormalizedProviderJson(exact);
  assert.equal(Buffer.byteLength(canonical), NORMALIZED_PROVIDER_JSON_LIMITS.maxCanonicalBytes);
  (exact as Record<string, string>).k7 += "x";
  assert.equal(isSafeNormalizedProviderJson(exact), false);
});

test("normalized provider JSON rejects non-JSON structure without invoking accessors", () => {
  const cyclic: Record<string, unknown> = {};
  cyclic.self = cyclic;
  let getterCalls = 0;
  const accessor = {};
  Object.defineProperty(accessor, "safe", {
    enumerable: true,
    get() { getterCalls += 1; return true; },
  });
  const sparse = new Array<unknown>(1);
  const symbolKey = { ok: true } as Record<PropertyKey, unknown>;
  symbolKey[Symbol("hidden")] = true;
  for (const value of [
    undefined, 1n, Symbol("value"), () => true, Number.NaN, Number.POSITIVE_INFINITY,
    new Date(0), cyclic, accessor, sparse, symbolKey,
  ]) assert.equal(isSafeNormalizedProviderJson(value), false);
  assert.equal(getterCalls, 0);
});

test("normalized provider JSON rejects dangerous keys and protected credential-shaped content", () => {
  const dangerous = [
    JSON.parse('{"__proto__":true}') as unknown,
    { prototype: true },
    { constructor: true },
    { sessionToken: "canary" },
    { neutral: "owner@example.com" },
    { neutral: "Bearer abcdefghijklmnopqrstuvwxyz" },
    { neutral: "one-time code 123456" },
    { neutral: "/Users/operator/.config/wallet.key" },
  ];
  for (const value of dangerous) assert.equal(isSafeNormalizedProviderJson(value), false);
});

function nestedArrays(depth: number): unknown {
  let value: unknown = null;
  for (let index = 0; index < depth; index += 1) value = [value];
  return value;
}

function nodeBudget(overflow: boolean): unknown {
  return [
    ...Array.from({ length: 1022 }, () => [null, null, null]),
    Array.from({ length: overflow ? 6 : 5 }, () => null),
    null,
  ];
}
