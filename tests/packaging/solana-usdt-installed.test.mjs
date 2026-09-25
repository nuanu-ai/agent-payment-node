import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import test from "node:test";
import { address, createKeyPairSignerFromPrivateKeyBytes } from "@solana/kit";
import { getMintEncoder, getTokenEncoder, TOKEN_PROGRAM_ADDRESS } from "@solana-program/token";
import { SYSTEM_PROGRAM_ADDRESS } from "@solana-program/system";

const source = resolve(import.meta.dirname, "../..");
const NOW = new Date("2026-09-25T00:00:00.000Z");
const PROFILE = "installed-solana-usdt-synthetic";
const RECIPIENT = "So11111111111111111111111111111111111111112";
const BLOCKHASH = "11111111111111111111111111111111";
const digest = bytes => createHash("sha256").update(bytes).digest("hex");

async function run(command, args, cwd) {
  return await new Promise((resolveRun, reject) => {
    const child = spawn(command, args, { cwd, env: { ...process.env, npm_config_ignore_scripts: "true" } });
    let stdout = "", stderr = "";
    child.stdout.on("data", chunk => { stdout += chunk; });
    child.stderr.on("data", chunk => { stderr += chunk; });
    child.on("error", reject);
    child.on("close", code => resolveRun({ code, stdout, stderr }));
  });
}

function account(owner, bytes, lamports) {
  return { owner, data: [Buffer.from(bytes).toString("base64"), "base64"], executable: false,
    lamports, rentEpoch: 0n, space: BigInt(bytes.length) };
}

test("packed APN CLI prepares pinned Solana USDT, refuses policy violations, and reopens without an effect", { timeout: 240000 }, async t => {
  const sandbox = await mkdtemp(join(await realpath(tmpdir()), "apn-solana-usdt-installed-"));
  t.after(async () => rm(sandbox, { recursive: true, force: true }));
  const packed = await run("npm", ["pack", "--ignore-scripts", "--json", "--pack-destination", sandbox], source);
  assert.equal(packed.code, 0, packed.stderr);
  const [{ filename }] = JSON.parse(packed.stdout);
  const archive = join(sandbox, filename), archiveHash = digest(await readFile(archive));
  const installed = await run("npm", ["install", "--ignore-scripts", "--offline", "--no-audit", "--no-fund", "--prefix", sandbox, archive], sandbox);
  assert.equal(installed.code, 0, installed.stderr);
  assert.equal(digest(await readFile(archive)), archiveHash);
  const packageRoot = join(sandbox, "node_modules", "@nuanu-ai", "apn");
  assert.equal(JSON.parse(await readFile(join(packageRoot, "package.json"), "utf8")).name, "@nuanu-ai/apn");
  const moduleAt = path => import(pathToFileURL(join(packageRoot, "dist", path)).href);
  const { runCli } = await moduleAt("cli.js");
  const { ChainAccountStore } = await moduleAt("chain-account-store.js");
  const { SolanaLocalAdapter } = await moduleAt("solana/local-adapter.js");
  const { associatedToken } = await moduleAt("solana/accounts.js");
  const { SOLANA_USDT, SOLANA_GENESIS } = await moduleAt("chain-policy.js");
  const { AllowlistPolicyStore, allowlistDecisionFingerprint, allowlistProfileHash } = await moduleAt("allowlist-policy.js");
  const { RailOperationRepository } = await moduleAt("rail-operation-repository.js");
  assert.equal(SOLANA_USDT, "Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB");

  const stateRoot = join(sandbox, "state");
  const wrapping = { load: async () => Buffer.alloc(32, 73), create: async () => Buffer.alloc(32, 73) };
  const storage = new ChainAccountStore(stateRoot, wrapping);
  const seed = Buffer.alloc(32, 47);
  const signer = await createKeyPairSignerFromPrivateKeyBytes(seed);
  const owner = await storage.ensureLocal({ profile: PROFILE, rail: "solana", create: async () => ({ seed, address: signer.address }) });
  const sourceAta = await associatedToken(owner.address, SOLANA_USDT);
  const destinationAta = await associatedToken(RECIPIENT, SOLANA_USDT);
  const mint = getMintEncoder().encode({ mintAuthority: null, supply: 1_000_000_000_000n,
    decimals: 6, isInitialized: true, freezeAuthority: null });
  const token = getTokenEncoder().encode({ mint: address(SOLANA_USDT), owner: address(owner.address),
    amount: 9_000_000n, delegate: null, state: 1, isNative: null, delegatedAmount: 0n, closeAuthority: null });
  const calls = [], effects = [];
  const rpc = {
    call: async (method, params) => {
      calls.push(method);
      if (["sendTransaction", "simulateTransaction"].includes(method)) effects.push(method);
      if (method === "getGenesisHash") return SOLANA_GENESIS;
      if (method === "getLatestBlockhash") return { context: { slot: 300n }, value: { blockhash: BLOCKHASH, lastValidBlockHeight: 200n } };
      if (method === "getMultipleAccounts") return { context: { slot: 300n }, value: params[0].map(key => {
        if (key === owner.address) return account(SYSTEM_PROGRAM_ADDRESS, Buffer.alloc(0), 5_000_000_000n);
        if (key === SOLANA_USDT) return account(TOKEN_PROGRAM_ADDRESS, mint, 2_039_280n);
        if (key === sourceAta) return account(TOKEN_PROGRAM_ADDRESS, token, 2_039_280n);
        if (key === destinationAta) return null;
        throw new Error(`unexpected Solana account ${key}`);
      }) };
      if (method === "getFeeForMessage") return { context: { slot: 300n }, value: 5_000n };
      if (method === "getMinimumBalanceForRentExemption") return 2_039_280n;
      throw new Error(`unexpected Solana method ${method}`);
    },
    batch: async reads => Promise.all(reads.map(read => rpc.call(read.method, read.params))),
  };
  const adapter = new SolanaLocalAdapter(storage, rpc, () => NOW);
  const options = { stateRoot, chainAccounts: storage, directRails: [adapter], wrappingSecret: wrapping,
    chainPolicyApproval: { approve: async () => {} }, clock: { now: () => NOW } };
  const cli = args => runCli(args, {}, options);
  const admit = await cli(["policy", "admit-solana", "--profile", PROFILE, "--asset", "usdt", "--max-per-transfer", "2",
    "--daily-limit", "3", "--max-fee-sol", "0.003"]);
  assert.equal(admit.ok, true, JSON.stringify(admit.error));
  const prepare = (amount, key) => cli(["pay", "transfer", "prepare-solana", "--profile", PROFILE, "--asset", "usdt",
    "--to", RECIPIENT, "--amount", amount, "--max-fee-sol", "0.003", "--idempotency-key", key]);
  let before = calls.length;
  const missingPolicy = await prepare("1", "installed-solana-usdt-missing-policy");
  assert.equal(missingPolicy.error?.details?.reason, "allowlist_policy_required");
  assert.equal(calls.length, before, "missing owner policy must refuse before RPC");

  const policyStore = new AllowlistPolicyStore(stateRoot);
  const chain = "solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d";
  const activate = async (revision, admissions) => {
    const previous = await policyStore.read(PROFILE);
    const staged = await policyStore.stage({ profile: PROFILE, now: NOW,
      ...(revision === 1 ? {} : { expectedRevision: revision - 1 }), policy: {
        schemaVersion: "apn.allowlist-policy-file.v1", overlayVersion: `installed-solana-usdt.${revision}`,
        accounts: { solana: owner.address }, effectiveAt: "2026-09-24T00:00:00.000Z",
        expiresAt: "2026-09-26T00:00:00.000Z", admissions } });
    const head = previous.entries.at(-1)?.entryDigest ?? null;
    const approvalFingerprint = allowlistDecisionFingerprint({ action: "activate", profileHash: allowlistProfileHash(PROFILE),
      revision: staged.revision, stagedRecordDigest: staged.recordDigest, policyDigest: staged.registry.policyDigest,
      headEntryDigest: head });
    await policyStore.appendDecision(PROFILE, head, { status: "active", revision: staged.revision,
      stagedRecordDigest: staged.recordDigest, policyDigest: staged.registry.policyDigest, registry: staged.registry,
      approvalFingerprint, decidedAt: NOW.toISOString() });
  };
  await activate(1, [{ chain, kind: "native", rail: "direct",
    maximumPerTransferAtomic: "1000000000", dailyLimitAtomic: "2000000000" }]);
  before = calls.length;
  const unadmitted = await prepare("1", "installed-solana-usdt-unadmitted");
  assert.equal(unadmitted.error?.details?.reason, "allowlist_direct_not_admitted");
  assert.equal(calls.length, before, "unadmitted USDT must refuse before RPC");
  await activate(2, [{ chain, kind: "token", identifier: SOLANA_USDT, rail: "direct",
    maximumPerTransferAtomic: "1500000", dailyLimitAtomic: "2000000" }]);
  before = calls.length;
  const overCap = await prepare("1.500001", "installed-solana-usdt-over-cap");
  assert.equal(overCap.error?.details?.reason, "allowlist_per_transfer_cap_exceeded");
  assert.equal(calls.length, before, "owner cap must refuse before RPC");
  const prepared = await prepare("1.25", "installed-solana-usdt-prepared");
  assert.equal(prepared.ok, true, JSON.stringify(prepared.error));
  const id = prepared.operation.operation_id;
  const record = await new RailOperationRepository(stateRoot).findOperation(id);
  assert.equal(record.state, "awaiting_approval");
  assert.equal(record.prepared.asset.identifier, SOLANA_USDT);
  assert.equal(record.prepared.sourceTokenAccount, sourceAta);
  assert.equal(record.prepared.destinationTokenAccount, destinationAta);
  assert.equal(record.prepared.amountAtomic, "1250000");
  assert.ok(record.prepared.unsignedPayload);
  assert.equal(record.signedEffect ?? null, null);
  assert.deepEqual(effects, []);

  const rpcBeforeRecovery = calls.length;
  const reopened = await runCli(["operation", "status", "--operation", id], {}, { stateRoot, clock: { now: () => NOW } });
  assert.equal(reopened.ok, true, JSON.stringify(reopened.error));
  assert.equal(reopened.operation.operation_id, id);
  assert.equal(reopened.operation.state, "awaiting_approval");
  assert.equal(calls.length, rpcBeforeRecovery, "reopened status must be local only");
  assert.deepEqual(effects, []);
});
