import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { EventEmitter } from "node:events";
import { mkdtemp, readFile, realpath, rm } from "node:fs/promises";
import https from "node:https";
import { syncBuiltinESMExports } from "node:module";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import test from "node:test";

const source = resolve(import.meta.dirname, "../..");
const WETH = "0x4200000000000000000000000000000000000006";
const RECIPIENT = "0x000000000000000000000000000000000000dEaD";
const BLOCK_HASH = `0x${"b".repeat(64)}`;
const NOW = new Date("2026-09-28T00:00:00.000Z");
const digest = bytes => createHash("sha256").update(bytes).digest("hex");

async function command(binary, args, cwd) {
  return await new Promise((resolveRun, reject) => {
    const child = spawn(binary, args, { cwd, env: { ...process.env, npm_config_ignore_scripts: "true" } });
    let stdout = "", stderr = "";
    child.stdout.on("data", chunk => { stdout += chunk; });
    child.stderr.on("data", chunk => { stderr += chunk; });
    child.on("error", reject);
    child.on("close", code => resolveRun({ code, stdout, stderr }));
  });
}

function rpcAnswer(method, params, owner) {
  const word = number => `0x${number.toString(16).padStart(64, "0")}`;
  if (method === "eth_chainId") return "0x2105";
  if (method === "eth_getBlockByNumber") return { number: "0x317", hash: BLOCK_HASH, baseFeePerGas: "0x1dcd6500", transactions: [] };
  if (method === "eth_getBalance") { assert.equal(params[0], owner); assert.equal(params[1], "0x317"); return "0xde0b6b3a7640000"; }
  if (method === "eth_getCode") { assert.equal(params[0], WETH); assert.equal(params[1], "0x317"); return "0x6000"; }
  if (method === "eth_call") {
    const call = params[0]; assert.equal(params[1], "0x317");
    if (call.to.toLowerCase() === WETH.toLowerCase()) {
      if (call.data === "0x313ce567") return word(18n);
      assert.ok(call.data.startsWith("0x70a08231")); return word(1_000_000_000n);
    }
    assert.equal(call.to.toLowerCase(), "0x420000000000000000000000000000000000000f");
    return word(call.data.startsWith("0x9f0bb8a9") ? 3n : 5n);
  }
  if (method === "eth_getTransactionCount") return "0x7";
  if (method === "eth_estimateGas") { assert.equal(params[0].to, WETH); return "0xfde8"; }
  if (method === "eth_maxPriorityFeePerGas") return "0x3b9aca00";
  throw new Error(`unexpected RPC ${method}`);
}

test("installed APN CLI prepares and reopens synthetic Base WETH within eight physical HTTPS POSTs", { timeout: 240000 }, async t => {
  const sandbox = await mkdtemp(join(await realpath(tmpdir()), "apn-base-weth-installed-"));
  t.after(async () => rm(sandbox, { recursive: true, force: true }));
  const packed = await command("npm", ["pack", "--ignore-scripts", "--json", "--pack-destination", sandbox], source);
  assert.equal(packed.code, 0, packed.stderr);
  const archive = join(sandbox, JSON.parse(packed.stdout)[0].filename);
  const archiveHash = digest(await readFile(archive));
  const installed = await command("npm", ["install", "--ignore-scripts", "--offline", "--no-audit", "--no-fund", "--prefix", sandbox, archive], sandbox);
  assert.equal(installed.code, 0, installed.stderr);
  assert.equal(digest(await readFile(archive)), archiveHash);
  const packageRoot = join(sandbox, "node_modules", "@nuanu-ai", "apn");
  assert.equal(JSON.parse(await readFile(join(packageRoot, "package.json"), "utf8")).name, "@nuanu-ai/apn");
  const moduleAt = name => import(pathToFileURL(join(packageRoot, "dist", name)).href);
  const { runCli } = await moduleAt("cli.js");
  const { AllowlistPolicyStore, allowlistDecisionFingerprint, allowlistProfileHash } = await moduleAt("allowlist-policy.js");
  const { StateStore } = await moduleAt("state.js");
  const stateRoot = join(sandbox, "state"), profile = "installed-base-weth";
  const wrappingSecret = { load: async () => Buffer.alloc(32, 73), create: async () => Buffer.alloc(32, 73) };
  const clock = { now: () => NOW };
  const wallet = await runCli(["wallet", "ensure", "--profile", profile], {}, { stateRoot, wrappingSecret, clock });
  assert.equal(wallet.ok, true, JSON.stringify(wallet.error));
  const owner = wallet.data.address;
  const policy = new AllowlistPolicyStore(stateRoot);
  const staged = await policy.stage({ profile, now: NOW, policy: {
    schemaVersion: "apn.allowlist-policy-file.v1", overlayVersion: "installed.base-weth.1",
    accounts: { evm: owner }, effectiveAt: "2026-09-27T00:00:00.000Z", expiresAt: "2026-09-29T00:00:00.000Z",
    admissions: [{ chain: "eip155:8453", kind: "token", identifier: WETH, rail: "direct",
      maximumPerTransferAtomic: "100000000", dailyLimitAtomic: "200000000" }] } });
  const fingerprint = allowlistDecisionFingerprint({ action: "activate", profileHash: allowlistProfileHash(profile),
    revision: staged.revision, stagedRecordDigest: staged.recordDigest, policyDigest: staged.registry.policyDigest, headEntryDigest: null });
  await policy.appendDecision(profile, null, { status: "active", revision: staged.revision,
    stagedRecordDigest: staged.recordDigest, policyDigest: staged.registry.policyDigest, registry: staged.registry,
    approvalFingerprint: fingerprint, decidedAt: NOW.toISOString() });

  const posts = [];
  t.mock.method(https, "request", (_endpoint, _options, receive) => {
    const request = new EventEmitter(); request.setTimeout = () => request;
    request.end = body => {
      const calls = JSON.parse(body);
      assert.ok(Array.isArray(calls), "Base WETH prepare must batch physical reads");
      posts.push(calls.map(call => call.method));
      const raw = JSON.stringify(calls.map(call => ({ jsonrpc: "2.0", id: call.id,
        result: rpcAnswer(call.method, call.params, owner) })).reverse());
      queueMicrotask(() => {
        const response = new EventEmitter(); response.statusCode = 200;
        response.headers = { "content-length": String(Buffer.byteLength(raw)) };
        response.resume = () => response.emit("end"); receive(response);
        response.emit("data", Buffer.from(raw)); response.emit("end");
      });
      return request;
    };
    return request;
  });
  syncBuiltinESMExports(); t.after(() => { t.mock.restoreAll(); syncBuiltinESMExports(); });
  const args = ["pay", "transfer", "prepare-asset", "--profile", profile, "--chain", "eip155:8453",
    "--asset", WETH, "--rpc-url", "https://8.8.8.8/base", "--to", RECIPIENT, "--amount", "0.0000000001",
    "--max-fee-wei", "1000000000000000", "--idempotency-key", "installed-base-weth-001"];
  const options = { stateRoot, wrappingSecret, clock };
  const overCapArgs = [...args];
  overCapArgs[overCapArgs.indexOf("--amount") + 1] = "0.000000000100000001";
  overCapArgs[overCapArgs.indexOf("--idempotency-key") + 1] = "installed-base-weth-over-cap";
  const overCap = await runCli(overCapArgs, {}, options);
  assert.equal(overCap.error?.details?.reason, "allowlist_per_transfer_cap_exceeded");
  assert.equal(posts.length, 0, "owner cap refuses before public reads");
  const prepared = await runCli(args, {}, options);
  assert.equal(prepared.ok, true, JSON.stringify(prepared.error));
  assert.equal(prepared.operation.state, "awaiting_approval");
  assert.equal(prepared.operation.chain, "eip155:8453");
  assert.equal(prepared.operation.token, WETH);
  assert.equal(prepared.operation.amount.atomic, "100000000");
  assert.equal(posts.length, 8);
  assert.deepEqual(posts[1], ["eth_getBalance", "eth_getCode", "eth_call", "eth_call"]);
  assert.equal(posts.flat().includes("eth_sendRawTransaction"), false);
  const journal = await new StateStore(stateRoot).findOperation(prepared.operation.operation_id);
  assert.equal(journal.state, "awaiting_approval");
  assert.equal(journal.evm.asset.address, WETH);
  assert.equal(journal.evm.asset.decimalsSource, "onchain");
  assert.equal(journal.transactionHash, undefined);
  assert.equal(journal.rawTransactionHash, undefined);
  const before = posts.length;
  const replay = await runCli(args, {}, options);
  assert.equal(replay.ok, true, JSON.stringify(replay.error));
  assert.equal(replay.operation.operation_id, prepared.operation.operation_id);
  assert.equal(posts.length, before, "idempotent prepare reopens the saved operation");
  const status = await runCli(["operation", "status", "--operation", prepared.operation.operation_id], {}, { stateRoot, clock });
  assert.equal(status.ok, true, JSON.stringify(status.error));
  assert.equal(status.operation.state, "awaiting_approval");
  assert.equal(posts.length, before, "status is local only");
});
