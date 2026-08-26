import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";
import { assertNotarizedAppProof, assertSameNotarizedApp } from "../../scripts/release-proof.mjs";

const sourceRoot = resolve(import.meta.dirname, "../..");
const renderCask = resolve(sourceRoot, "scripts/render-cask.mjs");
const teamId = "ABCDEFGHIJ";
const version = "0.1.0";

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

async function writeClaim(root, overrides = {}) {
  const archive = join(root, "APNKeychainAgent-0.1.0-arm64.zip");
  const appProofManifest = join(root, "notarized-app.json");
  const archiveManifest = join(root, "notarized-archive.json");
  const archiveBytes = overrides.archiveBytes ?? Buffer.from("not a release archive");
  await writeFile(archive, archiveBytes);
  const bundleDigest = "a".repeat(64);
  await writeFile(appProofManifest, `${JSON.stringify({
    schemaVersion: "apn.notarized-app.v1",
    proofClass: "developer_id_notarized_stapled_gatekeeper",
    releaseEligible: true,
    app: join(root, "APNKeychainAgent.app"),
    version,
    teamId,
    bundleId: "ai.nuanu.apn.keychain-agent",
    accessGroup: `${teamId}.ai.nuanu.apn.keys`,
    architectures: ["arm64"],
    bundleDigest,
  }, null, 2)}\n`);
  await writeFile(archiveManifest, `${JSON.stringify({
    schemaVersion: "apn.notarized-archive.v1",
    proofClass: "developer_id_notarized_stapled_gatekeeper_archive",
    releaseEligible: true,
    appProofManifest,
    appBundleDigest: bundleDigest,
    version,
    teamId,
    bundleId: "ai.nuanu.apn.keychain-agent",
    accessGroup: `${teamId}.ai.nuanu.apn.keys`,
    architectures: ["arm64"],
    archive,
    archiveSha256: sha256(archiveBytes),
    bytes: archiveBytes.length,
    published: false,
    ...overrides.manifest,
  }, null, 2)}\n`);
  return { archive, archiveManifest };
}

function runRenderer(archiveManifest, output, url) {
  return spawnSync(process.execPath, [
    renderCask,
    "--archive-manifest", archiveManifest,
    "--expected-team-id", teamId,
    "--url", url,
    "--homepage", "https://nuanu.ai/apn",
    "--output", output,
  ], { encoding: "utf8" });
}

test("Cask rendering rejects mutable or non-versioned release URLs before artifact access", async (context) => {
  const root = await mkdtemp(join(tmpdir(), "apn-release-url-gate-"));
  context.after(async () => rm(root, { recursive: true, force: true }));
  const { archiveManifest } = await writeClaim(root);
  const cases = [
    "https://github.com/nuanu-ai/apn/releases/download/latest/APNKeychainAgent.zip#0.1.0",
    "https://github.com/nuanu-ai/apn/releases/download/latest/APNKeychainAgent.zip?version=0.1.0",
    "https://github.com/nuanu-ai/apn/releases/download/v0.1.0/latest.zip",
    "https://github.com/nuanu-ai/apn/releases/download/stable/APNKeychainAgent.zip",
    "https://github.com/nuanu-ai/apn/releases/download/0.1.0/APNKeychainAgent-0.1.0-arm64.zip",
    "https://downloads.example/nuanu-ai/apn/releases/download/v0.1.0/APNKeychainAgent-0.1.0-arm64.zip",
  ];
  for (const [index, url] of cases.entries()) {
    const output = join(root, `mutable-${index}.rb`);
    const result = runRenderer(archiveManifest, output, url);
    assert.notEqual(result.status, 0, `renderer unexpectedly accepted ${url}`);
    assert.equal(existsSync(output), false);
  }
});

test("fresh notarized identity rejects a claimed newer release version", () => {
  const actual = assertNotarizedAppProof({
    schemaVersion: "apn.notarized-app.v1",
    proofClass: "developer_id_notarized_stapled_gatekeeper",
    releaseEligible: true,
    app: "/tmp/actual/APNKeychainAgent.app",
    version: "0.1.0",
    teamId,
    bundleId: "ai.nuanu.apn.keychain-agent",
    accessGroup: `${teamId}.ai.nuanu.apn.keys`,
    architectures: ["arm64"],
    bundleDigest: "a".repeat(64),
  }, { expectedTeamId: teamId });
  const forged = { ...actual, app: "/tmp/claimed/APNKeychainAgent.app", version: "0.2.0" };
  assert.throws(() => assertSameNotarizedApp(actual, forged), /version/);
});

test("a hand-authored release claim cannot render a Cask for unsigned archive bytes", async (context) => {
  const root = await mkdtemp(join(tmpdir(), "apn-forged-release-gate-"));
  context.after(async () => rm(root, { recursive: true, force: true }));
  const fakeApp = join(root, "payload", "APNKeychainAgent.app");
  await mkdir(join(fakeApp, "Contents", "MacOS"), { recursive: true });
  await writeFile(join(fakeApp, "Contents", "MacOS", "APNKeychainAgent"), "unsigned");
  const archive = join(root, "APNKeychainAgent-0.1.0-arm64.zip");
  const archived = spawnSync("ditto", [
    "-c", "-k", "--sequesterRsrc", "--keepParent", fakeApp, archive,
  ], { encoding: "utf8" });
  assert.equal(archived.status, 0, archived.stderr);
  const archiveBytes = await readFile(archive);
  const { archiveManifest } = await writeClaim(root, { archiveBytes });
  const output = join(root, "forged.rb");
  const result = runRenderer(
    archiveManifest,
    output,
    "https://github.com/nuanu-ai/apn/releases/download/v0.1.0/APNKeychainAgent-0.1.0-arm64.zip",
  );
  assert.notEqual(result.status, 0, "unsigned fake app unexpectedly passed notarized verification");
  assert.match(`${result.stdout}\n${result.stderr}`, /verified|verification|invalid|failed|signature|bundle/i);
  assert.equal(existsSync(output), false);
});

test("the independently supplied Team ID must match the archive claim", async (context) => {
  const root = await mkdtemp(join(tmpdir(), "apn-team-gate-"));
  context.after(async () => rm(root, { recursive: true, force: true }));
  const { archiveManifest } = await writeClaim(root, { manifest: { teamId: "ZZZZZZZZZZ" } });
  const output = join(root, "wrong-team.rb");
  const result = runRenderer(
    archiveManifest,
    output,
    "https://github.com/nuanu-ai/apn/releases/download/v0.1.0/APNKeychainAgent-0.1.0-arm64.zip",
  );
  assert.notEqual(result.status, 0);
  assert.equal(existsSync(output), false);
});
