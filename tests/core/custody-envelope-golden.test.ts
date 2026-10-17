/**
 * Byte compatibility of every custody store with APN 0.5.45 (CORE-15): the golden envelopes sealed by the 0.5.45 stores
 * open, every tampered variant fails exactly as it failed on 0.5.45 (same error class, code, message and details), and
 * a newly sealed envelope opens with the 0.5.45 format, so 0.5.45 opens it. Synthetic keys and a fixed fake wrapping
 * secret only; the Keychain is never touched.
 */
import assert from "node:assert/strict";
import test from "node:test";
import { canonicalJson } from "../../src/canonical.js";
import { installCustodyEnvelopeMocks } from "./custody-envelope-mocks.js";
import { FixedSecret, readGolden, referenceOpen, type Outcome, temporaryRoot } from "./custody-envelope-reference.js";
import { caseOutcomes, readEnvelopeFiles } from "./custody-envelope-harness.js";

await installCustodyEnvelopeMocks();
const { CUSTODY_CASES } = await import("./custody-envelope-cases.js");
const golden = await readGolden(), secret = Buffer.from(golden.secret, "base64");
const encoding = (name: string): BufferEncoding => name === "merchantMaterial" ? "ascii" : "utf8";

/** Deliberate differences from 0.5.45. Each still fails closed with the same error code where 0.5.45 failed. */
const DIVERGENCES: Readonly<Record<string, Readonly<Record<string, string>>>> = {};

test("every custody store has a 0.5.45 golden envelope", () => {
  assert.deepEqual(Object.keys(golden.cases).sort(), Object.keys(CUSTODY_CASES).sort());
  assert.equal(Object.keys(golden.cases).length, 14, "13 stores; gasless seals two roles");
});

for (const [name, c] of Object.entries(CUSTODY_CASES)) {
  test(`${name}: the 0.5.45 golden envelope opens and every tamper fails exactly as on 0.5.45`, async () => {
    const g = golden.cases[name]!;
    assert.equal(referenceOpen(c.format, g.files[g.envelopePath], secret).toString(encoding(name)), g.plaintext,
      "the reference is the 0.5.45 format");
    const outcomes = await caseOutcomes(c, g, secret);
    assert.deepEqual(Object.keys(outcomes).sort(), Object.keys(g.outcomes).sort());
    if (c.open !== undefined) assert.deepEqual(g.outcomes.golden, { ok: true, plaintext: g.plaintext });
    for (const [kind, expected] of Object.entries(g.outcomes)) {
      const actual = outcomes[kind] as Outcome, divergence = DIVERGENCES[name]?.[kind];
      if (divergence === undefined) { assert.deepEqual(actual, expected, `${name} ${kind}`); continue; }
      assert.equal(actual.ok, false, `${name} ${kind}: ${divergence}`);
      if (!actual.ok) assert.equal(actual.code, "APN_STATE_CORRUPT", `${name} ${kind}: ${divergence}`);
    }
  });

  test(`${name}: a new envelope opens with the 0.5.45 format and every secret copy is zeroed`, async () => {
    const temporary = await temporaryRoot();
    try {
      const spy = new FixedSecret(secret);
      const sealed = await c.seal(temporary.root, spy);
      const files = await readEnvelopeFiles(temporary.root, sealed.files);
      assert.equal(referenceOpen(c.format, files[sealed.envelopePath], secret).toString(encoding(name)), sealed.plaintext);
      if (c.open !== undefined) assert.equal(canonicalJson(await c.open(temporary.root, spy, sealed.context)), sealed.plaintext);
      assert.ok(spy.handed.length > 0);
      for (const copy of spy.handed) assert.ok(copy.every(byte => byte === 0), `${name}: a wrapping-secret copy was left unzeroed`);
    } finally { await temporary.cleanup(); }
  });
}
