#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  access,
  chmod,
  copyFile,
  cp,
  mkdir,
  readFile,
  readdir,
  stat,
  writeFile,
} from "node:fs/promises";
import { constants as fsConstants } from "node:fs";
import { basename, dirname, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const sourceRoot = resolve(scriptDir, "..");
const bundleName = "APNKeychainAgent.app";

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

function required(values, key) {
  const value = values.get(key);
  if (!value) throw new Error(`missing --${key}`);
  return value;
}

async function mustNotExist(path) {
  try {
    await access(path, fsConstants.F_OK);
    throw new Error(`refusing to overwrite existing path: ${path}`);
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: options.cwd,
    encoding: "utf8",
    env: options.env ?? process.env,
    stdio: options.capture ? ["ignore", "pipe", "pipe"] : "inherit",
  });
  if (result.error || result.status !== 0) {
    const detail = options.capture ? String(result.stderr || "").trim().slice(-500) : "";
    throw new Error(`${command} failed${detail ? `: ${detail}` : ""}`);
  }
  return result;
}

function render(template, replacements) {
  let output = template;
  for (const [key, value] of replacements) output = output.replaceAll(`\${${key}}`, value);
  if (/\$\{[A-Z0-9_]+\}/.test(output)) throw new Error("unresolved app template placeholder");
  return output;
}

async function regularExecutable(path) {
  const metadata = await stat(path);
  if (!metadata.isFile()) throw new Error(`native binary is not a regular file: ${path}`);
  if ((metadata.mode & 0o111) === 0) throw new Error(`native binary is not executable: ${path}`);
}

async function collectFiles(root, current = root) {
  const rows = [];
  for (const entry of await readdir(current, { withFileTypes: true })) {
    const path = resolve(current, entry.name);
    if (entry.isSymbolicLink()) throw new Error(`bundle source contains a symlink: ${path}`);
    if (entry.isDirectory()) rows.push(...await collectFiles(root, path));
    else if (entry.isFile()) rows.push(path);
    else throw new Error(`bundle source contains a non-regular object: ${path}`);
  }
  return rows;
}

async function hashFile(path) {
  return createHash("sha256").update(await readFile(path)).digest("hex");
}

const values = parseArgs(process.argv.slice(2));
const version = required(values, "version");
const buildNumber = values.get("build-number") ?? "1";
const nativeBuildManifestPath = resolve(required(values, "native-build-manifest"));
const outputRoot = resolve(required(values, "output-root"));
const teamId = values.get("team-id") ?? "UNSIGNED";
const appIdentifierPrefix = values.get("app-identifier-prefix") ??
  (teamId === "UNSIGNED" ? "UNSIGNED." : `${teamId}.`);
const profile = values.get("profile") ? resolve(values.get("profile")) : null;

if (!/^[0-9A-Za-z][0-9A-Za-z._-]{0,63}$/.test(version)) throw new Error("invalid version");
if (!/^[1-9][0-9]{0,17}$/.test(buildNumber)) throw new Error("invalid build number");
if (teamId !== "UNSIGNED" && !/^[A-Z0-9]{10}$/.test(teamId)) throw new Error("invalid Team ID");
if (!/^(?:UNSIGNED\.|[A-Z0-9]{10}\.)$/.test(appIdentifierPrefix)) {
  throw new Error("invalid application identifier prefix");
}
if (basename(outputRoot) === bundleName) throw new Error("--output-root names the parent directory, not the app");

const nativeBuildManifest = JSON.parse(await readFile(nativeBuildManifestPath, "utf8"));
if (
  nativeBuildManifest.schemaVersion !== "apn.native-build.v1" ||
  nativeBuildManifest.version !== version ||
  nativeBuildManifest.target !== "aarch64-apple-darwin" ||
  nativeBuildManifest.profile !== "release" ||
  nativeBuildManifest.acceptanceTest !== false ||
  !Array.isArray(nativeBuildManifest.features) ||
  nativeBuildManifest.features.length !== 0 ||
  typeof nativeBuildManifest.binary !== "string" ||
  !/^[0-9a-f]{64}$/.test(nativeBuildManifest.binarySha256)
) throw new Error("native release-build manifest is invalid");
const nativeBinary = resolve(nativeBuildManifest.binary);
await regularExecutable(nativeBinary);
if (await hashFile(nativeBinary) !== nativeBuildManifest.binarySha256) {
  throw new Error("native release binary hash differs from its controlled build manifest");
}
await access(resolve(sourceRoot, "dist/bin.js"), fsConstants.R_OK);
await mustNotExist(outputRoot);

const appRoot = resolve(outputRoot, bundleName);
const contents = resolve(appRoot, "Contents");
const macos = resolve(contents, "MacOS");
const resources = resolve(contents, "Resources");
const core = resolve(resources, "core");
await mkdir(macos, { recursive: true, mode: 0o755 });
await mkdir(core, { recursive: true, mode: 0o755 });

const replacements = new Map([
  ["APN_VERSION", version],
  ["APN_BUILD_NUMBER", buildNumber],
  ["DEVELOPMENT_TEAM", teamId],
  ["APP_IDENTIFIER_PREFIX", appIdentifierPrefix],
]);
const info = render(await readFile(resolve(sourceRoot, "app/Info.plist"), "utf8"), replacements);
const entitlements = render(
  await readFile(resolve(sourceRoot, "app/APNKeychainAgent.entitlements"), "utf8"),
  replacements,
);
await writeFile(resolve(contents, "Info.plist"), info, { mode: 0o644 });
await writeFile(resolve(outputRoot, "APNKeychainAgent.entitlements"), entitlements, { mode: 0o600 });

await copyFile(nativeBinary, resolve(macos, "APNKeychainAgent"));
await chmod(resolve(macos, "APNKeychainAgent"), 0o755);
await cp(resolve(sourceRoot, "dist"), resolve(core, "dist"), {
  recursive: true,
  dereference: false,
  errorOnExist: true,
});
await copyFile(resolve(sourceRoot, "package.json"), resolve(core, "package.json"));
await copyFile(resolve(sourceRoot, "package-lock.json"), resolve(core, "package-lock.json"));
await copyFile(resolve(sourceRoot, "LICENSE"), resolve(resources, "LICENSE"));

const npmEnvironment = { ...process.env, npm_config_audit: "false", npm_config_fund: "false" };
run("npm", ["ci", "--omit=dev", "--omit=optional", "--ignore-scripts", "--no-audit", "--no-fund"], {
  cwd: core,
  env: npmEnvironment,
});

if (profile !== null) {
  await access(profile, fsConstants.R_OK);
  await copyFile(profile, resolve(contents, "embedded.provisionprofile"));
  await chmod(resolve(contents, "embedded.provisionprofile"), 0o644);
}

run("plutil", ["-lint", resolve(contents, "Info.plist")], { capture: true });
const arch = run("lipo", ["-archs", resolve(macos, "APNKeychainAgent")], { capture: true })
  .stdout.trim().split(/\s+/);
if (!arch.includes("arm64")) throw new Error("native executable does not contain arm64");

const manifestPath = resolve(outputRoot, "APNKeychainAgent.build-manifest.json");
const files = (await collectFiles(appRoot)).sort();
const manifestFiles = [];
for (const path of files) {
  manifestFiles.push({
    path: relative(appRoot, path).split(sep).join("/"),
    sha256: await hashFile(path),
  });
}
await writeFile(manifestPath, `${JSON.stringify({
  schemaVersion: "apn.bundle.v1",
  version,
  buildNumber,
  bundleId: "ai.nuanu.apn.keychain-agent",
  keychainAccessGroupSuffix: "ai.nuanu.apn.keys",
  identityProof: teamId === "UNSIGNED" ? "structural_unsigned" : "unverified_release_inputs",
  profileEmbedded: profile !== null,
  files: manifestFiles,
}, null, 2)}\n`, { mode: 0o644 });

process.stdout.write(`${JSON.stringify({
  schemaVersion: "apn.release.v1",
  artifact: "macos_app",
  app: appRoot,
  entitlements: resolve(outputRoot, "APNKeychainAgent.entitlements"),
  buildManifest: manifestPath,
  version,
  signed: false,
  notarized: false,
  profileEmbedded: profile !== null,
})}\n`);
