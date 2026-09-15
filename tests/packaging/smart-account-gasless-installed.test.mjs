import assert from "node:assert/strict";
import { createHash } from "node:crypto";
const approvalCode = (action, ...binding) => createHash("sha256").update(["apn.approval-code.v1", action, ...binding].join("\n"), "utf8").digest("hex").slice(0, 6);
import { createRequire } from "node:module";
import { chmod, mkdir, mkdtemp, readFile, realpath, readdir, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import test, { before } from "node:test";
import { Client } from "@modelcontextprotocol/client";
import { StdioClientTransport } from "@modelcontextprotocol/client/stdio";
import { run } from "./metamask-gasless-fixtures/harness.mjs";

const source = resolve(dirname(fileURLToPath(import.meta.url)), "../.."), digest = b => createHash("sha256").update(b).digest("hex");
const moduleAt = (root, path) => import(pathToFileURL(join(root, "dist", path)).href);
const LEGACY_SHA = "1883f117a84552e720319d2770ea9439fad30d8eb6f1bd3212f344854b0ce267";
const LEGACY_COMMIT = "cf415148c905f8f993a0c53217fc92e40f9fc4f9";
let installed;
before(async () => { installed = await install(); }, { timeout: 600000 });

async function unpackArchive(archive, destination, archiveSha256) {
  const bytes = await readFile(archive); assert.equal(digest(bytes), archiveSha256);
  const snapshot = join(destination, "archive-input.tgz"); await writeFile(snapshot, bytes, { mode: 0o400, flag: "wx" });
  const list = await run("tar", ["-tzf", snapshot]); assert.equal(list.code, 0, list.stderr);
  const all = list.stdout.trim().split("\n"); assert.equal(new Set(all).size, all.length);
  for (const member of all) {
    assert.match(member, /^package\/[A-Za-z0-9_.@/-]*$/u);
    const parts = (member.endsWith("/") ? member.slice(0, -1) : member).split("/");
    assert.equal(parts.shift(), "package");
    assert.ok(parts.every(part => part !== "" && part !== "." && part !== ".."), "archive member escapes package");
  }
  const types = await run("tar", ["-tvzf", snapshot]); assert.equal(types.code, 0, types.stderr);
  assert.ok(types.stdout.trim().split("\n").every(line => line.startsWith("-") || line.startsWith("d")), "only regular archive members");
  const unpack = await run("tar", ["-xzf", snapshot, "-C", destination]); assert.equal(unpack.code, 0, unpack.stderr);
  assert.equal(digest(await readFile(snapshot)), archiveSha256);
  assert.equal(digest(await readFile(archive)), archiveSha256, "archive changed during extraction");
  return { packageRoot: join(destination, "package"), members: all.filter(path => !path.endsWith("/")).map(path => path.slice(8)) };
}
async function verifyFiles(extractedRoot, targetRoot, members, sourceCommit, compareWorkingTree = false) {
  const tree = await run("git", ["ls-tree", "-r", "--full-tree", sourceCommit], { cwd: source });
  assert.equal(tree.code, 0, tree.stderr);
  const blobs = new Map(tree.stdout.trim().split("\n").map(line => { const [identity, path] = line.split("\t");
    return [path, identity.split(" ")]; }));
  const files = [];
  for (const path of members) {
    const bytes = await readFile(join(extractedRoot, path)), entry = await stat(join(targetRoot, path));
    assert.equal(entry.isFile(), true); assert.equal(entry.nlink, 1);
    assert.equal(await realpath(join(targetRoot, path)), join(targetRoot, path));
    assert.deepEqual(bytes, await readFile(join(targetRoot, path)), path);
    if (compareWorkingTree) assert.deepEqual(bytes, await readFile(join(source, path)), path);
    const [mode, type, blob] = blobs.get(path) ?? [];
    assert.ok(mode === "100644" || mode === "100755", path); assert.equal(type, "blob", path);
    const actual = createHash("sha1").update(Buffer.from(`blob ${bytes.length}\0`)).update(bytes).digest("hex");
    assert.equal(actual, blob, path); files.push({ path, sha256: digest(bytes), bytes: bytes.length });
  }
  return files;
}
async function install() {
  const root = process.env.APN_SA_INSTALLED_EVIDENCE_DIR ? await realpath(process.env.APN_SA_INSTALLED_EVIDENCE_DIR) :
    await mkdtemp(join(await realpath(tmpdir()), "apn-sa-installed-"));
  let archive = process.env.APN_SA_TEST_ARCHIVE;
  if (!archive) {
    // Honor the package's real prepack gates. A previously verified archive may be supplied explicitly.
    const packEnv = { ...process.env }; delete packEnv.NODE_TEST_CONTEXT;
    const result = await run("npm", ["pack", "--json", "--pack-destination", root], { cwd: source, env: packEnv, timeoutMs: 540000 });
    const output = result.stdout + result.stderr;
    await writeFile(join(root, "pack.log"), output); assert.equal(result.code, 0);
    assert.doesNotMatch(output, /skipping running files|called recursively/u);
    const counts = Object.fromEntries(["tests", "pass", "fail", "skipped"].map(key => [key,
      Number([...output.matchAll(new RegExp(`(?:#|ℹ)\\s+${key}\\s+(\\d+)`, "gu"))].at(-1)?.[1])]));
    assert.ok(counts.tests > 0); assert.equal(counts.pass, counts.tests); assert.equal(counts.fail, 0); assert.equal(counts.skipped, 0);
    await writeFile(join(root, "pack-gate.json"), JSON.stringify({ nestedTestContextRemoved: true, ...counts }, null, 2) + "\n");
    const start = result.stdout.startsWith("[\n") ? 0 : result.stdout.lastIndexOf("\n[\n") + 1;
    const metadata = JSON.parse(result.stdout.slice(start)); assert.equal(metadata.length, 1);
    archive = join(root, metadata[0].filename);
  }
  archive = await realpath(archive);
  const destination = await mkdtemp(join(root, "installation-"));
  const archiveSha256 = digest(await readFile(archive)), { packageRoot, members } = await unpackArchive(archive, destination, archiveSha256);
  const revision = await run("git", ["rev-parse", "HEAD"], { cwd: source }); assert.equal(revision.code, 0);
  const sourceCommit = revision.stdout.trim(), files = await verifyFiles(packageRoot, packageRoot, members, sourceCommit, true);
  const result = await run("npm", ["ci", "--omit=dev", "--ignore-scripts", "--offline", "--no-audit", "--no-fund"],
    { cwd: packageRoot, timeoutMs: 180000 });
  await writeFile(join(root, "install.log"), result.stdout + result.stderr); assert.equal(result.code, 0, result.stderr);
  for (const file of files) assert.equal(digest(await readFile(join(packageRoot, file.path))), file.sha256);
  const { assertMetaMaskSmartAccountPackageIdentity } = await moduleAt(packageRoot, "metamask-smart-account-package.js");
  await assertMetaMaskSmartAccountPackageIdentity();
  assert.equal(digest(await readFile(archive)), archiveSha256);
  const manifest = { archive, archiveSha256, packageRoot, sourceCommit,
    fileCount: files.length, allArchiveFilesMatchGitSourceAndInstalledBytes: true, files };
  const manifestPath = join(root, "archive-identity.json"); await writeFile(manifestPath, JSON.stringify(manifest, null, 2) + "\n");
  const { SA_RUNTIME_CODES } = await import(pathToFileURL(join(source, "dist-test/tests/core/smart-account-gasless-chain-fixtures.js")));
  const preload = join(root, "offline-preload.mjs"); await writeFile(preload, `await (${offlinePreload.toString()})();\n`);
  return { root, archive, packageRoot, manifest, manifestPath, manifestSha256: digest(await readFile(manifestPath)),
    codes: SA_RUNTIME_CODES, preload };
}

async function scenario(crash = null) {
  const root = await mkdtemp(join(installed.root, "scenario-")), home = join(root, "home"), profile = "sa-installed";
  await mkdir(home, { mode: 0o700 });
  const { StateStore } = await moduleAt(installed.packageRoot, "state.js"), state = new StateStore(join(home, ".apn"));
  await state.initialize();
  const require = createRequire(join(installed.packageRoot, "package.json"));
  const { privateKeyToAccount } = require("viem/accounts"), { encodePacked } = require("viem");
  const { createErc20TokenAllowanceCaveats } = require("@metamask/7715-permission-types");
  const { ROOT_AUTHORITY } = require("@metamask/smart-accounts-kit");
  const { encodeDelegations, toDelegationStruct, SIGNABLE_DELEGATION_TYPED_DATA } = require("@metamask/smart-accounts-kit/utils");
  const { saRegistry } = await moduleAt(installed.packageRoot, "smart-account-gasless/registry.js"), row = saRegistry(8453);
  // Public deterministic keys, used only in this temporary fixture state.
  const ownerKey = `0x${"1".repeat(64)}`, sessionKey = `0x${"2".repeat(64)}`, ownerAccount = privateKeyToAccount(ownerKey);
  const owner = ownerAccount.address.toLowerCase(), session = privateKeyToAccount(sessionKey).address.toLowerCase();
  const now = Math.floor(Date.now() / 1000), starts = now - 1000, expires = now + 86400;
  const permission = { type: "erc20-token-allowance", isAdjustmentAllowed: true,
    data: { tokenAddress: row.token.address, allowanceAmount: "0x1e8480", startTime: starts, justification: "Public installed fixture" } };
  const caveats = createErc20TokenAllowanceCaveats({ permission, contracts: {
    erc20PeriodTransferEnforcer: row.protocol.period.address, valueLteEnforcer: row.protocol.value.address } });
  caveats.push({ enforcer: row.protocol.nonce.address, terms: `0x${"0".repeat(64)}`, args: "0x" },
    { enforcer: row.protocol.timestamp.address, terms: encodePacked(["uint128", "uint128"], [0n, BigInt(expires)]), args: "0x" });
  const unsigned = { delegate: session, delegator: owner, authority: ROOT_AUTHORITY, caveats, salt: "0x01", signature: "0x" };
  const signature = await ownerAccount.signTypedData({ domain: { chainId: 8453, name: "DelegationManager", version: "1",
    verifyingContract: row.protocol.manager.address }, types: SIGNABLE_DELEGATION_TYPED_DATA,
    primaryType: "Delegation", message: toDelegationStruct(unsigned) });
  const context = encodeDelegations([{ ...unsigned, signature }]);
  const forbidden = new Set(), outputs = [];
  const checkOutput = output => { outputs.push(output); safe(output, forbidden); };
  const protect = values => { for (const value of values) for (const form of sensitiveForms(value)) forbidden.add(form);
    for (const output of outputs) safe(output, forbidden); };
  protect([ownerKey, sessionKey, context, signature]);
  const response = { chainId: "0x2105", from: owner, to: session, permission,
    rules: [{ type: "expiry", data: { timestamp: expires } }], context, dependencies: [], delegationManager: row.protocol.manager.address };
  const { validateSmartAccountObservation } = await moduleAt(installed.packageRoot, "metamask-smart-account-grant.js");
  const grant = validateSmartAccountObservation({ owner_address: owner, chain_id: "0x2105", account_code: row.ownerDesignationCode,
    supported_permissions: { "erc20-token-allowance": { ruleTypes: ["expiry"] } }, permission_responses: [response] },
  { sessionAddress: session, capAtomic: "2000000", startsAtUnix: starts, expiresAtUnix: expires, nowUnix: now });
  const { EncryptedSmartAccountPermissionStore } = await moduleAt(installed.packageRoot, "encrypted-smart-account-permission-store.js");
  const wrapping = { load: async () => Buffer.from("33".repeat(32), "hex"), create: async () => { throw new Error("no new custody"); } };
  await new EncryptedSmartAccountPermissionStore(state, wrapping).save({ schema_version: "apn.metamask-smart-account-permission.v1",
    profile, profile_hash: state.profileHash(profile), provider_id: "metamask-smart-account", idempotency_hash: "4".repeat(64),
    intent_fingerprint: "5".repeat(64), phase: "active", revision: 1, requested_cap_atomic: "2000000",
    requested_expires_at_unix: expires, starts_at_unix: starts, session_address: session, session_private_key: sessionKey,
    created_at: new Date(starts * 1000).toISOString(), updated_at: new Date(now * 1000).toISOString(), max_observed_unix: now,
    revocation_freshness: "confirmed_present", owner_address: owner, granted_cap_atomic: grant.grantedCapAtomic,
    granted_expires_at_unix: grant.grantedExpiresAtUnix, grant_context: grant.context, grant_fingerprint: grant.grantFingerprint,
    delegation_manager: grant.delegationManager, permission_response: grant.permissionResponse });
  const p = await moduleAt(installed.packageRoot, "provider-profile.js"), capability = p.metamaskSmartAccountX402CapabilitySnapshot();
  await state.writeProviderProfile({ schema_version: "apn.provider-profile.v1", profile, profile_hash: state.profileHash(profile),
    provider_id: "metamask-smart-account", public_address: owner, account_binding_hash: p.accountBindingHash("metamask-smart-account", owner),
    capability_snapshot: capability, capability_hash: p.capabilityHash(capability), revision: 1,
    trust_class: "external_owner_delegated_local_session", observed_at: new Date(now * 1000).toISOString(), drift: { state: "bound", reason: "none" } });
  const fixturePath = join(root, "fixture.json"), tracePath = join(root, "trace.jsonl"), rpc = "https://rpc.example.test/base";
  let control = { home, packageRoot: installed.packageRoot, row, owner, session, codes: installed.codes, rpc, tracePath,
    epoch: now - 2, offset: 0, head: 50000000, crash, denyKeychain: false, denyEffects: false };
  await writeFile(fixturePath, JSON.stringify(control), { mode: 0o600 }); await writeFile(tracePath, "", { mode: 0o600 });
  // The pinned SDK honors DO_NOT_TRACK before its optional analytics bootstrap.
  // Keep every network surface denied; no telemetry request is required to sign.
  const env = { PATH: process.env.PATH, HOME: home, LANG: "C", TZ: "UTC", DO_NOT_TRACK: "1",
    APN_SA_TEST_FIXTURE: fixturePath, APN_BASE_RPC_URL: rpc };
  const invoke = argv => run(process.execPath, ["--import", installed.preload, join(installed.packageRoot, "bin/apn.js"), ...argv],
    { env, timeoutMs: 60000 });
  const cli = async argv => { const r = await invoke(argv); checkOutput(r.stdout + r.stderr); assert.equal(r.stderr, "");
    const value = JSON.parse(r.stdout); assert.equal(r.code, value.ok ? 0 : 1, r.stdout); return value; };
  const operation = async id => JSON.parse(await readFile(join(state.root, "smart-account-gasless-operations", state.profileHash(profile), `${id}.json`)));
  return { root, home, state, profile, env, control, cli, invoke, operation, safe: checkOutput, protect,
    prepareArgs: key => ["gasless", "transfer", "prepare", "--profile", profile, "--chain", "8453", "--to",
      "0x4444444444444444444444444444444444444444", "--amount", "0.01", "--max-fee", "0", "--min-received", "0.01", "--idempotency-key", key],
    trace: async () => (await readFile(tracePath, "utf8")).trim().split("\n").filter(Boolean).map(line => JSON.parse(line)),
    update: async patch => { control = { ...control, ...patch }; await writeFile(fixturePath, JSON.stringify(control)); },
    privateBytes: () => readFile(join(state.root, "smart-account-permissions", `${state.profileHash(profile)}.json`)),
  };
}

function sensitiveForms(value) {
  const forms = [value, Buffer.from(value).toString("base64")];
  if (/^0x[0-9a-f]+$/iu.test(value)) forms.push(value.slice(2), Buffer.from(value.slice(2), "hex").toString("base64"));
  return forms.filter(form => form.length > 32);
}
function safe(output, extra = []) {
  for (const forbidden of [`0x${"1".repeat(64)}`, `0x${"2".repeat(64)}`, "33".repeat(32),
    Buffer.from("33".repeat(32), "hex").toString("base64"), "permissionContext", "session_private_key", "paymentPayload",
    ...extra]) assert.equal(output.includes(forbidden), false, "private material in output");
}
async function approval(s, id, phrase) {
  const op = await s.operation(id), script = `set timeout 55
    spawn $env(APN_TEST_NODE) --import $env(APN_TEST_PRELOAD) $env(APN_TEST_BIN) gasless transfer approve --operation $env(APN_TEST_OPERATION)
    expect {
      -re {press Enter to confirm} { send -- $env(APN_TEST_PHRASE); send -- "\\r" }
      eof { catch wait result; exit [lindex $result 3] }
      timeout { exit 124 }
    }
    expect {
      eof { catch wait result; exit [lindex $result 3] }
      timeout { exit 124 }
    }`;
  const result = await run("/usr/bin/expect", ["-c", script], { timeoutMs: 60000, env: { ...s.env, TERM: "xterm-256color",
    APN_TEST_NODE: process.execPath, APN_TEST_PRELOAD: installed.preload, APN_TEST_BIN: join(installed.packageRoot, "bin/apn.js"),
    APN_TEST_OPERATION: id, APN_TEST_PHRASE: phrase ?? approvalCode("gasless", id, op.fingerprint) } });
  s.safe(result.stdout + result.stderr); assert.equal(result.stderr, ""); return result;
}
async function mcp(s) {
  const transport = new StdioClientTransport({ command: process.execPath, args: ["--import", installed.preload,
    join(installed.packageRoot, "bin/apn.js"), "mcp", "serve"], env: s.env, stderr: "pipe" });
  const client = new Client({ name: "installed-smart-account-proof", version: "1" });
  let stderr = ""; transport.stderr?.on("data", chunk => { stderr += String(chunk); }); await client.connect(transport);
  return { client, call: async (name, args) => { const r = await client.callTool({ name, arguments: args });
    s.safe(JSON.stringify(r)); const value = JSON.parse(r.content[0].text); assert.deepEqual(value, r.structuredContent); return value; },
  close: async () => { await client.close(); s.safe(stderr); assert.equal(stderr, ""); } };
}
async function journalBytes(s, id) {
  return Promise.all(["smart-account-gasless-operations", "smart-account-gasless-receipts"].map(folder =>
    readFile(join(s.state.root, folder, s.state.profileHash(s.profile), `${id}.json`)).then(digest)));
}
async function exposedMaterial(s, id) {
  const { EncryptedSmartAccountGaslessMaterialStore } = await moduleAt(installed.packageRoot, "encrypted-smart-account-gasless-material-store.js");
  const wrapping = { load: async () => Buffer.from("33".repeat(32), "hex"), create: async () => { throw new Error("no new custody"); } };
  const bytes = await readFile(join(s.state.root, "smart-account-gasless-materials", `${id}.json`));
  const material = await new EncryptedSmartAccountGaslessMaterialStore(s.state, wrapping).load(id), op = await s.operation(id);
  assert.equal(material.phase, "exposed"); assert.equal(material.materialHash, op.material.materialHash);
  assert.equal(material.childDelegationHash, op.material.childDelegationHash);
  assert.ok(Date.parse(material.updated_at) >= Date.parse(op.exposureStartedAt));
  const require = createRequire(join(installed.packageRoot, "package.json"));
  const { decodeDelegations } = require("@metamask/smart-accounts-kit/utils");
  s.protect([material.root_context, material.encoded_child, material.permission_context, material.payment_payload_canonical_json,
    ...decodeDelegations(material.permission_context).map(delegation => delegation.signature)]);
  assert.deepEqual(await readFile(join(s.state.root, "smart-account-gasless-materials", `${id}.json`)), bytes);
  return bytes;
}
async function gate(s, manifest = installed.manifest, manifestPath = installed.manifestPath, manifestSha256 = installed.manifestSha256) {
  return run(process.execPath, [join(installed.packageRoot, "dist/smart-account-gasless/recovery-gate.js"),
    "--state-root", s.state.root, "--archive", manifest.archive, "--manifest", manifestPath,
    "--manifest-sha256", manifestSha256, "--package-root", manifest.packageRoot]);
}

test("installed CLI and 48-tool MCP discover Base Smart Account gasless without state or external effects", async () => {
  const s = await scenario(); await chmod(s.state.root, 0o777);
  const capabilities = await s.cli(["gasless", "capabilities", "--profile", s.profile]); assert.equal(capabilities.ok, true);
  const row = capabilities.data.profiles.find(p => p.provider === "metamask-smart-account");
  assert.equal(row.adapter, "implemented"); assert.equal(row.mainnet_acceptance, "open");
  assert.equal(capabilities.data.provider_networks["metamask-smart-account"][0].executable_adapter, true);
  const connection = await mcp(s);
  try { const tools = await connection.client.listTools(); assert.equal(tools.tools.length, 48);
    assert.deepEqual((await connection.call("apn_gasless_capabilities", { profile: s.profile })).data, capabilities.data);
  } finally { await connection.close(); }
  assert.deepEqual(await s.trace(), []); assert.equal((await stat(s.state.root)).mode & 0o777, 0o777);
});

test("installed ordinary prepare, real TTY, SDK, encrypted material and RPC-only unused recovery preserve one-effect bounds", { timeout: 240000 }, async () => {
  const s = await scenario(), beforePrivate = await s.privateBytes(), connection = await mcp(s);
  let id;
  try {
    const prepared = await connection.call("apn_gasless_transfer_prepare", { profile: s.profile, chain: "8453",
      to: "0x4444444444444444444444444444444444444444", amount: "0.01", max_fee: "0", min_received: "0.01", idempotency_key: "installed-one" });
    assert.equal(prepared.ok, true, JSON.stringify(prepared)); id = prepared.operation.operation_id;
    const trace = await s.trace(); assert.deepEqual((await s.cli(s.prepareArgs("installed-one"))).operation, prepared.operation);
    const handoff = await connection.call("apn_gasless_transfer_approve", { operation: id });
    assert.equal(handoff.error.code, "APN_FOREGROUND_APPROVAL_REQUIRED"); assert.deepEqual(await s.trace(), trace);
    assert.equal((await s.cli(["gasless", "transfer", "approve", "--operation", id])).error.code, "APN_FOREGROUND_APPROVAL_REQUIRED");
    assert.equal((await approval(s, id)).code, 0);
    const op = await s.operation(id); assert.equal(op.terminal, false); assert.equal(op.signingAttempts, 1);
    assert.equal(op.exposureAttempts, 1); assert.equal(op.submissionAttempts, 1); assert.equal(op.settlement, null);
    const materialPath = join(s.state.root, "smart-account-gasless-materials", `${id}.json`), sealed = await exposedMaterial(s, id);
    assert.equal((await stat(materialPath)).mode & 0o777, 0o600); safe(sealed.toString());
    const selected = await gate(s); assert.equal(selected.code, 0, selected.stdout); assert.equal(JSON.parse(selected.stdout).guards_held, 1);
    await s.update({ denyKeychain: true, denyEffects: true });
    const status = await connection.call("apn_operation_status", { operation: id }); assert.equal(status.operation.terminal, false);
    await s.cli(["operation", "resume", "--operation", id]); assert.deepEqual(await readFile(materialPath), sealed);
    await s.update({ offset: 700000, head: 50000350 });
    const terminal = await s.cli(["operation", "resume", "--operation", id]); assert.equal(terminal.ok, true, JSON.stringify(terminal));
    assert.equal(terminal.operation.state, "expired_unused"); assert.equal(terminal.operation.terminal, true);
    const bytes = await journalBytes(s, id), traceAtTerminal = await s.trace();
    const receipt = await s.cli(["receipt", "get", "--operation", id]);
    assert.deepEqual((await connection.call("apn_receipt_get", { operation: id })).receipt, receipt.receipt);
    await s.cli(["operation", "resume", "--operation", id]); assert.deepEqual(await journalBytes(s, id), bytes);
    assert.deepEqual(await s.trace(), traceAtTerminal); assert.deepEqual(await s.privateBytes(), beforePrivate);
    await effectCounts(s, { sign: 1, verify: 1, settle: 1, supported: 1 });
    await writeFile(join(installed.root, "ordinary-installed-proof.json"), JSON.stringify({ archiveSha256: installed.manifest.archiveSha256,
      proofClass: "installed_real_sdk_storage_and_rpc_parser_with_synthetic_os_https", operationId: id,
      finalState: "expired_unused", successfulDeliveryClaimed: false, realMainnetEffects: false,
      sdkTelemetryDisabledBy: "DO_NOT_TRACK=1" }, null, 2) + "\n");
  } finally { await connection.close(); }
});

test("installed process deaths at verification and settlement never repeat SDK signing or provider calls", { timeout: 240000 }, async t => {
  for (const crash of ["verify", "settle"]) await t.test(crash, async () => {
    const s = await scenario(crash), prepared = await s.cli(s.prepareArgs(`crash-${crash}`));
    assert.equal(prepared.ok, true, JSON.stringify(prepared)); const id = prepared.operation.operation_id;
    const result = await approval(s, id); assert.equal(result.code, 73, result.stdout);
    const op = await s.operation(id); assert.equal(op.exposureAttempts, 1); assert.equal(op.signingAttempts, 1);
    assert.equal(op.submissionAttempts, crash === "settle" ? 1 : 0);
    assert.equal(op.state, crash === "settle" ? "dispatch_pending" : "exposure_pending");
    const sealed = await exposedMaterial(s, id);
    await s.update({ crash: null, denyKeychain: true, denyEffects: true, offset: 700000, head: 50000350 });
    const resumed = await s.cli(["operation", "resume", "--operation", id]); assert.equal(resumed.ok, true, JSON.stringify(resumed));
    assert.equal(resumed.operation.state, "expired_unused");
    assert.deepEqual(await readFile(join(s.state.root, "smart-account-gasless-materials", `${id}.json`)), sealed);
    await effectCounts(s, { sign: 1, verify: 1, settle: crash === "settle" ? 1 : 0, supported: 1 });
  });
});

test("actual I745 cannot discover the new family and the verified selection gate refuses it before target execution", { timeout: 120000 }, async () => {
  const originalPath = process.env.APN_SA_LEGACY_MANIFEST;
  assert.ok(originalPath, "APN_SA_LEGACY_MANIFEST must identify actual retained I745 evidence; never substitute a fixture archive");
  const original = JSON.parse(await readFile(originalPath)), legacy = { ...original,
    archive: await realpath(original.archive), packageRoot: await realpath(original.packageRoot) };
  assert.equal(digest(await readFile(legacy.archive)), LEGACY_SHA); assert.equal(legacy.archiveSha256, LEGACY_SHA);
  assert.equal(legacy.sourceCommit, LEGACY_COMMIT); assert.equal(legacy.fileCount, 883);
  const historical = await unpackArchive(legacy.archive, await mkdtemp(join(installed.root, "i745-extraction-")), LEGACY_SHA);
  const files = await verifyFiles(historical.packageRoot, legacy.packageRoot, historical.members, LEGACY_COMMIT);
  assert.equal(digest(await readFile(legacy.archive)), LEGACY_SHA);
  assert.equal(files.length, 883);
  const sortFiles = rows => [...rows].sort((a, b) => a.path.localeCompare(b.path));
  assert.deepEqual(sortFiles(legacy.files), sortFiles(files));
  assert.equal(legacy.allArchiveFilesMatchGitSourceAndInstalledBytes, true);
  const manifestPath = join(installed.root, "i745-canonical-identity.json"), verifiedManifestBytes = Buffer.from(JSON.stringify(legacy));
  const verifiedManifestSha256 = digest(verifiedManifestBytes); await writeFile(manifestPath, verifiedManifestBytes);
  const s = await scenario("verify"), prepared = await s.cli(s.prepareArgs("archive-barrier")); assert.equal(prepared.ok, true);
  const id = prepared.operation.operation_id; assert.equal((await approval(s, id)).code, 73);
  await exposedMaterial(s, id);
  const before = await journalBytes(s, id), trace = await s.trace(), op = await s.operation(id);
  const { OperationService } = await moduleAt(legacy.packageRoot, "operation-service.js");
  const { StateStore } = await moduleAt(legacy.packageRoot, "state.js");
  // Explicit effect-free historical lookup probe, never a selected executable or approval.
  const old = new OperationService(new StateStore(s.state.root));
  await assert.rejects(old.required(id), { code: "APN_OPERATION_NOT_FOUND" }); await old.assertProfileAvailable(op.profileHash);
  const result = await gate(s, legacy, manifestPath, verifiedManifestSha256); assert.equal(result.code, 1, result.stdout);
  assert.equal(JSON.parse(result.stdout).error.reason, "sa_gasless_archive_incompatible");
  assert.deepEqual(await journalBytes(s, id), before); assert.deepEqual(await s.trace(), trace);
  const current = await gate(s); assert.equal(current.code, 0, current.stdout);
  assert.equal(JSON.parse(current.stdout).supports_smart_account_gasless, true);
  assert.deepEqual(await journalBytes(s, id), before);
});

async function effectCounts(s, expected) {
  const trace = await s.trace(); assert.deepEqual(trace.filter(x => x.kind === "denied" || x.kind === "fixture-error"), []);
  for (const [kind, count] of Object.entries(expected)) assert.equal(trace.filter(x => x.kind === kind).length, count, kind);
  assert.equal(trace.some(x => /send|sign|approve/iu.test(x.rpcMethod ?? "")), false);
}

/** External OS/transport fixture; the archive is never rewritten. The SDK spy delegates to the actual shipped engine. */
async function offlinePreload() {
  const assert = (await import("node:assert/strict")).default, { EventEmitter } = await import("node:events");
  const { readFileSync, appendFileSync } = await import("node:fs"), { createRequire, syncBuiltinESMExports } = await import("node:module");
  const { pathToFileURL } = await import("node:url"), { PassThrough } = await import("node:stream");
  const path = process.env.APN_SA_TEST_FIXTURE; assert.ok(path);
  const read = () => JSON.parse(readFileSync(path, "utf8")), initial = read();
  const trace = item => appendFileSync(initial.tracePath, JSON.stringify(item) + "\n");
  const denied = surface => { trace({ kind: "denied", surface }); throw new Error("offline denied " + surface); };
  const require = createRequire(pathToFileURL(initial.packageRoot + "/package.json")), os = require("node:os");
  const identity = os.userInfo(); os.userInfo = () => ({ ...identity, homedir: initial.home }); os.homedir = () => initial.home;
  const NativeDate = Date;
  globalThis.Date = class extends NativeDate {
    constructor(...args) { super(...(args.length ? args : [NativeDate.now() + read().offset])); }
    static now() { return NativeDate.now() + read().offset; }
  };
  const dns = require("node:dns"), dp = require("node:dns/promises"), https = require("node:https"), http = require("node:http");
  const hosts = new Set([new URL(initial.rpc).hostname, new URL(initial.row.facilitatorUrl).hostname]);
  dp.lookup = async hostname => { if (!hosts.has(hostname)) denied("dns"); return [{ address: "8.8.8.8", family: 4 }]; };
  dns.lookup = () => denied("callback-dns");
  for (const name of ["resolve", "resolve4", "resolve6", "resolveAny"]) dns[name] = dp[name] = () => denied(name);
  http.request = http.get = https.get = () => denied("http-bypass");
  require("node:net").connect = require("node:net").createConnection = require("node:tls").connect = () => denied("socket");
  globalThis.fetch = async () => denied("fetch");
  const cp = require("node:child_process"), spawn = cp.spawn;
  cp.spawn = (executable, args, options) => {
    if (executable === "/usr/bin/lockf") {
      assert.deepEqual(args, ["-s", "-t", "0", "3"]); const fd = options?.stdio?.[3];
      assert.ok(Number.isSafeInteger(fd) && fd >= 0);
      assert.deepEqual(options, { stdio: ["ignore", "ignore", "ignore", fd], env: {}, shell: false });
      return spawn(executable, args, options);
    }
    if (executable !== "/usr/bin/security" || read().denyKeychain || args[0] !== "find-generic-password") return denied("custody");
    assert.deepEqual(args, ["find-generic-password", "-a", "default", "-s", "ai.nuanu.apn.wrapping-secret.v1", "-w",
      initial.home + "/Library/Keychains/login.keychain-db"]);
    const { shell = false, cwd, ...otherOptions } = options;
    assert.equal(shell, false); assert.equal(cwd, undefined);
    assert.deepEqual(otherOptions, { stdio: ["pipe", "pipe", "pipe"], env: { HOME: initial.home,
      LOGNAME: identity.username, USER: identity.username, PATH: "/usr/bin:/bin", LANG: "C" } });
    trace({ kind: "keychain-read" }); const child = new EventEmitter();
    child.stdin = new PassThrough(); child.stdout = new PassThrough(); child.stderr = new PassThrough(); child.kill = () => true;
    setImmediate(() => { child.stdout.emit("data", Buffer.from(Buffer.from("33".repeat(32), "hex").toString("base64") + "\n")); child.emit("close", 0); });
    return child;
  };
  for (const name of ["exec", "execFile", "execSync", "execFileSync", "spawnSync", "fork"]) cp[name] = () => denied("child-" + name);
  const word = n => "0x" + BigInt(n).toString(16).padStart(64, "0"), quantity = n => "0x" + BigInt(n).toString(16);
  function block(number, c) {
    const n = BigInt(number); return { number: quantity(n), hash: word(n + 1n), parentHash: word(n),
      timestamp: quantity(BigInt(c.epoch) + (n - 50000000n) * 2n), transactions: [] };
  }
  function reply(url, method, body) {
    const c = read(), row = c.row;
    if (url.href === c.rpc) {
      assert.equal(method, "POST"); const request = JSON.parse(body), [a, b] = request.params;
      trace({ kind: "rpc", rpcMethod: request.method }); let result;
      if (request.method === "eth_chainId") result = "0x2105";
      else if (request.method === "eth_getBlockByNumber") result = block(a === "latest" ? c.head :
        a === "safe" ? c.head - 20 : a === "finalized" ? c.head - 40 : BigInt(a), c);
      else if (request.method === "eth_getCode") result = a.toLowerCase() === c.owner ? row.ownerDesignationCode :
        a.toLowerCase() === c.session ? "0x" : c.codes[a.toLowerCase()];
      else if (request.method === "eth_getStorageAt") result = word(row.token.implementationAddress);
      else if (request.method === "eth_getBalance") result = "0x0";
      else if (request.method === "eth_getLogs") result = [];
      else if (["eth_getTransactionByHash", "eth_getTransactionReceipt"].includes(request.method)) result = null;
      else if (request.method === "eth_call") {
        assert.match(b, /^0x[0-9a-f]+$/u); const selector = a.data.slice(0, 10);
        if (selector === "0x313ce567") result = word(6);
        else if (selector === "0x3644e515") result = row.token.domainSeparator;
        else if (selector === "0x70a08231") result = word(2000000);
        else if (selector === "0x6a9843f6") result = word(2000000) + word(1).slice(2) + word(1).slice(2);
        else if (["0x2bd4ed21", "0x9dd5d9ab"].includes(selector)) result = word(0);
      }
      if (result === undefined) return denied("unexpected-rpc-" + request.method);
      return { jsonrpc: "2.0", id: request.id, result };
    }
    const action = url.pathname.split("/").at(-1);
    if (action === "supported") { if (c.denyEffects) return denied("provider-capabilities");
      assert.equal(method, "GET"); trace({ kind: "supported" }); return {
      kinds: [{ x402Version: 2, scheme: "exact", network: "eip155:8453", extra: { assetTransferMethods: ["erc7710"],
        facilitatorAddresses: row.facilitatorAddresses } }], extensions: [], signers: { "eip155:*": row.facilitatorAddresses } }; }
    if (!["verify", "settle"].includes(action) || c.denyEffects) return denied("provider-effect");
    assert.equal(method, "POST"); const input = JSON.parse(body); assert.equal(input.paymentRequirements.amount, "10000");
    assert.equal(input.paymentPayload.accepted.payTo, "0x4444444444444444444444444444444444444444");
    trace({ kind: action }); if (c.crash === action) process.exit(73);
    return action === "verify" ? { isValid: true, payer: c.owner } : { success: false, errorReason: "synthetic lost result" };
  }
  https.request = (input, options, callback) => {
    const url = new URL(input); if (url.protocol !== "https:" || !hosts.has(url.hostname)) return denied("https");
    assert.equal(options.agent, false); assert.notEqual(options.rejectUnauthorized, false);
    const request = new EventEmitter(); request.destroyed = false; request.destroy = () => { request.destroyed = true; return request; };
    request.end = body => { setImmediate(() => {
      if (request.destroyed) return;
      const socket = new EventEmitter(); socket.remoteAddress = "8.8.8.8"; request.emit("socket", socket); socket.emit("connect");
      try {
        const bytes = Buffer.from(JSON.stringify(reply(url, options.method, body === undefined ? null : String(body))));
        const response = new EventEmitter(); response.statusCode = 200; response.headers = { "content-length": String(bytes.length) };
        response.destroyed = false; response.destroy = () => { response.destroyed = true; };
        callback(response); if (!response.destroyed && !request.destroyed) response.emit("data", bytes);
        if (!response.destroyed && !request.destroyed) response.emit("end");
      } catch (error) { trace({ kind: "fixture-error", type: error.name }); request.emit("error", new Error("offline response rejected")); }
    }); return request; }; return request;
  };
  syncBuiltinESMExports();
  const { OfficialErc7710Engine } = await import(pathToFileURL(initial.packageRoot + "/dist/smart-account-erc7710/engine.js"));
  const original = OfficialErc7710Engine.prototype.create;
  OfficialErc7710Engine.prototype.create = async function (...args) {
    if (read().denyEffects) return denied("sdk-sign"); trace({ kind: "sign" }); return original.apply(this, args);
  };
}
