#!/usr/bin/env node

import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, rename, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { assertNotarizedAppProof, assertSameNotarizedApp } from "./release-proof.mjs";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const sourceRoot = resolve(scriptDir, "..");

function parseArgs(argv) {
  const values = new Map();
  for (let index = 0; index < argv.length; index += 2) {
    const key = argv[index];
    const value = argv[index + 1];
    if (!key?.startsWith("--") || value === undefined) {
      throw new Error("arguments must be --name value pairs");
    }
    values.set(key.slice(2), value);
  }
  return values;
}

function requireValue(values, key) {
  const value = values.get(key);
  if (!value) throw new Error(`missing --${key}`);
  return value;
}

function httpsUrl(value, label) {
  const parsed = new URL(value);
  if (parsed.protocol !== "https:" || parsed.username || parsed.password || parsed.hash || parsed.search) {
    throw new Error(`${label} must be a credential-free HTTPS URL`);
  }
  return parsed;
}

function immutableReleaseUrl(value, version) {
  const parsed = httpsUrl(value, "release URL");
  if (parsed.hostname !== "github.com" || parsed.port) {
    throw new Error("release URL must use the approved github.com/nuanu-ai release origin");
  }
  let pathname;
  try {
    pathname = decodeURIComponent(parsed.pathname);
  } catch {
    throw new Error("release URL pathname must use valid percent-encoding");
  }
  const segments = pathname.split("/").filter(Boolean);
  const filename = basename(pathname);
  const expectedFilename = `APNKeychainAgent-${version}-arm64.zip`;
  if (
    segments.length !== 6 ||
    segments[0] !== "nuanu-ai" ||
    !/^[0-9A-Za-z._-]+$/.test(segments[1]) ||
    segments[2] !== "releases" ||
    segments[3] !== "download" ||
    segments[4] !== `v${version}` ||
    filename !== expectedFilename
  ) {
    throw new Error("release URL must name the exact immutable Nuanu GitHub release asset");
  }
  return parsed.toString();
}

const values = parseArgs(process.argv.slice(2));
const archiveManifestPath = resolve(requireValue(values, "archive-manifest"));
const expectedTeamId = requireValue(values, "expected-team-id");
if (!/^[A-Z0-9]{10}$/.test(expectedTeamId)) throw new Error("exact expected Team ID is required");
const archiveManifest = JSON.parse(await readFile(archiveManifestPath, "utf8"));
if (
  archiveManifest.schemaVersion !== "apn.notarized-archive.v1" ||
  archiveManifest.proofClass !== "developer_id_notarized_stapled_gatekeeper_archive" ||
  archiveManifest.releaseEligible !== true ||
  archiveManifest.bundleId !== "ai.nuanu.apn.keychain-agent" ||
  typeof archiveManifest.version !== "string" ||
  typeof archiveManifest.archive !== "string" ||
  typeof archiveManifest.appProofManifest !== "string" ||
  archiveManifest.teamId !== expectedTeamId ||
  archiveManifest.accessGroup !== `${expectedTeamId}.ai.nuanu.apn.keys` ||
  !Array.isArray(archiveManifest.architectures) ||
  archiveManifest.architectures.length !== 1 ||
  archiveManifest.architectures[0] !== "arm64" ||
  !/^[0-9a-f]{64}$/.test(archiveManifest.appBundleDigest ?? "") ||
  !/^[0-9a-f]{64}$/.test(archiveManifest.archiveSha256 ?? "")
) throw new Error("notarized archive manifest is invalid or not release-eligible");
const version = archiveManifest.version;
const sha256 = archiveManifest.archiveSha256;
const releaseUrl = immutableReleaseUrl(requireValue(values, "url"), version);
const homepage = httpsUrl(requireValue(values, "homepage"), "homepage").toString();
const archiveBytes = await readFile(resolve(archiveManifest.archive));
if (createHash("sha256").update(archiveBytes).digest("hex") !== sha256) {
  throw new Error("archive bytes differ from notarized archive manifest");
}
const output = resolve(requireValue(values, "output"));

const appProof = assertNotarizedAppProof(
  JSON.parse(await readFile(resolve(archiveManifest.appProofManifest), "utf8")),
  { expectedTeamId },
);
if (
  appProof.version !== version ||
  appProof.teamId !== archiveManifest.teamId ||
  appProof.bundleId !== archiveManifest.bundleId ||
  appProof.accessGroup !== archiveManifest.accessGroup ||
  JSON.stringify(appProof.architectures) !== JSON.stringify(archiveManifest.architectures) ||
  appProof.bundleDigest !== archiveManifest.appBundleDigest
) throw new Error("notarized archive manifest is not linked to its exact app proof");

const extractionRoot = await mkdtemp(join(tmpdir(), "apn-cask-archive-verify-"));
try {
  const extracted = spawnSync("ditto", ["-x", "-k", resolve(archiveManifest.archive), extractionRoot], {
    stdio: "inherit",
  });
  if (extracted.error || extracted.status !== 0) throw new Error("release archive extraction failed");
  const extractedApp = resolve(extractionRoot, "APNKeychainAgent.app");
  const freshProofPath = join(extractionRoot, "fresh-notarized-app.json");
  const verified = spawnSync(process.execPath, [
    resolve(scriptDir, "verify-macos-app.mjs"),
    "--app", extractedApp,
    "--mode", "notarized",
    "--expected-team-id", expectedTeamId,
    "--output-manifest", freshProofPath,
  ], { stdio: "inherit" });
  if (verified.error || verified.status !== 0) {
    throw new Error("release archive does not contain the freshly verified notarized app");
  }
  const freshProof = assertNotarizedAppProof(JSON.parse(await readFile(freshProofPath, "utf8")), {
    expectedTeamId,
    expectedApp: extractedApp,
  });
  assertSameNotarizedApp(freshProof, appProof);
} finally {
  await rm(extractionRoot, { recursive: true, force: true });
}

if (!/^[0-9A-Za-z][0-9A-Za-z._-]{0,63}$/.test(version)) {
  throw new Error("version is not Cask-safe");
}
if (!/^[0-9a-f]{64}$/.test(sha256)) {
  throw new Error("sha256 must contain exactly 64 lowercase hex characters");
}
if (!output.endsWith(".rb")) throw new Error("output must be a .rb file");

const templatePath = resolve(sourceRoot, "packaging/Casks/apn.rb.in");
let rendered = await readFile(templatePath, "utf8");
const replacements = new Map([
  ["__APN_VERSION__", version],
  ["__APN_SHA256_ARM64__", sha256],
  ["__APN_RELEASE_URL_ARM64__", releaseUrl],
  ["__APN_HOMEPAGE__", homepage],
]);
for (const [placeholder, value] of replacements) {
  rendered = rendered.replaceAll(placeholder, value);
}
if (/__APN_[A-Z0-9_]+__/.test(rendered)) {
  throw new Error("rendered Cask still contains an APN placeholder");
}

await mkdir(dirname(output), { recursive: true, mode: 0o755 });
const temporary = `${output}.tmp-${process.pid}.rb`;
await writeFile(temporary, rendered, { encoding: "utf8", mode: 0o644 });
const ruby = spawnSync("ruby", ["-c", temporary], { encoding: "utf8" });
if (ruby.error || ruby.status !== 0) throw new Error("rendered Cask is not valid Ruby");
const brew = spawnSync("/opt/homebrew/bin/brew", [
  "style",
  "--except-cops",
  "Sorbet/StrictSigil,Sorbet/TrueSigil,Style/FrozenStringLiteralComment",
  temporary,
], {
  encoding: "utf8",
  env: { ...process.env, HOMEBREW_NO_AUTO_UPDATE: "1" },
});
if (brew.error || brew.status !== 0) throw new Error("rendered Cask fails Homebrew style");
await rename(temporary, output);

process.stdout.write(`${JSON.stringify({
  schemaVersion: "apn.release.v1",
  artifact: "homebrew_cask",
  archiveManifest: archiveManifestPath,
  version,
  sha256,
  output,
  published: false,
})}\n`);
