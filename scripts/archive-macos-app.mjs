#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { access, lstat, mkdir, mkdtemp, readFile, readdir, rename, rm, stat, writeFile } from "node:fs/promises";
import { constants as fsConstants } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { assertNotarizedAppProof, assertSameNotarizedApp } from "./release-proof.mjs";

const scriptDir = dirname(fileURLToPath(import.meta.url));

function parseArgs(argv) {
  const values = new Map();
  for (let index = 0; index < argv.length; index += 2) {
    const key = argv[index];
    const value = argv[index + 1];
    if (!key?.startsWith("--") || value === undefined || values.has(key.slice(2))) {
      throw new Error("arguments must be unique --name value pairs");
    }
    values.set(key.slice(2), value);
  }
  return values;
}

async function mustNotExist(path) {
  try {
    await access(path, fsConstants.F_OK);
    throw new Error(`refusing to overwrite: ${path}`);
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }
}

async function sha256(path) {
  return createHash("sha256").update(await readFile(path)).digest("hex");
}

async function bundleDigest(root, current = root) {
  const rows = [];
  for (const entry of await readdir(current, { withFileTypes: true })) {
    const path = resolve(current, entry.name);
    const metadata = await lstat(path);
    if (metadata.isSymbolicLink()) throw new Error("app bundle contains a symlink");
    if (metadata.isDirectory()) rows.push(...await bundleDigest(root, path));
    else if (metadata.isFile()) rows.push({
      path: relative(root, path).split(sep).join("/"),
      sha256: await sha256(path),
    });
    else throw new Error("app bundle contains a non-regular object");
  }
  if (current !== root) return rows;
  rows.sort((left, right) => left.path.localeCompare(right.path));
  return createHash("sha256").update(JSON.stringify(rows)).digest("hex");
}

const values = parseArgs(process.argv.slice(2));
const app = resolve(values.get("app") ?? "");
const proofPath = resolve(values.get("notarized-app-manifest") ?? "");
const expectedTeamId = values.get("expected-team-id") ?? "";
const output = resolve(values.get("output") ?? "");
const outputManifest = resolve(values.get("output-manifest") ?? "");
if (!values.get("app") || !values.get("notarized-app-manifest") ||
    !values.get("expected-team-id") || !values.get("output") || !values.get("output-manifest")) {
  throw new Error("--app, --notarized-app-manifest, --expected-team-id, --output and --output-manifest are required");
}
if (!/^[A-Z0-9]{10}$/.test(expectedTeamId)) throw new Error("exact expected Team ID is required");
if (basename(app) !== "APNKeychainAgent.app" || !(await stat(app)).isDirectory()) {
  throw new Error("unexpected app bundle");
}
if (!output.endsWith(".zip")) throw new Error("archive output must end with .zip");
await mustNotExist(output);
await mustNotExist(outputManifest);

const proof = assertNotarizedAppProof(JSON.parse(await readFile(proofPath, "utf8")), {
  expectedTeamId,
  expectedApp: app,
});
const verificationRoot = await mkdtemp(join(tmpdir(), "apn-archive-verify-"));
try {
  const freshAppProofPath = join(verificationRoot, "fresh-source-app.json");
  const verify = spawnSync(process.execPath, [
    resolve(scriptDir, "verify-macos-app.mjs"),
    "--app", app,
    "--mode", "notarized",
    "--expected-team-id", expectedTeamId,
    "--output-manifest", freshAppProofPath,
  ], { stdio: "inherit" });
  if (verify.error || verify.status !== 0) throw new Error("fresh notarized app verification failed");
  const freshAppProof = assertNotarizedAppProof(JSON.parse(await readFile(freshAppProofPath, "utf8")), {
    expectedTeamId,
    expectedApp: app,
  });
  assertSameNotarizedApp(freshAppProof, proof);
  if (await bundleDigest(app) !== proof.bundleDigest) {
    throw new Error("app changed after notarized verification manifest was issued");
  }

  const archived = spawnSync("ditto", ["-c", "-k", "--sequesterRsrc", "--keepParent", app, output], {
    stdio: "inherit",
  });
  if (archived.error || archived.status !== 0) throw new Error("ditto archive creation failed");
  const extractionRoot = join(verificationRoot, "extracted");
  await mkdir(extractionRoot, { mode: 0o700 });
  const extracted = spawnSync("ditto", ["-x", "-k", output, extractionRoot], { stdio: "inherit" });
  if (extracted.error || extracted.status !== 0) throw new Error("archive extraction verification failed");
  const extractedApp = resolve(extractionRoot, "APNKeychainAgent.app");
  const freshExtractedProofPath = join(verificationRoot, "fresh-extracted-app.json");
  const extractedVerify = spawnSync(process.execPath, [
    resolve(scriptDir, "verify-macos-app.mjs"),
    "--app", extractedApp,
    "--mode", "notarized",
    "--expected-team-id", expectedTeamId,
    "--output-manifest", freshExtractedProofPath,
  ], { stdio: "inherit" });
  if (extractedVerify.error || extractedVerify.status !== 0) {
    throw new Error("archived app lost its signed/notarized release proof");
  }
  const freshExtractedProof = assertNotarizedAppProof(
    JSON.parse(await readFile(freshExtractedProofPath, "utf8")),
    { expectedTeamId, expectedApp: extractedApp },
  );
  assertSameNotarizedApp(freshExtractedProof, proof);
} finally {
  await rm(verificationRoot, { recursive: true, force: true });
}
const archiveSha256 = await sha256(output);
const manifest = {
  schemaVersion: "apn.notarized-archive.v1",
  proofClass: "developer_id_notarized_stapled_gatekeeper_archive",
  releaseEligible: true,
  appProofManifest: proofPath,
  appBundleDigest: proof.bundleDigest,
  version: proof.version,
  teamId: expectedTeamId,
  bundleId: proof.bundleId,
  accessGroup: proof.accessGroup,
  architectures: proof.architectures,
  archive: output,
  archiveSha256,
  bytes: (await stat(output)).size,
  published: false,
};
await mkdir(dirname(outputManifest), { recursive: true, mode: 0o700 });
const temporary = `${outputManifest}.tmp-${process.pid}`;
await writeFile(temporary, `${JSON.stringify(manifest, null, 2)}\n`, { mode: 0o600, flag: "wx" });
await rename(temporary, outputManifest);
process.stdout.write(`${JSON.stringify(manifest)}\n`);
