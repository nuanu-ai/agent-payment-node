import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { copyFile, link, mkdir, readFile, rm, stat, symlink, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import test from "node:test";
import { canonicalJson, sha256 } from "../../src/canonical.js";
import { OperationService } from "../../src/operation-service.js";
import { saRequestHash } from "../../src/smart-account-gasless/operation-model.js";
import { SmartAccountGaslessOperationRepository } from "../../src/smart-account-gasless/operation-repository.js";
import { SA_RECOVERY_REQUIRED_ARTIFACTS, selectSmartAccountGaslessRecoveryArchive,
  type SmartAccountGaslessRecoveryTarget } from "../../src/smart-account-gasless/recovery-gate.js";
import { advanceSmartAccountGaslessOperation as advance, newSmartAccountGaslessOperation,
  smartAccountGaslessAtTransition } from "../../src/smart-account-gasless/transitions.js";
import { smartAccountGaslessReceipt } from "../../src/smart-account-gasless/receipt.js";
import { StateStore } from "../../src/state.js";
import { temporaryState } from "./helpers.js";
import { saStructuralMaterial, saTestIntent } from "./smart-account-gasless-fixtures.js";

const exec = promisify(execFile), denied = { code: "APN_OPERATION_BLOCKED", details: { reason: "sa_gasless_archive_incompatible" } };
type Manifest = { archive: string; archiveSha256: string; packageRoot: string; sourceCommit: string;
  fileCount: number; allArchiveFilesMatchGitSourceAndInstalledBytes: boolean;
  files: Array<{ path: string; sha256: string; bytes: number }> };

/** Unit-level trusted verification manifest. Real tar/member/source identity is proved by installed archive tests. */
async function target(root: string, current: boolean): Promise<{ input: SmartAccountGaslessRecoveryTarget; manifest: Manifest }> {
  await mkdir(root, { recursive: true });
  const packageRoot = join(root, "package"), archive = join(root, "archive-fixture.tgz"), manifestPath = join(root, "verified.json");
  await mkdir(packageRoot);
  const files: Manifest["files"] = [];
  for (const path of current ? SA_RECOVERY_REQUIRED_ARTIFACTS : ["dist/operation-service.js"]) {
    const destination = join(packageRoot, path); await mkdir(dirname(destination), { recursive: true });
    if (current) await copyFile(fileURLToPath(new URL(`../../src/${path.slice(5)}`, import.meta.url)), destination);
    else await writeFile(destination, "throw new Error('target executable must never run during selection');\n");
    const bytes = await readFile(destination); files.push({ path, sha256: sha256(bytes), bytes: bytes.length });
  }
  await writeFile(archive, "synthetic archive identity fixture; no package extraction is claimed by this unit test");
  const manifest: Manifest = { archive, archiveSha256: sha256(await readFile(archive)), packageRoot,
    sourceCommit: "1".repeat(40), fileCount: files.length, allArchiveFilesMatchGitSourceAndInstalledBytes: true, files };
  await writeFile(manifestPath, canonicalJson(manifest));
  return { input: { stateRoot: join(root, "state"), archive, packageRoot, manifest: manifestPath,
    manifestSha256: sha256(await readFile(manifestPath)) }, manifest };
}
async function seed(stateRoot: string) {
  const state = new StateStore(stateRoot); await state.initialize();
  const intent = saTestIntent(), profileHash = state.profileHash(intent.profile), key = "compatibility-fixture";
  const records = new SmartAccountGaslessOperationRepository(stateRoot);
  let operation = newSmartAccountGaslessOperation({ operationId: state.operationId(intent.profile, key), profileHash,
    idempotencyHash: state.idempotencyHash(key), requestHash: saRequestHash(profileHash, intent) }, intent);
  await records.persist(operation);
  const at = operation.createdAt;
  operation = advance(operation, { state: "execution_pending", approval: { fingerprint: operation.fingerprint,
    approvedAt: at, expiresAt: intent.expiresAt } }, at); await records.persist(operation);
  operation = advance(operation, { state: "material_pending", signingAttempts: 1 }, at); await records.persist(operation);
  operation = advance(operation, { state: "material_sealed", material: saStructuralMaterial(operation).descriptor }, at); await records.persist(operation);
  operation = advance(operation, { state: "exposure_pending", exposureAttempts: 1, exposureStartedAt: at }, at); await records.persist(operation);
  return { records, operation, state };
}
async function fingerprint(root: string, operation: Awaited<ReturnType<typeof seed>>["operation"]) {
  return await Promise.all(["smart-account-gasless-operations", "smart-account-gasless-receipts"].map(async folder =>
    sha256(await readFile(join(root, folder, operation.profileHash, `${operation.operationId}.json`)))));
}
async function manifestWrite(candidate: Awaited<ReturnType<typeof target>>, patch: (value: Manifest) => void) {
  patch(candidate.manifest); await writeFile(candidate.input.manifest, canonicalJson(candidate.manifest));
  return { ...candidate.input, manifestSha256: sha256(await readFile(candidate.input.manifest)) };
}

test("the recovery gate rejects a legacy target for exposed state without executing it or mutating the journal", async t => {
  const temporary = await temporaryState(); t.after(temporary.cleanup);
  const legacy = await target(temporary.root, false), f = await seed(legacy.input.stateRoot), before = await fingerprint(f.state.root, f.operation);
  await assert.rejects(selectSmartAccountGaslessRecoveryArchive(legacy.input), denied);
  assert.deepEqual(await fingerprint(f.state.root, f.operation), before);
  await assert.rejects(new OperationService(f.state).assertProfileAvailable(f.operation.profileHash), { code: "APN_OPERATION_BLOCKED" });
  const modulePath = fileURLToPath(new URL("../../src/smart-account-gasless/recovery-gate.js", import.meta.url));
  try {
    await exec(process.execPath, [modulePath, "--state-root", legacy.input.stateRoot, "--archive", legacy.input.archive,
      "--manifest", legacy.input.manifest, "--manifest-sha256", legacy.input.manifestSha256, "--package-root", legacy.input.packageRoot]);
    assert.fail("legacy target must be refused by the operator entry point");
  } catch (error) {
    const failure = error as { code?: number; stdout?: string; stderr?: string };
    assert.equal(failure.code, 1); assert.equal(failure.stderr, "");
    assert.deepEqual(JSON.parse(failure.stdout!), { ok: false, error: { code: "APN_OPERATION_BLOCKED", reason: "sa_gasless_archive_incompatible" } });
  }
  assert.deepEqual(await fingerprint(f.state.root, f.operation), before);
});

test("the current byte-bound runtime passes selection with its existing guard and no receipt repair", async t => {
  const temporary = await temporaryState(); t.after(temporary.cleanup);
  const current = await target(temporary.root, true), f = await seed(current.input.stateRoot), before = await fingerprint(f.state.root, f.operation);
  const selected = await selectSmartAccountGaslessRecoveryArchive(current.input);
  assert.equal(selected.supports_smart_account_gasless, true); assert.equal(selected.guards_held, 1);
  assert.equal(selected.smart_account_operations, 1); assert.equal(selected.target_execution_performed, false);
  assert.equal(Object.keys(selected.required_runtime_hashes).length, SA_RECOVERY_REQUIRED_ARTIFACTS.length);
  assert.equal(selected.archive_sha256, current.manifest.archiveSha256);
  assert.deepEqual(await fingerprint(f.state.root, f.operation), before);
  const second = await selectSmartAccountGaslessRecoveryArchive(current.input); assert.deepEqual(second, selected);
});

test("legacy selection is allowed only for a validated existing state with no new-family operation", async t => {
  const temporary = await temporaryState(); t.after(temporary.cleanup);
  const legacy = await target(temporary.root, false); await new StateStore(legacy.input.stateRoot).initialize();
  const selected = await selectSmartAccountGaslessRecoveryArchive(legacy.input);
  assert.equal(selected.supports_smart_account_gasless, false); assert.equal(selected.smart_account_operations, 0);
  assert.equal(selected.target_execution_performed, false);
  await rm(legacy.input.stateRoot, { recursive: true });
  await assert.rejects(selectSmartAccountGaslessRecoveryArchive(legacy.input), denied);
  await assert.rejects(stat(legacy.input.stateRoot), { code: "ENOENT" });
});

test("recovery selection validates paired receipts and rejects malformed, linked or orphan sidecars", async t => {
  const temporary = await temporaryState(); t.after(temporary.cleanup);
  for (const kind of ["malformed", "symlink", "hardlink", "orphan"] as const) {
    const current = await target(join(temporary.root, kind), true), f = await seed(current.input.stateRoot);
    const file = join(f.state.root, "smart-account-gasless-receipts", f.operation.profileHash, `${f.operation.operationId}.json`);
    if (kind === "malformed") await writeFile(file, "{}");
    if (kind === "symlink" || kind === "hardlink") {
      const copy = join(temporary.root, `${kind}-receipt.json`); await copyFile(file, copy); await rm(file);
      if (kind === "symlink") await symlink(copy, file); else await link(copy, file);
    }
    if (kind === "orphan") await copyFile(file, join(dirname(file), `${"9".repeat(64)}.json`));
    await assert.rejects(selectSmartAccountGaslessRecoveryArchive(current.input), denied, kind);
  }
});

test("selection preserves a missing or authenticated older receipt for operation-first crash recovery", async t => {
  const temporary = await temporaryState(); t.after(temporary.cleanup);
  for (const kind of ["missing", "earlier"] as const) {
    const current = await target(join(temporary.root, kind), true), f = await seed(current.input.stateRoot);
    const file = join(f.state.root, "smart-account-gasless-receipts", f.operation.profileHash, `${f.operation.operationId}.json`);
    const complete = await selectSmartAccountGaslessRecoveryArchive(current.input);
    if (kind === "missing") await rm(file);
    else await writeFile(file, canonicalJson(smartAccountGaslessReceipt(smartAccountGaslessAtTransition(f.operation, 0))));
    const before = kind === "missing" ? null : await readFile(file);
    const selected = await selectSmartAccountGaslessRecoveryArchive(current.input);
    assert.equal(selected.guards_held, 1); assert.notEqual(selected.state_digest, complete.state_digest);
    if (kind === "missing") await assert.rejects(stat(file), { code: "ENOENT" });
    else assert.deepEqual(await readFile(file), before);
  }
});

test("archive selection rejects unverified, stale, missing, forged and unlisted target bytes", async t => {
  const temporary = await temporaryState(); t.after(temporary.cleanup);
  for (const kind of ["unverified", "manifest-hash", "archive-hash", "missing", "changed-binding", "duplicate", "traversal", "extra"] as const) {
    const candidate = await target(join(temporary.root, kind), true); await seed(candidate.input.stateRoot);
    let input = candidate.input;
    if (kind === "unverified") input = await manifestWrite(candidate, m => { m.allArchiveFilesMatchGitSourceAndInstalledBytes = false; });
    if (kind === "manifest-hash") input = { ...input, manifestSha256: "f".repeat(64) };
    if (kind === "archive-hash") await writeFile(input.archive, "changed bytes");
    if (kind === "missing") await rm(join(input.packageRoot, "dist/smart-account-gasless/operation-repository.js"));
    if (kind === "changed-binding") {
      const file = candidate.manifest.files.find(item => item.path === "dist/operation-service.js")!;
      await writeFile(join(input.packageRoot, file.path), "export class OperationService {}\n");
      const bytes = await readFile(join(input.packageRoot, file.path));
      input = await manifestWrite(candidate, () => { file.sha256 = sha256(bytes); file.bytes = bytes.length; });
    }
    if (kind === "duplicate") input = await manifestWrite(candidate, m => { m.files.push(m.files[0]!); m.fileCount++; });
    if (kind === "traversal") input = await manifestWrite(candidate, m => { m.files[0]!.path = "../outside.js"; });
    if (kind === "extra") await writeFile(join(input.packageRoot, "dist/unlisted.js"), "extra");
    await assert.rejects(selectSmartAccountGaslessRecoveryArchive(input), denied, kind);
  }
});

test("malformed public journals, symbolic links and hard-linked archive members never pass selection", async t => {
  const temporary = await temporaryState(); t.after(temporary.cleanup);
  for (const kind of ["state", "state-symlink", "file-symlink", "file-hardlink"] as const) {
    const current = await target(join(temporary.root, kind), true), f = await seed(current.input.stateRoot);
    let input = current.input;
    if (kind === "state") await writeFile(join(input.stateRoot, "smart-account-gasless-operations", f.operation.profileHash,
      `${f.operation.operationId}.json`), "{}");
    if (kind === "state-symlink") {
      const alias = join(dirname(input.stateRoot), "state-alias"); await symlink(input.stateRoot, alias); input = { ...input, stateRoot: alias };
    }
    if (kind === "file-symlink" || kind === "file-hardlink") {
      const path = join(input.packageRoot, "dist/operation-service.js"), original = join(dirname(input.packageRoot), "original.js");
      await copyFile(path, original); await rm(path);
      if (kind === "file-symlink") await symlink(original, path); else await link(original, path);
    }
    await assert.rejects(selectSmartAccountGaslessRecoveryArchive(input), denied, kind);
  }
});
