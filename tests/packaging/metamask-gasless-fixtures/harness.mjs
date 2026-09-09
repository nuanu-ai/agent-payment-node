import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { chmod, copyFile, mkdir, mkdtemp, readFile, realpath, readdir, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { Client } from "@modelcontextprotocol/client";
import { StdioClientTransport } from "@modelcontextprotocol/client/stdio";
import { readFixture, writeFixture } from "./responses.mjs";
import { syntheticWallets } from "./signed-effect.mjs";

export const productRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
export const preload = fileURLToPath(new URL("./preload.mjs", import.meta.url));
const runtimePath = join(productRoot, "tests/core/metamask-gasless-chain-fixtures/runtime-code.json");
export const hash = bytes => createHash("sha256").update(bytes).digest("hex");
export const loadModule = (packageRoot, name) => import(pathToFileURL(join(packageRoot, "dist", name)).href);

export async function installedPackage() {
  const root = process.env.APN_MM_INSTALLED_EVIDENCE_DIR ? resolve(process.env.APN_MM_INSTALLED_EVIDENCE_DIR) :
    await mkdtemp(join(await realpath(tmpdir()), "apn-mm-installed-"));
  await mkdir(root, { recursive: true, mode: 0o700 });
  let archive = process.env.APN_MM_TEST_ARCHIVE;
  if (archive === undefined) {
    const packed = await run("npm", ["pack", "--ignore-scripts", "--json", "--pack-destination", root],
      { cwd: productRoot, timeoutMs: 120000 });
    assert.equal(packed.code, 0, packed.stderr);
    archive = join(root, JSON.parse(packed.stdout)[0].filename);
  }
  archive = resolve(archive);
  const directory = await mkdtemp(join(root, "installation-"));
  const unpack = await run("tar", ["-xzf", archive, "-C", directory], { timeoutMs: 30000 });
  assert.equal(unpack.code, 0, unpack.stderr);
  const packageRoot = join(directory, "package");
  const install = await run("npm", ["ci", "--ignore-scripts", "--omit=dev", "--no-audit", "--no-fund"],
    { cwd: packageRoot, timeoutMs: 180000 });
  await writeFile(join(root, "install.log"), install.stdout + install.stderr);
  assert.equal(install.code, 0, install.stderr);
  await stat(join(packageRoot, "dist/metamask-gasless/client/helper-entry.js"));
  const identities = {};
  for (const [name, version] of Object.entries({ "@metamask/agent-sdk": "6.1.4", "@metamask/fox-sdk": "2.7.0",
    "@toruslabs/ethereum-controllers": "9.12.0" })) {
    const info = JSON.parse(await readFile(join(packageRoot, "node_modules", name, "package.json"), "utf8"));
    assert.equal(info.version, version); identities[name] = version;
  }
  const identity = { archive, archiveSha256: hash(await readFile(archive)), packageRoot, dependencies: identities,
    runtimeFixtureSha256: hash(await readFile(runtimePath)) };
  assert.equal(identity.runtimeFixtureSha256, "f37646220871b16931912855b8e5eb0a6627318378e7c132dabd165815364682");
  await writeFile(join(root, "archive-identity.json"), JSON.stringify(identity, null, 2) + "\n");
  return { root, packageRoot, archive, identity };
}

export async function scenario(installed, chainId = 8453, options = {}) {
  const directory = await mkdtemp(join(installed.root, `chain-${chainId}-`)), home = join(directory, "home");
  await mkdir(home, { mode: 0o700 }); await mkdir(join(home, ".metamask"), { mode: 0o700 });
  const { mmRegistry, MM_RPC_ENV } = await loadModule(installed.packageRoot, "metamask-gasless/registry.js");
  const { StateStore } = await loadModule(installed.packageRoot, "state.js");
  const profiles = await loadModule(installed.packageRoot, "provider-profile.js");
  const wallet = syntheticWallets(installed.packageRoot), row = mmRegistry(chainId).row;
  const runtime = JSON.parse(await readFile(runtimePath, "utf8")), refs = runtime.rows.find(item => item.chainId === chainId);
  const project = "synthetic-project-private-canary", payload = Buffer.from(JSON.stringify({ sub: project,
    exp: Math.floor(Date.now() / 1000) + 86400, iat: Math.floor(Date.now() / 1000) - 60 })).toString("base64url");
  const token = `e30.${payload}.synthetic-signature`, refreshToken = "synthetic-refresh-private-canary";
  const selectedRef = options.selectedRef ?? { address: wallet.owner.toUpperCase().replace("0X", "0x") };
  const session = { schemaVersion: "1.0.0", data: { cliToken: token, cliRefreshToken: refreshToken, projectId: project,
    chain: null, walletMode: "server-wallet", tradingMode: "guard", authMethod: "qr", loginMethod: "qr", consent: 0 } };
  const wallets = { schemaVersion: "0.0.1", data: { byokWallets: [], remoteWallets: [{ address: wallet.owner,
    ...(options.nameless ? {} : { name: "fixture-wallet" }), namespace: "evm" }], customEvmChains: [], customSolanaChains: [],
    selectedWallet: { mode: "server", namespace: "evm", ref: selectedRef }, pendingJobs: [] } };
  await writeFile(join(home, ".metamask/session.json"), JSON.stringify(session), { mode: 0o600 });
  await writeFile(join(home, ".metamask/wallets.json"), JSON.stringify(wallets), { mode: 0o600 });
  const profile = "mm-installed", stateRoot = join(home, ".apn"), state = new StateStore(stateRoot);
  await state.initialize(); const capability = profiles.metamaskDirectCapabilitySnapshot();
  const publicProfile = { schema_version: "apn.provider-profile.v1", profile, profile_hash: state.profileHash(profile),
    provider_id: "metamask-agent-wallet", public_address: wallet.owner,
    account_binding_hash: profiles.accountBindingHash("metamask-agent-wallet", wallet.owner),
    capability_snapshot: capability, capability_hash: profiles.capabilityHash(capability), revision: 1,
    trust_class: "provider_managed_non_custodial_signer", observed_at: new Date().toISOString(), drift: { state: "bound", reason: "none" } };
  await state.writeProviderProfile(publicProfile);
  const fixturePath = join(directory, "control.json"), tracePath = join(directory, "transport.jsonl");
  const rpcUrl = `https://rpc.example.test/${chainId}?api-key=synthetic-rpc-private-canary`;
  const fixture = { packageRoot: installed.packageRoot, home, row, owner: wallet.owner, relayer: wallet.relayer,
    recipient: "0x2222222222222222222222222222222222222222", feeRecipient: "0x3333333333333333333333333333333333333333",
    project, token, rpcUrl, tracePath, operationPath: null, postCount: 0, phase: "prepared", initialDesignation: "empty",
    epochSeconds: Math.floor(Date.now() / 1000) - 1000, rawFeeAtomic: "1000", nowOffsetMs: 0,
    codes: { protocol: Object.fromEntries(Object.entries(refs.protocol).map(([name, ref]) => [name, runtime.codes[ref]])),
      tokenProxy: runtime.codes[refs.tokenProxyCode], tokenImplementation: runtime.codes[refs.tokenImplementationCode] }, ...options };
  writeFixture(fixturePath, fixture); await writeFile(tracePath, "", { mode: 0o600 });
  const env = { PATH: process.env.PATH, HOME: home, LANG: "C", TZ: "UTC", APN_MM_TEST_FIXTURE: fixturePath,
    [MM_RPC_ENV[chainId]]: rpcUrl };
  const getFixture = () => readFixture(fixturePath);
  const update = patch => writeFixture(fixturePath, { ...getFixture(), ...patch });
  const cli = async argv => {
    const result = await run(process.execPath, ["--import", preload, join(getFixture().packageRoot, "bin/apn.js"), ...argv],
      { env, timeoutMs: 90000 });
    assert.equal(result.stderr, "", result.stderr);
    const envelope = JSON.parse(result.stdout); assert.equal(result.code, envelope.ok ? 0 : 1, result.stdout);
    safeOutput(result.stdout, getFixture(), refreshToken); return envelope;
  };
  const record = async operationId => JSON.parse(await readFile(join(stateRoot, "metamask-gasless-operations",
    publicProfile.profile_hash, `${operationId}.json`), "utf8"));
  const prepareArgv = key => ["gasless", "transfer", "prepare", "--profile", profile, "--chain", String(chainId),
    "--to", fixture.recipient, "--amount", "1", "--max-fee", "0.002", "--min-received", "0.998", "--idempotency-key", key];
  const prepare = async (key = "mm-installed-1") => {
    const result = await cli(prepareArgv(key)); assert.equal(result.ok, true, JSON.stringify(result));
    const id = result.operation.operation_id;
    update({ operationPath: join(stateRoot, "metamask-gasless-operations", publicProfile.profile_hash, `${id}.json`) });
    return { id, result, record: await record(id) };
  };
  return { ...installed, directory, home, stateRoot, profile, publicProfile, fixturePath, env,
    fixture: getFixture, update, cli, record, prepare, prepareArgv,
    trace: async () => (await readFile(tracePath, "utf8")).split("\n").filter(Boolean).map(line => JSON.parse(line)),
    approve: async (operationId, phrase) => {
      const op = await record(operationId);
      const result = await approvePty(getFixture().packageRoot, env, operationId,
        phrase ?? `APPROVE GASLESS ${operationId} ${op.fingerprint}`);
      safeOutput(result.output, getFixture(), refreshToken);
      const lines = result.output.split(/\r?\n/u);
      const envelope = lines.filter(line => line.startsWith("{")).map(line => { try { return JSON.parse(line); } catch { return null; } }).filter(Boolean).at(-1);
      assert.ok(envelope, result.output); assert.equal(result.code, envelope.ok ? 0 : 1, result.output);
      return { ...result, envelope };
    },
    privateBytes: async () => Promise.all(["session.json", "wallets.json"].map(file => readFile(join(home, ".metamask", file)))),
  };
}

export async function mcp(s) {
  const transport = new StdioClientTransport({ command: process.execPath,
    args: ["--import", preload, join(s.fixture().packageRoot, "bin/apn.js"), "mcp", "serve"], env: s.env, stderr: "pipe" });
  const client = new Client({ name: "apn-mm-installed-proof", version: "1" });
  let stderr = ""; transport.stderr?.on("data", chunk => { stderr += String(chunk); });
  await client.connect(transport);
  return { client, call: async (name, args) => {
    const result = await client.callTool({ name, arguments: args }), content = result.content[0];
    assert.equal(content.type, "text"); const envelope = JSON.parse(content.text);
    assert.deepEqual(envelope, result.structuredContent);
    safeOutput(content.text, s.fixture(), "synthetic-refresh-private-canary"); return envelope;
  }, close: async () => { await client.close(); assert.equal(stderr, ""); assert.equal(transport.pid, null); } };
}

export async function reinstall(s) {
  const root = await mkdtemp(join(s.root, "reinstall-"));
  const result = await run("tar", ["-xzf", s.archive, "-C", root], { timeoutMs: 30000 });
  assert.equal(result.code, 0, result.stderr);
  const packageRoot = join(root, "package");
  // Copy the installed exact dependency closure, while replacing every shipped
  // asset from the same immutable archive. The first installation was npm ci.
  const copy = await run("cp", ["-R", join(s.packageRoot, "node_modules"), join(packageRoot, "node_modules")], { timeoutMs: 120000 });
  assert.equal(copy.code, 0, copy.stderr); s.update({ packageRoot }); return packageRoot;
}

function safeOutput(output, fixture, refresh) {
  for (const secret of [fixture.token, fixture.project, refresh, "synthetic-rpc-private-canary", fixture.effect?.requestId].filter(Boolean)) {
    assert.equal(output.includes(secret), false, "private fixture value escaped public output");
  }
  assert.equal(output.includes("unsignedDelegation"), false);
}
export async function run(executable, args, { cwd, env, timeoutMs = 30000 } = {}) {
  const child = spawn(executable, args, { cwd, env, shell: false, stdio: ["ignore", "pipe", "pipe"] });
  let stdout = "", stderr = "";
  child.stdout.on("data", chunk => { stdout += String(chunk); }); child.stderr.on("data", chunk => { stderr += String(chunk); });
  return await new Promise((resolvePromise, reject) => {
    const timer = setTimeout(() => { child.kill("SIGKILL"); reject(new Error(`bounded command timed out: ${executable}`)); }, timeoutMs);
    child.once("error", error => { clearTimeout(timer); reject(error); });
    child.once("close", code => { clearTimeout(timer); resolvePromise({ code, stdout, stderr }); });
  });
}

async function approvePty(packageRoot, env, operationId, phrase) {
  const script = `set timeout 80
    log_user 1
    spawn $env(APN_NODE_EXEC) --import $env(APN_PRELOAD) $env(APN_BINARY) gasless transfer approve --operation $env(APN_OPERATION)
    expect {
      -re {Type exactly:} { send -- $env(APN_INPUT); send -- "\\r" }
      eof { catch wait result; exit [lindex $result 3] }
      timeout { exit 124 }
    }
    expect {
      eof { catch wait result; exit [lindex $result 3] }
      timeout { exit 124 }
    }`;
  const result = await run("/usr/bin/expect", ["-c", script], { timeoutMs: 85000,
    env: { ...env, TERM: "xterm-256color", APN_NODE_EXEC: process.execPath, APN_PRELOAD: preload,
      APN_BINARY: join(packageRoot, "bin/apn.js"), APN_OPERATION: operationId, APN_INPUT: phrase } });
  return { code: result.code, output: result.stdout + result.stderr };
}
