#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { access, mkdir, readFile, rename, stat, writeFile } from "node:fs/promises";
import { constants as fsConstants } from "node:fs";
import { basename, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = dirname(fileURLToPath(import.meta.url));

function args(argv) {
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

async function absent(path) {
  try {
    await access(path, fsConstants.F_OK);
    throw new Error(`refusing to overwrite: ${path}`);
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }
}

const values = args(process.argv.slice(2));
const app = resolve(values.get("app") ?? "");
const buildManifest = resolve(values.get("build-manifest") ?? "");
const output = resolve(values.get("output") ?? "");
const outputManifest = resolve(values.get("output-manifest") ?? "");
if (!["app", "build-manifest", "output", "output-manifest"].every((key) => values.has(key))) {
  throw new Error("all structural archive arguments are required");
}
if (basename(app) !== "APNKeychainAgent.app" || !(await stat(app)).isDirectory()) {
  throw new Error("unexpected app bundle");
}
if (!output.endsWith(".zip")) throw new Error("archive output must end with .zip");
await absent(output);
await absent(outputManifest);
const verified = spawnSync(process.execPath, [
  resolve(scriptDir, "verify-macos-app.mjs"),
  "--app", app,
  "--mode", "structural",
  "--build-manifest", buildManifest,
], { stdio: "inherit" });
if (verified.error || verified.status !== 0) throw new Error("structural verification failed");
const archived = spawnSync("ditto", ["-c", "-k", "--sequesterRsrc", "--keepParent", app, output], {
  stdio: "inherit",
});
if (archived.error || archived.status !== 0) throw new Error("ditto archive creation failed");
const bytes = await readFile(output);
const build = JSON.parse(await readFile(buildManifest, "utf8"));
const manifest = {
  schemaVersion: "apn.structural-archive.v1",
  proofClass: "unsigned_structural_only",
  releaseEligible: false,
  version: build.version,
  archive: output,
  archiveSha256: createHash("sha256").update(bytes).digest("hex"),
  bytes: bytes.length,
  signed: false,
  notarized: false,
  published: false,
};
await mkdir(dirname(outputManifest), { recursive: true, mode: 0o700 });
const temporary = `${outputManifest}.tmp-${process.pid}`;
await writeFile(temporary, `${JSON.stringify(manifest, null, 2)}\n`, { mode: 0o600, flag: "wx" });
await rename(temporary, outputManifest);
process.stdout.write(`${JSON.stringify(manifest)}\n`);
