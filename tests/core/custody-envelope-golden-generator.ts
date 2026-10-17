/**
 * Writes tests/fixtures/custody-envelopes/golden-0.5.45.json. It was run once, on APN 0.5.45 (73d73bad), before the
 * envelope code moved into src/custody-envelope.ts: the envelopes and every recorded outcome are what 0.5.45 did.
 * Run from the package root: node --experimental-test-module-mocks dist-test/tests/core/custody-envelope-golden-generator.js
 */
import { randomBytes } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { installCustodyEnvelopeMocks } from "./custody-envelope-mocks.js";
import { FixedSecret, GOLDEN_PATH, referenceOpen, type Golden, type GoldenCase, temporaryRoot } from "./custody-envelope-reference.js";
import { caseOutcomes, readEnvelopeFiles } from "./custody-envelope-harness.js";

await installCustodyEnvelopeMocks();
const { CUSTODY_CASES } = await import("./custody-envelope-cases.js");
const secret = randomBytes(32), cases: Record<string, GoldenCase> = {};
for (const [name, c] of Object.entries(CUSTODY_CASES)) {
  const temporary = await temporaryRoot();
  try {
    const sealed = await c.seal(temporary.root, new FixedSecret(secret));
    const files = await readEnvelopeFiles(temporary.root, sealed.files);
    const opened = referenceOpen(c.format, files[sealed.envelopePath], secret).toString(name === "merchantMaterial" ? "ascii" : "utf8");
    if (opened !== sealed.plaintext) throw new Error(`${name}: the reference format does not open what the store sealed`);
    const input = { files, envelopePath: sealed.envelopePath, context: sealed.context, plaintext: sealed.plaintext };
    cases[name] = { ...input, outcomes: await caseOutcomes(c, input, secret) };
  } finally { await temporary.cleanup(); }
}
const golden: Golden = { schemaVersion: "apn.custody-envelope-golden.v1", producedBy: "APN 0.5.45 (73d73bad) stores",
  secret: secret.toString("base64"), cases };
await mkdir(dirname(GOLDEN_PATH), { recursive: true });
await writeFile(GOLDEN_PATH, `${JSON.stringify(golden, null, 1)}\n`);
console.log(`wrote ${GOLDEN_PATH}: ${Object.keys(cases).length} stores`);
