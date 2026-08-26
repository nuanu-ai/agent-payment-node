#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const sourceRoot = resolve(scriptDir, "..");
const values = new Map();
for (let index = 2; index < process.argv.length; index += 2) {
  const key = process.argv[index];
  const value = process.argv[index + 1];
  if (!key?.startsWith("--") || value === undefined || values.has(key.slice(2))) {
    throw new Error("arguments must be unique --name value pairs");
  }
  values.set(key.slice(2), value);
}
const manifestPath = resolve(values.get("structural-archive-manifest") ?? "");
if (!values.has("structural-archive-manifest")) {
  throw new Error("--structural-archive-manifest is required");
}
const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
if (
  manifest.schemaVersion !== "apn.structural-archive.v1" ||
  manifest.proofClass !== "unsigned_structural_only" ||
  manifest.releaseEligible !== false ||
  typeof manifest.version !== "string" ||
  !/^[0-9a-f]{64}$/.test(manifest.archiveSha256 ?? "")
) throw new Error("structural archive manifest is invalid");

let rendered = await readFile(resolve(sourceRoot, "packaging/Casks/apn.rb.in"), "utf8");
for (const [placeholder, value] of [
  ["__APN_VERSION__", manifest.version],
  ["__APN_SHA256_ARM64__", manifest.archiveSha256],
  ["__APN_RELEASE_URL_ARM64__", `https://invalid.example/apn/v${manifest.version}/APNKeychainAgent.zip`],
  ["__APN_HOMEPAGE__", "https://invalid.example/apn"],
]) rendered = rendered.replaceAll(placeholder, value);
if (/__APN_[A-Z0-9_]+__/.test(rendered)) throw new Error("template contains unresolved placeholders");
if (!rendered.includes(`sha256 "${manifest.archiveSha256}"`) ||
    !rendered.includes('depends_on formula: "node@24"') ||
    !rendered.includes('app "APNKeychainAgent.app"')) {
  throw new Error("Cask template does not bind the structural archive checksum and runtime shape");
}

const temporaryRoot = await mkdtemp(join(tmpdir(), "apn-cask-template-"));
try {
  const temporaryCask = join(temporaryRoot, "apn.rb");
  await writeFile(temporaryCask, rendered, { mode: 0o600 });
  const ruby = spawnSync("ruby", ["-c", temporaryCask], { encoding: "utf8" });
  if (ruby.error || ruby.status !== 0) throw new Error("rendered Cask template is not valid Ruby");
  const brew = spawnSync("/opt/homebrew/bin/brew", [
    "style",
    "--except-cops",
    "Sorbet/StrictSigil,Sorbet/TrueSigil,Style/FrozenStringLiteralComment",
    temporaryCask,
  ], {
    encoding: "utf8",
    env: { ...process.env, HOMEBREW_NO_AUTO_UPDATE: "1" },
  });
  if (brew.error || brew.status !== 0) {
    const detail = String(brew.stderr || brew.stdout || "").trim().slice(-1_000);
    throw new Error(`rendered Cask template fails Homebrew style${detail ? `: ${detail}` : ""}`);
  }
} finally {
  await rm(temporaryRoot, { recursive: true, force: true });
}
process.stdout.write(`${JSON.stringify({
  schemaVersion: "apn.cask-template-verification.v1",
  proofClass: "unsigned_structural_only",
  releaseEligible: false,
  version: manifest.version,
  archiveSha256: manifest.archiveSha256,
  syntax: "ruby_and_homebrew_rubocop_file_valid",
})}\n`);
