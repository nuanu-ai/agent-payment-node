import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import test from "node:test";
import { assertUnusedResponses, verifyArchive } from "../../scripts/local-release.mjs";
const hash = bytes => createHash("sha256").update(bytes).digest("hex");
async function fixture(t) {
  const root = await mkdtemp(resolve(tmpdir(), "apn-local-release-")); t.after(() => rm(root, { recursive: true, force: true }));
  const source = resolve(root, "source"), payload = resolve(root, "payload/package");
  await mkdir(source); await mkdir(payload, { recursive: true });
  const pkg = JSON.stringify({ name: "@nuanu-ai/apn", version: "0.5.36", os: ["darwin"], cpu: ["arm64"] });
  for (const dir of [source, payload]) { await writeFile(resolve(dir, "package.json"), pkg); await writeFile(resolve(dir, "entry.js"), "reviewed runtime\n"); }
  const archive = resolve(root, "nuanu-ai-apn-0.5.36.tgz");
  assert.equal(spawnSync("tar", ["-czf", archive, "-C", resolve(root, "payload"), "package"]).status, 0);
  return { root, source, payload, archive, files: [{ path: "package.json" }, { path: "entry.js" }], expected: { version: "0.5.36", sourceRoot: source, sha256: hash(await readFile(archive)) } };
}
test("unused release target requires both authoritative tag and release absence; existing/unknown/auth failures refuse", () => {
  assert.doesNotThrow(() => assertUnusedResponses("0.5.36", [{ status: 404 }, { status: 404 }]));
  for (const rows of [[{ status: 200 }, { status: 404 }], [{ status: 404 }, { status: 200 }], [{ status: 401 }, { status: 404 }], [{ status: 404 }]]) {
    assert.throws(() => assertUnusedResponses("0.5.36", rows), /immutable version refused/);
  }
  for (const version of ["v0.5.36", "0.05.36", "0.5.36-beta", "0.5.36/other"]) assert.throws(() => assertUnusedResponses(version, [{ status: 404 }, { status: 404 }]));
});
test("local verification proves embedded archive identity and exact reviewed member bytes", async t => {
  const f = await fixture(t); await verifyArchive(f.archive, f.expected, f.files);
  await assert.rejects(verifyArchive(f.archive, { ...f.expected, version: "0.5.37" }, f.files), /embedded version/);
  await writeFile(resolve(f.source, "entry.js"), "unreviewed runtime\n");
  await assert.rejects(verifyArchive(f.archive, f.expected, f.files), /member bytes differ/);
});
test("corrupted bytes and a digest-rebound archive with undeclared content cannot pass release verification", async t => {
  const f = await fixture(t);
  await writeFile(f.archive, Buffer.concat([await readFile(f.archive), Buffer.from("corruption")]));
  await assert.rejects(verifyArchive(f.archive, f.expected, f.files), /digest differs/);
  await writeFile(resolve(f.payload, "extra.js"), "unreviewed\n");
  assert.equal(spawnSync("tar", ["-czf", f.archive, "-C", resolve(f.root, "payload"), "package"]).status, 0);
  await assert.rejects(verifyArchive(f.archive, { ...f.expected, sha256: hash(await readFile(f.archive)) }, f.files), /member set differs/);
});
