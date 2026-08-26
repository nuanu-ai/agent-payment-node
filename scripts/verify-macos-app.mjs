#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { access, lstat, mkdir, readFile, readdir, rename, stat, writeFile } from "node:fs/promises";
import { constants as fsConstants } from "node:fs";
import { dirname, relative, resolve, sep } from "node:path";

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

function run(command, args, { input, allowFailure = false } = {}) {
  const result = spawnSync(command, args, {
    input,
    encoding: input === undefined ? "utf8" : undefined,
    maxBuffer: 4 * 1024 * 1024,
    stdio: [input === undefined ? "ignore" : "pipe", "pipe", "pipe"],
  });
  if (!allowFailure && (result.error || result.status !== 0)) {
    throw new Error(`${command} verification failed`);
  }
  return result;
}

function text(result, stream = "stdout") {
  const value = result[stream];
  return Buffer.isBuffer(value) ? value.toString("utf8") : String(value ?? "");
}

function plistExtract(plist, key, { optional = false } = {}) {
  const result = run("plutil", ["-extract", key, "raw", "-o", "-", "-"], {
    input: Buffer.isBuffer(plist) ? plist : Buffer.from(plist),
    allowFailure: optional,
  });
  if (result.status !== 0) return null;
  return text(result).trim();
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

async function writeManifest(path, value) {
  try {
    await access(path, fsConstants.F_OK);
    throw new Error("refusing to overwrite verification manifest");
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  const temporary = `${path}.tmp-${process.pid}`;
  await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600, flag: "wx" });
  await rename(temporary, path);
}

const values = parseArgs(process.argv.slice(2));
const app = resolve(values.get("app") ?? "");
const mode = values.get("mode") ?? "structural";
const expectedTeamId = values.get("expected-team-id") ?? null;
const buildManifestPath = values.get("build-manifest") ? resolve(values.get("build-manifest")) : null;
const outputManifestPath = values.get("output-manifest") ? resolve(values.get("output-manifest")) : null;
if (!values.get("app")) throw new Error("--app is required");
if (!new Set(["structural", "signed", "notarized"]).has(mode)) throw new Error("invalid verification mode");
if (mode !== "structural" && !/^[A-Z0-9]{10}$/.test(expectedTeamId ?? "")) {
  throw new Error("signed verification requires --expected-team-id");
}
if (outputManifestPath !== null && mode !== "notarized") {
  throw new Error("--output-manifest is available only for notarized verification");
}

const contents = resolve(app, "Contents");
const infoPath = resolve(contents, "Info.plist");
const executable = resolve(contents, "MacOS/APNKeychainAgent");
const child = resolve(contents, "Resources/core/dist/bin.js");
await access(infoPath, fsConstants.R_OK);
await access(executable, fsConstants.X_OK);
await access(child, fsConstants.R_OK);
if (!(await stat(app)).isDirectory() || !(await stat(executable)).isFile()) {
  throw new Error("invalid app layout");
}

const info = await readFile(infoPath);
if (plistExtract(info, "CFBundleIdentifier") !== "ai.nuanu.apn.keychain-agent") {
  throw new Error("bundle identifier mismatch");
}
if (plistExtract(info, "CFBundleExecutable") !== "APNKeychainAgent") {
  throw new Error("bundle executable mismatch");
}
const version = plistExtract(info, "CFBundleShortVersionString");
const accessGroup = plistExtract(info, "APNKeychainAccessGroup");
if (!version || !accessGroup?.endsWith(".ai.nuanu.apn.keys")) {
  throw new Error("bundle version or access-group metadata is invalid");
}
const architectures = text(run("lipo", ["-archs", executable])).trim().split(/\s+/);
if (architectures.length !== 1 || architectures[0] !== "arm64") {
  throw new Error("native executable must contain only arm64");
}
const executableStrings = text(run("strings", [executable]));
if (executableStrings.includes("APN_KEYCHAIN_TEST_OK") || executableStrings.includes("keychain-test")) {
  throw new Error("acceptance-test command is present in the release executable");
}

if (buildManifestPath !== null) {
  const manifest = JSON.parse(await readFile(buildManifestPath, "utf8"));
  if (manifest.schemaVersion !== "apn.bundle.v1" || manifest.version !== version || !Array.isArray(manifest.files)) {
    throw new Error("build manifest identity mismatch");
  }
  for (const row of manifest.files) {
    if (typeof row.path !== "string" || !/^[0-9a-f]{64}$/.test(row.sha256)) {
      throw new Error("build manifest row is invalid");
    }
    const path = resolve(app, row.path);
    if (!path.startsWith(`${app}/`)) throw new Error("build manifest path escapes app");
    if (await sha256(path) !== row.sha256) throw new Error(`build manifest hash mismatch: ${row.path}`);
  }
}

let signature = "not_checked";
let profile = "not_checked";
let notarization = "not_checked";
if (mode !== "structural") {
  const profilePath = resolve(contents, "embedded.provisionprofile");
  await access(profilePath, fsConstants.R_OK);
  const profilePayload = run("security", ["cms", "-D", "-i", profilePath]).stdout;
  const profileTeam = plistExtract(profilePayload, "TeamIdentifier.0");
  const profileAppId = plistExtract(profilePayload, "Entitlements.com.apple.application-identifier");
  const profileAccessGroup = plistExtract(profilePayload, "Entitlements.keychain-access-groups.0");
  const profileExpires = plistExtract(profilePayload, "ExpirationDate");
  const profileGetTaskAllow = plistExtract(profilePayload, "Entitlements.com.apple.security.get-task-allow", {
    optional: true,
  });
  if (profileTeam !== expectedTeamId || profileAppId !== `${expectedTeamId}.ai.nuanu.apn.keychain-agent` ||
      profileAccessGroup !== `${expectedTeamId}.ai.nuanu.apn.keys` || !profileExpires ||
      profileGetTaskAllow === "true") {
    throw new Error("provisioning profile does not authorize the exact release identity");
  }
  if (Date.parse(profileExpires) <= Date.now()) throw new Error("provisioning profile is expired");

  run("codesign", ["--verify", "--deep", "--strict", "--verbose=2", app]);
  const detailsResult = run("codesign", ["-d", "--verbose=4", app]);
  const details = `${text(detailsResult)}\n${text(detailsResult, "stderr")}`;
  if (!details.includes("Identifier=ai.nuanu.apn.keychain-agent") ||
      !details.includes(`TeamIdentifier=${expectedTeamId}`) ||
      !/flags=0x[0-9a-f]+\(runtime\)/i.test(details) ||
      !/^Timestamp=/m.test(details) ||
      !/^Authority=Developer ID Application:/m.test(details)) {
    throw new Error("Developer ID signature identity/runtime/timestamp mismatch");
  }
  const entitlementResult = run("codesign", ["-d", "--entitlements", ":-", app]);
  const entitlements = text(entitlementResult) || text(entitlementResult, "stderr");
  if (plistExtract(entitlements, "com.apple.application-identifier") !==
        `${expectedTeamId}.ai.nuanu.apn.keychain-agent` ||
      plistExtract(entitlements, "com.apple.developer.team-identifier") !== expectedTeamId ||
      plistExtract(entitlements, "keychain-access-groups.0") !== `${expectedTeamId}.ai.nuanu.apn.keys` ||
      plistExtract(entitlements, "com.apple.security.get-task-allow", { optional: true }) === "true") {
    throw new Error("signed entitlements mismatch");
  }
  if (accessGroup !== `${expectedTeamId}.ai.nuanu.apn.keys`) {
    throw new Error("Info.plist access-group metadata mismatch");
  }
  signature = "developer_id_verified";
  profile = "exact_identity_verified";

  if (mode === "notarized") {
    run("xcrun", ["stapler", "validate", app]);
    run("spctl", ["--assess", "--type", "execute", "--verbose=2", app]);
    notarization = "stapled_gatekeeper_verified";
  }
}

const verification = {
  schemaVersion: "apn.release.verification.v1",
  app,
  mode,
  version,
  bundleId: "ai.nuanu.apn.keychain-agent",
  accessGroup,
  architectures,
  signature,
  profile,
  notarization,
  publicCaskInstalled: false,
  liveMoneyProven: false,
};
if (outputManifestPath !== null) {
  await writeManifest(outputManifestPath, {
    schemaVersion: "apn.notarized-app.v1",
    proofClass: "developer_id_notarized_stapled_gatekeeper",
    releaseEligible: true,
    app,
    version,
    teamId: expectedTeamId,
    bundleId: "ai.nuanu.apn.keychain-agent",
    accessGroup,
    architectures,
    bundleDigest: await bundleDigest(app),
  });
}
process.stdout.write(`${JSON.stringify({
  ...verification,
  ...(outputManifestPath === null ? {} : { outputManifest: outputManifestPath }),
})}\n`);
