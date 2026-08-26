#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { access, mkdir, readFile, rename, stat, writeFile } from "node:fs/promises";
import { constants as fsConstants } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const sourceRoot = resolve(scriptDir, "..");

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

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: options.cwd,
    encoding: "utf8",
    maxBuffer: 8 * 1024 * 1024,
    stdio: options.capture ? ["ignore", "pipe", "pipe"] : "inherit",
  });
  if (result.error || result.status !== 0) throw new Error(`${command} failed`);
  return result;
}

async function sha256(path) {
  return createHash("sha256").update(await readFile(path)).digest("hex");
}

async function mustNotExist(path) {
  try {
    await access(path, fsConstants.F_OK);
    throw new Error(`refusing to overwrite: ${path}`);
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }
}

const values = parseArgs(process.argv.slice(2));
const outputManifest = resolve(values.get("output-manifest") ?? "");
const targetDir = resolve(values.get("target-dir") ?? resolve(sourceRoot, "target/native-release"));
if (!values.get("output-manifest")) throw new Error("--output-manifest is required");
await mustNotExist(outputManifest);

for (const key of ["RUSTFLAGS", "CARGO_ENCODED_RUSTFLAGS"]) {
  if (process.env[key]) throw new Error(`${key} is forbidden for the controlled release build`);
}

await mkdir(targetDir, { recursive: true, mode: 0o700 });
run("cargo", [
  "build",
  "--locked",
  "--release",
  "--no-default-features",
  "--bin",
  "APNKeychainAgent",
  "--target",
  "aarch64-apple-darwin",
  "--target-dir",
  targetDir,
], { cwd: sourceRoot });

const binary = resolve(targetDir, "aarch64-apple-darwin/release/APNKeychainAgent");
await access(binary, fsConstants.X_OK);
if (!(await stat(binary)).isFile()) throw new Error("release binary is not regular");
const architectures = run("lipo", ["-archs", binary], { capture: true }).stdout.trim().split(/\s+/);
if (architectures.length !== 1 || architectures[0] !== "arm64") {
  throw new Error("release binary must contain only arm64");
}
const strings = run("strings", [binary], { capture: true }).stdout;
if (strings.includes("APN_KEYCHAIN_TEST_OK") || strings.includes("keychain-test")) {
  throw new Error("acceptance-test command is present in the release binary");
}

const packageJson = JSON.parse(await readFile(resolve(sourceRoot, "package.json"), "utf8"));
const manifest = {
  schemaVersion: "apn.native-build.v1",
  version: packageJson.version,
  target: "aarch64-apple-darwin",
  profile: "release",
  features: [],
  acceptanceTest: false,
  binary,
  binarySha256: await sha256(binary),
  cargoTomlSha256: await sha256(resolve(sourceRoot, "Cargo.toml")),
  cargoLockSha256: await sha256(resolve(sourceRoot, "Cargo.lock")),
};
await mkdir(dirname(outputManifest), { recursive: true, mode: 0o700 });
const temporary = `${outputManifest}.tmp-${process.pid}`;
await writeFile(temporary, `${JSON.stringify(manifest, null, 2)}\n`, { mode: 0o600, flag: "wx" });
await rename(temporary, outputManifest);
process.stdout.write(`${JSON.stringify(manifest)}\n`);
