import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { access, mkdtemp, writeFile } from "node:fs/promises";
import { isAbsolute, join, normalize, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { promisify } from "node:util";

const run = promisify(execFile);
const REQUIRED_DIST = [
  "dist/encrypted-wallet-store.js",
  "dist/macos-keychain.js",
  "dist/secure-state-store.js",
  "dist/state.js",
];

export async function runInstalledStorageProof({ packageRoot, workRoot }) {
  canonicalAbsolute(packageRoot, "packageRoot");
  canonicalAbsolute(workRoot, "workRoot");
  await Promise.all(REQUIRED_DIST.map(relative => access(join(packageRoot, relative))));

  const fixtureRoot = await mkdtemp(join(workRoot, "mm61-installed-storage-proof-"));
  const syntheticHome = join(fixtureRoot, "home");
  const preloadPath = join(fixtureRoot, "preload.mjs");
  const runnerPath = join(fixtureRoot, "runner.mjs");
  await writeFile(preloadPath, PRELOAD, { encoding: "utf8", mode: 0o600, flag: "wx" });
  await writeFile(runnerPath, RUNNER, { encoding: "utf8", mode: 0o600, flag: "wx" });

  const { stdout, stderr } = await run(process.execPath, [
    "--import", pathToFileURL(preloadPath).href, runnerPath, packageRoot, fixtureRoot,
  ], {
    cwd: packageRoot,
    encoding: "utf8",
    maxBuffer: 64 * 1024,
    timeout: 30_000,
    env: {
      PATH: "/usr/bin:/bin",
      LANG: "C",
      HOME: syntheticHome,
      USER: "apn-storage-fixture",
      LOGNAME: "apn-storage-fixture",
      APN_MM_STORAGE_TEST_HOME: syntheticHome,
      APN_WRAPPING_SECRET: "environment-fallback-canary",
      APN_WALLET_PRIVATE_KEY: "environment-private-key-canary",
    },
  });
  assert.equal(stderr, "");
  const evidence = JSON.parse(stdout);
  assert.deepEqual(Object.keys(evidence), ["proof_class", "package", "crypto", "filesystem", "keychain", "behavior", "boundaries"]);
  assert.equal(evidence.proof_class, "installed_archive_synthetic_os_boundary_storage");
  assert.equal(evidence.boundaries.real_keychain_access, false);
  assert.equal(evidence.boundaries.network_access, false);
  return evidence;
}

function canonicalAbsolute(value, label) {
  assert.equal(typeof value, "string", label + " must be a string");
  assert.equal(isAbsolute(value) && normalize(value) === value && resolve(value) === value, true,
    label + " must be a canonical absolute path");
}

const PRELOAD = String.raw`
import childProcess from "node:child_process";
import { randomBytes } from "node:crypto";
import { EventEmitter } from "node:events";
import os from "node:os";
import { PassThrough } from "node:stream";
import { syncBuiltinESMExports } from "node:module";

const originalSpawn = childProcess.spawn;
const home = process.env.APN_MM_STORAGE_TEST_HOME;
if (typeof home !== "string" || !home.startsWith("/")) throw new Error("synthetic home is missing");

let secret = null;
const control = {
  mode: "normal",
  hostPlatform: "darwin",
  calls: [],
  copySecret() { return secret === null ? null : Buffer.from(secret); },
  setSecret(value) {
    if (secret !== null) secret.fill(0);
    secret = value === null ? null : Buffer.from(value);
  },
  zeroize() {
    if (secret !== null) secret.fill(0);
    secret = null;
  },
};
globalThis.__APN_MM_STORAGE_CONTROL__ = control;

os.platform = () => control.hostPlatform;
os.userInfo = () => ({ uid: process.geteuid(), gid: process.getegid(), username: "apn-storage-fixture",
  homedir: home, shell: "/bin/zsh" });
childProcess.spawn = function(executable, args = [], options = {}) {
  if (executable !== "/usr/bin/security") return originalSpawn.call(childProcess, executable, args, options);
  const shape = [...args];
  const passwordIndex = args[0] === "add-generic-password" ? args.indexOf("-w") + 1 : -1;
  let passwordBytes = null;
  if (passwordIndex > 0) {
    const encoded = args[passwordIndex] ?? "";
    const decoded = Buffer.from(encoded, "base64");
    passwordBytes = decoded.toString("base64") === encoded ? decoded.length : -1;
    shape[passwordIndex] = "<redacted>";
    if (passwordBytes === 32 && control.mode === "normal") control.setSecret(decoded);
    decoded.fill(0);
  }
  control.calls.push({ executable, shape, passwordBytes, env: { ...options.env } });

  const child = new EventEmitter();
  child.stdin = new PassThrough();
  child.stdout = new PassThrough();
  child.stderr = new PassThrough();
  child.kill = () => true;
  process.nextTick(() => {
    let code = 0;
    let output = Buffer.alloc(0);
    if (args[0] === "find-generic-password") {
      if (control.mode === "locked") code = 36;
      else if (control.mode === "denied") code = 128;
      else if (control.mode === "malformed") output = Buffer.from("not-canonical-base64\n", "utf8");
      else if (control.mode === "absent" || secret === null) code = 44;
      else output = Buffer.from(secret.toString("base64") + "\n", "utf8");
    } else if (args[0] !== "add-generic-password" || passwordBytes !== 32 || control.mode !== "normal") {
      code = 1;
    }
    if (output.length > 0) child.stdout.write(output);
    output.fill(0);
    child.stdout.end();
    child.stderr.end();
    child.emit("close", code, null);
  });
  return child;
};
syncBuiltinESMExports();
`;

const RUNNER = String.raw`
import assert from "node:assert/strict";
import { createDecipheriv, createHash, hkdfSync, randomBytes } from "node:crypto";
import { chmod, lstat, mkdir, readFile, rename, stat, symlink, unlink, writeFile } from "node:fs/promises";
import { platform, userInfo } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const packageRoot = resolve(process.argv[2]);
const fixtureRoot = resolve(process.argv[3]);
const control = globalThis.__APN_MM_STORAGE_CONTROL__;
assert.ok(control);
const load = async relative => await import(pathToFileURL(join(packageRoot, relative)).href);
const { canonicalJson } = await load("dist/canonical.js");
const { EncryptedWalletStore } = await load("dist/encrypted-wallet-store.js");
const { MacOSLoginKeychainSecret } = await load("dist/macos-keychain.js");
const { StateStore } = await load("dist/state.js");
const { validateDirectory } = await load("dist/secure-state-store.js");
const packageJson = JSON.parse(await readFile(join(packageRoot, "package.json"), "utf8"));

assert.deepEqual(packageJson.os, ["darwin"]);
assert.deepEqual(packageJson.cpu, ["arm64"]);
control.hostPlatform = "linux";
assert.equal(platform(), "linux");
assert.equal(packageJson.os.includes(platform()), false);
assert.equal(packageJson.cpu.includes("x64"), false);
control.hostPlatform = "darwin";
assert.equal(platform(), "darwin");

const home = userInfo().homedir;
assert.equal(home, process.env.APN_MM_STORAGE_TEST_HOME);
await mkdir(home, { recursive: true, mode: 0o700 });
const stateRoot = join(home, ".apn");
const state = new StateStore(stateRoot);
await state.initialize();
let lockAction = false;
await state.withLocks(["mm61-installed-storage"], async () => { lockAction = true; });
assert.equal(lockAction, true);

const keychain = new MacOSLoginKeychainSecret();
const wallets = new EncryptedWalletStore(state, keychain);
const first = await wallets.ensure("default");
const firstAddress = first.identity.address;
const firstBinding = first.identity.bindingHash;
const firstCreatedAt = first.identity.createdAt;
const envelopePath = join(stateRoot, "wallets", "default.json");
const originalBytes = await readFile(envelopePath);
const originalText = originalBytes.toString("utf8");
const envelope = JSON.parse(originalText);
assert.equal(envelope.schemaVersion, "apn.wallet-envelope.v1");
assert.deepEqual(Object.keys(envelope), ["cipher", "identity", "kdf", "schemaVersion"]);
assert.equal(envelope.kdf.name, "HKDF-SHA-256");
assert.equal(envelope.cipher.name, "AES-256-GCM");
assert.equal(Buffer.from(envelope.kdf.salt, "base64").length, 32);
assert.equal(Buffer.from(envelope.cipher.nonce, "base64").length, 12);
assert.equal(Buffer.from(envelope.cipher.tag, "base64").length, 16);
assert.ok(Buffer.from(envelope.cipher.ciphertext, "base64").length > 32);
for (const forbidden of ["privateKey", "environment-fallback-canary", "environment-private-key-canary"]) {
  assert.equal(originalText.includes(forbidden), false);
}

const rootStats = await lstat(stateRoot);
const walletStats = await lstat(envelopePath);
assert.equal(rootStats.mode & 0o777, 0o700);
assert.equal(walletStats.mode & 0o777, 0o600);
assert.equal(rootStats.uid, process.geteuid());
assert.equal(walletStats.uid, process.geteuid());
assert.equal(walletStats.nlink, 1);

const wrapping = control.copySecret();
assert.equal(wrapping.length, 32);
assert.equal(originalText.includes(wrapping.toString("base64")), false);
assert.equal(originalText.includes(first.secret.privateKey), false);
const salt = Buffer.from(envelope.kdf.salt, "base64");
const nonce = Buffer.from(envelope.cipher.nonce, "base64");
const tag = Buffer.from(envelope.cipher.tag, "base64");
const ciphertext = Buffer.from(envelope.cipher.ciphertext, "base64");
const key = Buffer.from(hkdfSync("sha256", wrapping, salt,
  Buffer.from("apn.wallet-envelope.v1\0default", "utf8"), 32));
const header = { schemaVersion: envelope.schemaVersion, identity: envelope.identity,
  kdf: envelope.kdf, cipher: { name: envelope.cipher.name, nonce: envelope.cipher.nonce } };
const decipher = createDecipheriv("aes-256-gcm", key, nonce, { authTagLength: 16 });
decipher.setAAD(Buffer.from(canonicalJson(header), "utf8"));
decipher.setAuthTag(tag);
const plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
const independentlyDecrypted = JSON.parse(plaintext.toString("utf8"));
assert.equal(independentlyDecrypted.version, "apn.wallet-secret.v1");
assert.equal(independentlyDecrypted.privateKey, first.secret.privateKey);
assert.deepEqual(independentlyDecrypted.directEffects, {});
assert.deepEqual(independentlyDecrypted.x402Effects, {});

const restarted = new EncryptedWalletStore(new StateStore(stateRoot), new MacOSLoginKeychainSecret());
const repeated = await restarted.ensure("default");
assert.equal(repeated.identity.address, firstAddress);
assert.equal(repeated.identity.bindingHash, firstBinding);
assert.equal(repeated.identity.createdAt, firstCreatedAt);
assert.deepEqual(await readFile(envelopePath), originalBytes);
assert.equal(control.calls.filter(call => call.shape[0] === "add-generic-password").length, 1);

const negativeCodes = {};
const originalWrapping = control.copySecret();
const wrong = randomBytes(32);
control.setSecret(wrong);
negativeCodes.wrong_secret = await rejectsCode(() => restarted.describe("default"), "APN_STATE_CORRUPT");
control.setSecret(originalWrapping);

const tampered = JSON.parse(originalText);
const tamperedTag = Buffer.from(tampered.cipher.tag, "base64");
tamperedTag[0] ^= 1;
tampered.cipher.tag = tamperedTag.toString("base64");
await writeFile(envelopePath, canonicalJson(tampered) + "\n", { mode: 0o600 });
negativeCodes.tag_tamper = await rejectsCode(() => restarted.describe("default"), "APN_STATE_CORRUPT");
await writeFile(envelopePath, originalBytes, { mode: 0o600 });

for (const mode of ["locked", "denied", "malformed"]) {
  control.mode = mode;
  negativeCodes["keychain_" + mode] = await rejectsCode(() => restarted.describe("default"), "APN_NATIVE_REJECTED");
}
control.mode = "absent";
negativeCodes.no_environment_fallback = await rejectsCode(() => restarted.describe("default"), "APN_STATE_CORRUPT");
control.mode = "normal";

await writeFile(envelopePath, canonicalJson({ privateKey: "plaintext-fallback-canary" }) + "\n", { mode: 0o600 });
negativeCodes.plaintext_fallback = await rejectsCode(() => restarted.describe("default"), "APN_STATE_CORRUPT");
await writeFile(envelopePath, originalBytes, { mode: 0o600 });

await chmod(envelopePath, 0o644);
negativeCodes.unsafe_mode = await rejectsCode(() => restarted.describe("default"), "APN_STATE_SECURITY");
await chmod(envelopePath, 0o600);
const backupPath = join(fixtureRoot, "encrypted-wallet-backup.json");
await rename(envelopePath, backupPath);
await symlink(backupPath, envelopePath);
negativeCodes.symlink_entry = await rejectsCode(() => restarted.describe("default"), "APN_STATE_SECURITY");
await unlink(envelopePath);
await rename(backupPath, envelopePath);

const insecureRoot = join(fixtureRoot, "insecure-mode-root");
await mkdir(insecureRoot, { mode: 0o700 });
await chmod(insecureRoot, 0o755);
negativeCodes.insecure_root = await rejectsCode(() => new StateStore(insecureRoot).initialize(), "APN_STATE_SECURITY");
const realParent = join(fixtureRoot, "real-parent");
const aliasParent = join(fixtureRoot, "alias-parent");
await mkdir(realParent, { mode: 0o700 });
await symlink(realParent, aliasParent);
negativeCodes.symlink_ancestor = await rejectsCode(() => new StateStore(join(aliasParent, "state")).initialize(), "APN_STATE_SECURITY");
negativeCodes.foreign_owner = throwsCode(() => validateDirectory({
  isDirectory: () => true, isSymbolicLink: () => false,
  uid: process.geteuid() + 1, mode: 0o40700,
}, true), "APN_STATE_SECURITY");

const loginKeychain = join(home, "Library", "Keychains", "login.keychain-db");
const findShape = ["find-generic-password", "-a", "default", "-s", "ai.nuanu.apn.wrapping-secret.v1", "-w", loginKeychain];
const addShape = ["add-generic-password", "-a", "default", "-s", "ai.nuanu.apn.wrapping-secret.v1",
  "-l", "Nuanu APN wrapping secret", "-w", "<redacted>", loginKeychain];
const adds = control.calls.filter(call => call.shape[0] === "add-generic-password");
const finds = control.calls.filter(call => call.shape[0] === "find-generic-password");
assert.equal(adds.length, 1);
assert.deepEqual(adds[0].shape, addShape);
assert.equal(adds[0].passwordBytes, 32);
assert.ok(finds.length >= 7);
for (const call of finds) assert.deepEqual(call.shape, findShape);
for (const call of control.calls) {
  assert.equal(call.executable, "/usr/bin/security");
  assert.deepEqual(call.env, { HOME: home, LOGNAME: "apn-storage-fixture", USER: "apn-storage-fixture",
    PATH: "/usr/bin:/bin", LANG: "C" });
}

wallets.clear(first.secret);
wallets.clear(repeated.secret);
independentlyDecrypted.privateKey = "<cleared>";
plaintext.fill(0); key.fill(0); salt.fill(0); nonce.fill(0); tag.fill(0); ciphertext.fill(0);
wrapping.fill(0); originalWrapping.fill(0); wrong.fill(0); tamperedTag.fill(0);
control.zeroize();

const evidence = {
  proof_class: "installed_archive_synthetic_os_boundary_storage",
  package: { name: packageJson.name, version: packageJson.version, os: packageJson.os, cpu: packageJson.cpu,
    unsupported_host_gate: "npm_package_manifest" },
  crypto: { envelope: envelope.schemaVersion, kdf: envelope.kdf.name, cipher: envelope.cipher.name,
    salt_bytes: 32, nonce_bytes: 12, tag_bytes: 16,
    ciphertext_bytes: Buffer.from(envelope.cipher.ciphertext, "base64").length,
    envelope_sha256: createHash("sha256").update(originalBytes).digest("hex"), independent_decrypt: true },
  filesystem: { state_location: "<synthetic-home>/.apn", state_mode: "0700", envelope_mode: "0600",
    owner_match: true, single_link: true, real_lockf_acquired: true },
  keychain: { executable: "/usr/bin/security", keychain: "<synthetic-home>/Library/Keychains/login.keychain-db",
    service: "ai.nuanu.apn.wrapping-secret.v1", account: "default", find_calls: finds.length,
    add_calls: adds.length, generated_secret_bytes: 32 },
  behavior: { stable_identity: true, stable_envelope_bytes: true, add_idempotent: true, negative_codes: negativeCodes },
  boundaries: { real_keychain_access: false, network_access: false, provider_access: false,
    payment_effect: false, external_login: false, os_boundary: "synthetic_preload", generated_keys_exported: false },
};
process.stdout.write(JSON.stringify(evidence));

async function rejectsCode(action, expected) {
  let caught;
  try { await action(); } catch (error) { caught = error; }
  assert.equal(caught?.code, expected);
  return expected;
}
function throwsCode(action, expected) {
  let caught;
  try { action(); } catch (error) { caught = error; }
  assert.equal(caught?.code, expected);
  return expected;
}
`;
