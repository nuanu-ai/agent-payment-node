import assert from "node:assert/strict";
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";
import { createKeyPairSignerFromPrivateKeyBytes, getBase64EncodedWireTransaction, getCompiledTransactionMessageDecoder, getSignatureFromTransaction, getTransactionDecoder, signTransaction } from "@solana/kit";
import { bindArgv, bindMcpInput } from "../../src/command-binder.js";
import { MCP_TOOLS } from "../../src/mcp-projection.js";
import { SolanaRpc, solanaAddress } from "../../src/solana/rpc.js";
import { SolanaAwalAdapter, awalAmount } from "../../src/solana/awal-adapter.js";
import { chainAsset, chainDecimal, sealChainPolicy } from "../../src/chain-policy.js";
import { canonicalJson, hashObject } from "../../src/canonical.js";
import { sealChainAccount } from "../../src/chain-account-store.js";
import { inspectSolana } from "../../src/solana/evidence.js";
import { solanaMessage } from "../../src/solana/message.js";
import { temporaryState } from "./helpers.js";
import { OperationService } from "../../src/operation-service.js";
import { transitionRail, type RailOperationRecord } from "../../src/rail-operation-model.js";
import { AssetUsageLedger } from "../../src/asset-usage-ledger.js";
import { DirectAllowlistGate } from "../../src/direct-allowlist-gate.js";
import { railAllowlistSubject } from "../../src/rail-direct-allowlist.js";
import { freezeRelayUnsignedOperation } from "../../src/relay-unsigned-operation.js";
import type { OperationAbandonApprovalPort, OperationAbandonIntent } from "../../src/operation-abandon-approval.js";
import { SOL_RECIPIENT, solanaFixture } from "./solana-helpers.js";

async function writeDurableSolanaClaim(root: string, s: Awaited<ReturnType<typeof solanaFixture>>,
  input: { readonly profile: string; readonly amount: string; readonly maximumFee: string; readonly idempotencyKey: string },
  options: { readonly account?: typeof s.account; readonly policyHash?: string;
    readonly allowlist?: Awaited<ReturnType<DirectAllowlistGate["admit"]>> } = {}) {
  const account = options.account ?? s.account;
  const asset = chainAsset("solana", "sol");
  const amountAtomic = chainDecimal(input.amount, asset.decimals);
  const maximumFeeAtomic = chainDecimal(input.maximumFee, 9);
  const state = s.core.context.state;
  const operationId = state.operationId(input.profile, input.idempotencyKey);
  const idempotencyHash = state.idempotencyHash(input.idempotencyKey);
  const policyHash = options.policyHash ?? (await s.core.rails.policies.requiredPolicy(account, "sol")).policyHash;
  const allowlist = options.allowlist ?? await new DirectAllowlistGate({ state: { root }, clock: { now: () => s.now } })
    .admit(railAllowlistSubject({ profile: input.profile, operationId, account, prepared: { asset, amountAtomic } }));
  const body = { schemaVersion: "apn.rail-prepare-claim.v1", profileHash: account.profileHash, operationId,
    idempotencyHash, inputHash: hashObject({ kind: "rail_transfer", profile: input.profile, rail: "solana", asset,
      recipient: SOL_RECIPIENT, amountAtomic, maximumFeeAtomic }),
    requestHash: hashObject({ kind: "rail_transfer", account, asset, recipient: SOL_RECIPIENT, amountAtomic, maximumFeeAtomic }),
    accountIdentityHash: account.identityHash, policyHash, allowlist };
  const directory = join(root, "rail-prepare-claims");
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const contents = `${canonicalJson({ ...body, integrityHash: hashObject(body) })}\n`;
  await writeFile(join(directory, `${idempotencyHash}.json`), contents, { mode: 0o600 });
  return { directory, idempotencyHash, operationId, contents, allowlist, policyHash };
}

async function writeDurableApprovalClaim(root: string, operation: RailOperationRecord) {
  const body = { schemaVersion: "apn.rail-approval-claim.v1", profileHash: operation.profileHash,
    operationId: operation.operationId, operationIntegrityHash: operation.integrityHash,
    fingerprint: operation.fingerprint, accountIdentityHash: operation.account.identityHash,
    policyHash: operation.policyHash, allowlist: operation.allowlist };
  const directory = join(root, "rail-approval-claims");
  await mkdir(directory, { recursive: true, mode: 0o700 });
  await writeFile(join(directory, `${operation.operationId}.json`), `${canonicalJson({ ...body, integrityHash: hashObject(body) })}\n`, { mode: 0o600 });
  return directory;
}

test("Solana CLI and MCP use the same explicit profile/asset/amount binding", () => {
  const input = { profile: "solana-test", asset: "usdc", to: SOL_RECIPIENT, amount: "1.25", max_fee_sol: "0.003", idempotency_key: "solana-parity-0001" };
  const tool = MCP_TOOLS.find((entry) => entry.name === "apn_pay_transfer_prepare_solana")!;
  const argv = ["pay", "transfer", "prepare-solana", ...Object.entries(input).flatMap(([key, value]) => [`--${key.replaceAll("_", "-")}`, value])];
  assert.deepEqual(bindArgv(argv), bindMcpInput(tool.command, input));
  for (const amount of ["0", "-1", "+1", "1e3", " 1", "01", "1.0", "0.0000001"]) assert.throws(() => bindMcpInput(tool.command, { ...input, amount }), { code: "APN_INVALID_INPUT" });
  for (const asset of ["USDC", "trx", "native", ""]) assert.throws(() => bindMcpInput(tool.command, { ...input, asset }), { code: "APN_INVALID_INPUT" });
  const { profile: _profile, ...withoutProfile } = input;
  assert.throws(() => bindMcpInput(tool.command, withoutProfile), { code: "APN_INVALID_INPUT" });
  assert.throws(() => solanaAddress("1".repeat(33)), { code: "APN_INVALID_INPUT" });
  assert.equal(chainDecimal("0.000000001", 9), "1");
});

test("local Solana public identity and unsigned prepare recover across restart without signing or sending", async (t) => {
  const temporary = await temporaryState(); t.after(temporary.cleanup);
  const first = await solanaFixture(temporary.root);
  const identity = await first.core.execute({ command: "wallet.capabilities-solana", profile: first.account.profile });
  assert.equal(identity.ok, true, identity.error?.message);
  assert.equal((identity.data as { account: { address: string; profile: string; provider: string } }).account.address, first.account.address);
  assert.equal((identity.data as { account: { profile: string } }).account.profile, first.account.profile);
  assert.equal((identity.data as { account: { provider: string } }).account.provider, "local");
  assert.equal(JSON.stringify(identity).includes(Buffer.alloc(32, 47).toString("hex")), false);

  const id = await first.prepare("sol", "solana-unsigned-recovery-0001");
  const prepared = await first.core.execute({ command: "operation.status", operationId: id });
  assert.equal((prepared.operation as { state: string }).state, "awaiting_approval");
  const restarted = await solanaFixture(temporary.root, { rpc: first.rpc, wrapping: first.wrapping, admit: false });
  const resumed = await restarted.core.execute({ command: "operation.resume", operationId: id });
  assert.equal(resumed.ok, true, resumed.error?.message);
  assert.deepEqual(resumed.operation, prepared.operation);
  assert.equal(restarted.approval.calls.length, 0);
  assert.equal(first.rpc.submissions.length, 0);
  assert.equal(await restarted.storage.effect(restarted.account, id, (await restarted.core.rails.records.findOperation(id))!.fingerprint), null);

  restarted.approval.refuse = true;
  const refused = await restarted.core.execute({ command: "transfer.approve", operationId: id });
  assert.equal(refused.ok, false);
  assert.equal((await restarted.core.rails.records.findOperation(id))!.state, "failed_before_effect");
  assert.equal(first.rpc.submissions.length, 0);
  assert.equal(first.rpc.simulateCalls, 0);
  assert.equal(await restarted.storage.effect(restarted.account, id, (await restarted.core.rails.records.findOperation(id))!.fingerprint), null);
});

test("parallel local SOL approve uses one prompt, binding, and signing transition", async (t) => {
  const temporary = await temporaryState(); t.after(temporary.cleanup); const s = await solanaFixture(temporary.root);
  const id = await s.prepare("sol", "solana-approval-parallel-0001");
  let enter!: () => void; const entered = new Promise<void>((resolve) => { enter = resolve; });
  let release!: () => void; const blocked = new Promise<void>((resolve) => { release = resolve; });
  const approve = s.approval.approve.bind(s.approval);
  Object.assign(s.approval, { approve: async (...args: Parameters<typeof approve>) => { enter(); await blocked; return await approve(...args); } });
  const bind = s.adapter.bindSend!.bind(s.adapter);
  let binds = 0;
  Object.assign(s.adapter, { bindSend: async (...args: Parameters<typeof bind>) => { binds++; return await bind(...args); } });
  const first = s.core.rails.approve(id);
  await entered;
  const second = s.core.rails.approve(id);
  release();
  const [a, b] = await Promise.all([first, second]);
  assert.deepEqual(a, b);
  assert.equal(s.approval.calls.length, 1);
  assert.equal(binds, 1);
  assert.equal(s.rpc.submissions.length, 1);
  const operation = (await s.core.rails.records.findOperation(id))!;
  assert.equal(operation.transitions.filter((entry) => entry.state === "signing_started").length, 1);
  const lease = operation.allowlistLease!;
  assert.equal((await new AssetUsageLedger(temporary.root).load(lease.reservation, lease.reservation.reservationId))?.state, "finalized");
  assert.deepEqual(await readdir(join(temporary.root, "rail-approval-claims")), []);
});

test("local SOL approval leaves money-operation locks available during paced send binding", async (t) => {
  const temporary = await temporaryState(); t.after(temporary.cleanup); const s = await solanaFixture(temporary.root);
  const id = await s.prepare("sol", "solana-approval-wait-0001");
  s.rpc.simulateTransportLosses = 1;
  let enter!: () => void; const entered = new Promise<void>((resolve) => { enter = resolve; });
  let release!: () => void; const blocked = new Promise<void>((resolve) => { release = resolve; });
  const wait = s.wait.wait.bind(s.wait);
  Object.assign(s.wait, { wait: async (milliseconds: number) => { enter(); await blocked; return await wait(milliseconds); } });
  const approving = s.core.rails.approve(id);
  await entered;
  try {
    await Promise.race([
      s.core.context.state.withLocks([`profile:${s.account.profileHash}`, `operation:${id}`], async () => true),
      new Promise<never>((_resolve, reject) => setTimeout(() => reject(new Error("approval held money-operation locks during paced wait")), 2000)),
    ]);
  } finally { release(); }
  await approving;
  assert.equal(s.rpc.submissions.length, 1);
});

test("local SOL approval discards policy drift during the owner prompt before signing", async (t) => {
  const temporary = await temporaryState(); t.after(temporary.cleanup); const s = await solanaFixture(temporary.root);
  const id = await s.prepare("sol", "solana-approval-policy-drift-0001");
  const policy = await s.core.rails.policies.requiredPolicy(s.account, "sol");
  let enter!: () => void; const entered = new Promise<void>((resolve) => { enter = resolve; });
  let release!: () => void; const blocked = new Promise<void>((resolve) => { release = resolve; });
  const approve = s.approval.approve.bind(s.approval);
  Object.assign(s.approval, { approve: async (...args: Parameters<typeof approve>) => { enter(); await blocked; return await approve(...args); } });
  const approving = s.core.rails.approve(id);
  await entered;
  const { policyHash: _old, ...body } = policy;
  await s.core.context.state.withLocks([`profile:${s.account.profileHash}`], async () => {
    await s.core.rails.policies.policies.write(sealChainPolicy({ ...body, dailyLimitAtomic: "4000000000" }));
  });
  release();
  await assert.rejects(approving, { code: "APN_PROFILE_DRIFT" });
  assert.equal(s.rpc.submissions.length, 0);
  assert.equal((await s.core.rails.records.findOperation(id))?.state, "failed_before_effect");
  assert.equal(await s.storage.effect(s.account, id, (await s.core.rails.records.findOperation(id))!.fingerprint), null);
});

test("local SOL approval rejects a send binding after policy changes during RPC", async (t) => {
  const temporary = await temporaryState(); t.after(temporary.cleanup); const s = await solanaFixture(temporary.root);
  const id = await s.prepare("sol", "solana-approval-bind-policy-drift-0001");
  const policy = await s.core.rails.policies.requiredPolicy(s.account, "sol");
  let enter!: () => void; const entered = new Promise<void>((resolve) => { enter = resolve; });
  let release!: () => void; const blocked = new Promise<void>((resolve) => { release = resolve; });
  const bind = s.adapter.bindSend!.bind(s.adapter);
  Object.assign(s.adapter, { bindSend: async (...args: Parameters<typeof bind>) => {
    const result = await bind(...args); enter(); await blocked; return result;
  } });
  const approving = s.core.rails.approve(id);
  await entered;
  const { policyHash: _old, ...body } = policy;
  await s.core.context.state.withLocks([`profile:${s.account.profileHash}`], async () => {
    await s.core.rails.policies.policies.write(sealChainPolicy({ ...body, dailyLimitAtomic: "4000000000" }));
  });
  release();
  await assert.rejects(approving, { code: "APN_PROFILE_DRIFT" });
  assert.equal(s.rpc.submissions.length, 0);
  assert.equal((await s.core.rails.records.findOperation(id))?.state, "awaiting_approval");
  assert.equal(await s.storage.effect(s.account, id, (await s.core.rails.records.findOperation(id))!.fingerprint), null);
  assert.deepEqual(await readdir(join(temporary.root, "rail-approval-claims")), []);
});

test("local SOL approval discards account drift during the owner prompt before signing", async (t) => {
  const temporary = await temporaryState(); t.after(temporary.cleanup); const s = await solanaFixture(temporary.root);
  const id = await s.prepare("sol", "solana-approval-account-drift-0001");
  let enter!: () => void; const entered = new Promise<void>((resolve) => { enter = resolve; });
  let release!: () => void; const blocked = new Promise<void>((resolve) => { release = resolve; });
  const approve = s.approval.approve.bind(s.approval);
  Object.assign(s.approval, { approve: async (...args: Parameters<typeof approve>) => { enter(); await blocked; return await approve(...args); } });
  const approving = s.core.rails.approve(id);
  await entered;
  const accountPath = join(temporary.root, "chain-accounts", "solana", `${s.account.profileHash}.json`);
  const { identityHash: _old, ...accountBody } = s.account;
  const changed = sealChainAccount({ ...accountBody, createdAt: new Date(Date.parse(s.account.createdAt) + 1000).toISOString() });
  await s.core.context.state.withLocks([`profile:${s.account.profileHash}`], async () => {
    await writeFile(accountPath, `${canonicalJson(changed)}\n`, { mode: 0o600 });
  });
  release();
  await assert.rejects(approving, { code: "APN_STATE_CORRUPT" });
  assert.equal(s.rpc.submissions.length, 0);
  assert.equal((await s.core.rails.records.findOperation(id))?.state, "failed_before_effect");
  await s.core.context.state.withLocks([`profile:${s.account.profileHash}`], async () => {
    await writeFile(accountPath, `${canonicalJson(s.account)}\n`, { mode: 0o600 });
  });
  assert.equal(await s.storage.effect(s.account, id, (await s.core.rails.records.findOperation(id))!.fingerprint), null);
});

test("local SOL approval retry reuses a matching durable claim after restart", async (t) => {
  const temporary = await temporaryState(); t.after(temporary.cleanup); const s = await solanaFixture(temporary.root);
  const id = await s.prepare("sol", "solana-approval-crash-0001");
  const operation = (await s.core.rails.records.findOperation(id))!;
  const directory = await writeDurableApprovalClaim(temporary.root, operation);
  const restarted = await solanaFixture(temporary.root, { rpc: s.rpc, wrapping: s.wrapping, admit: false });
  const approved = await restarted.core.rails.approve(id) as { state: string };
  assert.equal(approved.state, "completed");
  assert.equal(restarted.approval.calls.length, 1);
  assert.equal(s.rpc.submissions.length, 1);
  assert.deepEqual(await readdir(directory), []);
});

test("duplicate local SOL prepare shares one claim and leaves money-operation locks free during RPC", async (t) => {
  const temporary = await temporaryState(); t.after(temporary.cleanup); const s = await solanaFixture(temporary.root);
  const input = { profile: s.account.profile, rail: "solana", asset: "sol", recipient: SOL_RECIPIENT,
    amount: "0.000001", maximumFee: "0.003", idempotencyKey: "solana-claim-race-0001" } as const;
  const operationId = s.core.context.state.operationId(input.profile, input.idempotencyKey);
  const idempotencyHash = s.core.context.state.idempotencyHash(input.idempotencyKey);
  let release!: () => void;
  const blocked = new Promise<void>((resolve) => { release = resolve; });
  let entered!: () => void;
  const started = new Promise<void>((resolve) => { entered = resolve; });
  const prepare = s.adapter.prepare.bind(s.adapter);
  let calls = 0;
  Object.assign(s.adapter, { prepare: async (...args: Parameters<typeof prepare>) => {
    calls++; entered(); await blocked; return await prepare(...args);
  } });
  const first = s.core.rails.prepare(input);
  await started;
  assert.deepEqual(await readdir(join(temporary.root, "rail-prepare-claims")), [`${idempotencyHash}.json`]);
  await Promise.race([
    s.core.context.state.withLocks([`profile:${s.account.profileHash}`, `operation:${operationId}`,
      `operation:idempotency:${idempotencyHash}`], async () => true),
    new Promise<never>((_resolve, reject) => setTimeout(() => reject(new Error("prepare held money-operation locks during RPC")), 2000)),
  ]);
  const second = s.core.rails.prepare(input);
  release();
  const [a, b] = await Promise.all([first, second]);
  assert.deepEqual(a, b);
  assert.equal(calls, 1);
  assert.equal((await s.core.rails.records.findOperation(operationId))?.state, "awaiting_approval");
  assert.deepEqual(await readdir(join(temporary.root, "rail-prepare-claims")), []);
  assert.equal(s.rpc.submissions.length, 0);
});

test("local SOL prepare discards an RPC result after policy drift and cleans the claim for retry", async (t) => {
  const temporary = await temporaryState(); t.after(temporary.cleanup); const s = await solanaFixture(temporary.root);
  const input = { profile: s.account.profile, rail: "solana", asset: "sol", recipient: SOL_RECIPIENT,
    amount: "0.000001", maximumFee: "0.003", idempotencyKey: "solana-claim-drift-0001" } as const;
  const policy = await s.core.rails.policies.requiredPolicy(s.account, "sol");
  let release!: () => void;
  const blocked = new Promise<void>((resolve) => { release = resolve; });
  let entered!: () => void;
  const started = new Promise<void>((resolve) => { entered = resolve; });
  const prepare = s.adapter.prepare.bind(s.adapter);
  Object.assign(s.adapter, { prepare: async (...args: Parameters<typeof prepare>) => {
    entered(); await blocked; return await prepare(...args);
  } });
  const first = s.core.rails.prepare(input);
  await started;
  const { policyHash: _old, ...body } = policy;
  await s.core.context.state.withLocks([`profile:${s.account.profileHash}`], async () => {
    await s.core.rails.policies.policies.write(sealChainPolicy({ ...body, dailyLimitAtomic: "4000000000" }));
  });
  release();
  await assert.rejects(first, { code: "APN_PROFILE_DRIFT" });
  assert.equal(await s.core.rails.records.findOperation(s.core.context.state.operationId(input.profile, input.idempotencyKey)), null);
  assert.deepEqual(await readdir(join(temporary.root, "rail-prepare-claims")), []);
  await s.core.context.state.withLocks([`profile:${s.account.profileHash}`], async () => { await s.core.rails.policies.policies.write(policy); });
  assert.equal((await s.core.rails.prepare(input) as { state: string }).state, "awaiting_approval");
});

test("local SOL prepare refuses a changed account during RPC without committing stale bytes", async (t) => {
  const temporary = await temporaryState(); t.after(temporary.cleanup); const s = await solanaFixture(temporary.root);
  const input = { profile: s.account.profile, rail: "solana", asset: "sol", recipient: SOL_RECIPIENT,
    amount: "0.000001", maximumFee: "0.003", idempotencyKey: "solana-claim-account-drift-0001" } as const;
  let release!: () => void;
  const blocked = new Promise<void>((resolve) => { release = resolve; });
  let entered!: () => void;
  const started = new Promise<void>((resolve) => { entered = resolve; });
  const prepare = s.adapter.prepare.bind(s.adapter);
  Object.assign(s.adapter, { prepare: async (...args: Parameters<typeof prepare>) => {
    entered(); await blocked; return await prepare(...args);
  } });
  const first = s.core.rails.prepare(input);
  await started;
  const accountPath = join(temporary.root, "chain-accounts", "solana", `${s.account.profileHash}.json`);
  const { identityHash: _old, ...accountBody } = s.account;
  const changed = sealChainAccount({ ...accountBody, createdAt: new Date(Date.parse(s.account.createdAt) + 1000).toISOString() });
  await s.core.context.state.withLocks([`profile:${s.account.profileHash}`], async () => {
    await writeFile(accountPath, `${canonicalJson(changed)}\n`, { mode: 0o600 });
  });
  release();
  await assert.rejects(first);
  assert.equal(await s.core.rails.records.findOperation(s.core.context.state.operationId(input.profile, input.idempotencyKey)), null);
  assert.deepEqual(await readdir(join(temporary.root, "rail-prepare-claims")), []);
  await s.core.context.state.withLocks([`profile:${s.account.profileHash}`], async () => {
    await writeFile(accountPath, `${canonicalJson(s.account)}\n`, { mode: 0o600 });
  });
  assert.equal((await s.core.rails.prepare(input) as { state: string }).state, "awaiting_approval");
});

test("local SOL retry recovers a durable claim left by an interrupted prepare", async (t) => {
  const temporary = await temporaryState(); t.after(temporary.cleanup); const s = await solanaFixture(temporary.root);
  const input = { profile: s.account.profile, rail: "solana", asset: "sol", recipient: SOL_RECIPIENT,
    amount: "0.000001", maximumFee: "0.003", idempotencyKey: "solana-claim-crash-0001" } as const;
  const { directory, idempotencyHash, operationId } = await writeDurableSolanaClaim(temporary.root, s, input);
  const restarted = await solanaFixture(temporary.root, { rpc: s.rpc, wrapping: s.wrapping, admit: false });
  await assert.rejects(restarted.core.rails.prepare({ ...input, amount: "0.000002" }), { code: "APN_IDEMPOTENCY_CONFLICT" });
  assert.deepEqual(await readdir(directory), [`${idempotencyHash}.json`]);
  const result = await restarted.core.rails.prepare(input) as { state: string; operation_id: string };
  assert.equal(result.state, "awaiting_approval");
  assert.equal(result.operation_id, operationId);
  assert.deepEqual(await readdir(directory), []);
  assert.equal(s.rpc.submissions.length, 0);
});

test("same-key replay preserves a different profile's durable Solana claim", async (t) => {
  const temporary = await temporaryState(); t.after(temporary.cleanup); const s = await solanaFixture(temporary.root);
  const input = { profile: s.account.profile, rail: "solana", asset: "sol", recipient: SOL_RECIPIENT,
    amount: "0.000001", maximumFee: "0.003", idempotencyKey: "solana-claim-other-profile-0001" } as const;
  const prepared = await s.core.rails.prepare(input);
  const other = await s.storage.ensureLocal({ profile: "solana-other", rail: "solana", create: async () => {
    const seed = Buffer.alloc(32, 48);
    const signer = await createKeyPairSignerFromPrivateKeyBytes(seed);
    return { seed, address: signer.address };
  } });
  const stored = (await s.core.rails.records.findOperation(s.core.context.state.operationId(input.profile, input.idempotencyKey)))!;
  const claim = await writeDurableSolanaClaim(temporary.root, s, { ...input, profile: other.profile },
    { account: other, policyHash: stored.policyHash, allowlist: stored.allowlist! });
  assert.deepEqual(await s.core.rails.prepare(input), prepared);
  assert.equal(await readFile(join(claim.directory, `${claim.idempotencyHash}.json`), "utf8"), claim.contents);
  assert.equal(s.rpc.submissions.length, 0);
});

test("crashed Solana claim is removed when another operation kind durably takes the key", async (t) => {
  const temporary = await temporaryState(); t.after(temporary.cleanup); const s = await solanaFixture(temporary.root);
  const input = { profile: s.account.profile, rail: "solana", asset: "sol", recipient: SOL_RECIPIENT,
    amount: "0.000001", maximumFee: "0.003", idempotencyKey: "solana-claim-superseded-0001" } as const;
  const claim = await writeDurableSolanaClaim(temporary.root, s, input);
  const relay = freezeRelayUnsignedOperation({ schemaVersion: "apn.relay-unsigned-operation.v1", kind: "relay_unsigned",
    state: "prepared", terminal: false, profileHash: s.account.profileHash, operationId: claim.operationId,
    idempotencyHash: claim.idempotencyHash, requestHash: "1".repeat(64), sourceChainId: 1, destinationChainId: 56,
    sourceAccount: "0x0B4Dd0C3dA001Fa146EEd3f80B01860BEF6B8a14", recipient: "0xf41170df51aab52aaa04fbc3ff325cf051644aca",
    quoteDigest: "2".repeat(64), amountAtomic: "1000000000000000", minOutputAtomic: "100000000000000",
    createdAt: s.now.toISOString(), deadline: new Date(s.now.getTime() + 300_000).toISOString() });
  await new OperationService(s.core.context.state).persistRelayUnsigned(relay);
  const restarted = await solanaFixture(temporary.root, { rpc: s.rpc, wrapping: s.wrapping, admit: false });
  const before = s.rpc.calls.length;
  await assert.rejects(restarted.core.rails.prepare(input), { code: "APN_IDEMPOTENCY_CONFLICT" });
  assert.deepEqual(await readdir(claim.directory), []);
  assert.equal((await new OperationService(restarted.core.context.state).required(relay.operationId)).kind, "relay_unsigned");
  assert.equal(s.rpc.calls.length, before);
  assert.equal(s.rpc.submissions.length, 0);
});

for (const asset of ["sol", "usdc"] as const) test(`local ${asset} integrates encrypted custody, human policy, exact wire effect and finalized receipt`, async (t) => {
  const temporary = await temporaryState(); t.after(temporary.cleanup);
  const setup = await solanaFixture(temporary.root);
  const id = await setup.prepare(asset);
  assert.equal(setup.approval.calls.length, 0); assert.equal(setup.rpc.submissions.length, 0);
  const approved = await setup.core.execute({ command: "transfer.approve", operationId: id });
  assert.equal(approved.ok, true, approved.error?.message);
  assert.equal((approved.operation as { state: string }).state, "completed");
  assert.equal(setup.approval.calls.length, 1); assert.equal(setup.rpc.submissions.length, 1);
  const wire = getTransactionDecoder().decode(Buffer.from(setup.rpc.submissions[0]!, "base64"));
  const message = getCompiledTransactionMessageDecoder().decode(wire.messageBytes);
  assert.equal(message.version, 0); assert.equal(message.instructions.length, asset === "sol" ? 1 : 2);
  assert.equal(message.staticAccounts[0], setup.account.address);
  const receipt = await setup.core.execute({ command: "receipt.get", operationId: id });
  assert.equal(receipt.ok, true); assert.equal((receipt.receipt as { schema_version: string }).schema_version, "apn.rail-receipt.v1");
  const proof = (receipt.receipt as { evidence: { actualNetworkFeeAtomic: string; actualRecipientRentAtomic: string } }).evidence;
  assert.equal(proof.actualNetworkFeeAtomic, "5000"); assert.equal(proof.actualRecipientRentAtomic, asset === "sol" ? "0" : "2039280");
  const restart = await solanaFixture(temporary.root, { rpc: setup.rpc, wrapping: setup.wrapping, admit: false });
  assert.deepEqual(await restart.core.execute({ command: "operation.resume", operationId: id }).then((value) => value.operation), approved.operation);
  assert.equal(restart.approval.calls.length, 0); assert.equal(setup.rpc.submissions.length, 1);
  const publicText = JSON.stringify([approved, receipt]);
  assert.equal(publicText.includes(setup.rpc.submissions[0]!), false);
  assert.equal(publicText.includes("unsignedPayload"), false);
  for (const root of ["chain-wallets/solana", `rail-operations/${setup.account.profileHash}`, `rail-receipts/${setup.account.profileHash}`]) {
    for (const file of await readdir(join(temporary.root, root))) {
      const contents = await readFile(join(temporary.root, root, file), "utf8");
      assert.equal(contents.includes(setup.rpc.submissions[0]!), false);
      assert.equal(contents.includes(Buffer.alloc(32, 47).toString("hex")), false);
    }
  }
});

test("wrong chain, mint, ATA owner, funding and fee bounds stop before approval or any signed effect", async (t) => {
  const temporary = await temporaryState(); t.after(temporary.cleanup); const s = await solanaFixture(temporary.root);
  const request = { command: "transfer.prepare-solana", profile: s.account.profile, asset: "usdc", recipient: SOL_RECIPIENT, amount: "1", maximumFee: "0.003", idempotencyKey: "solana-negative-0001" } as const;
  const check = async (code: string) => { const result = await s.core.execute(request); assert.equal(result.error?.code, code); assert.equal(s.rpc.submissions.length, 0); assert.equal(s.approval.calls.length, 0); };
  s.rpc.genesis = "wrong"; await check("APN_CHAIN_MISMATCH"); s.rpc.genesis = (await import("../../src/chain-policy.js")).SOLANA_GENESIS;
  s.rpc.corruptMint = true; await check("APN_RPC_PROTOCOL"); s.rpc.corruptMint = false;
  s.rpc.corruptTokenOwner = true; await check("APN_RPC_PROTOCOL"); s.rpc.corruptTokenOwner = false;
  s.rpc.native = 1n; await check("APN_INSUFFICIENT_GAS"); s.rpc.native = 5_000_000_000n;
  s.rpc.token = 1n; await check("APN_INSUFFICIENT_ASSET"); s.rpc.token = 9_000_000n;
  s.rpc.fee = 9_000_000n; await check("APN_FEE_BUDGET_EXCEEDED");
});

for (const asset of ["sol", "usdc"] as const) test(`${asset} completed RPC status without exact recipient effect stays unresolved`, async (t) => {
  const temporary = await temporaryState(); t.after(temporary.cleanup); const s = await solanaFixture(temporary.root);
  const id = await s.prepare(asset); s.rpc.corruptEffect = true;
  const result = await s.core.execute({ command: "transfer.approve", operationId: id });
  assert.equal(result.ok, true); assert.equal((result.operation as { state: string }).state, "submitted_pending");
  await s.core.execute({ command: "operation.resume", operationId: id }); assert.equal(s.rpc.submissions.length, 1);
  s.rpc.corruptEffect = false;
  const recovered = await s.core.execute({ command: "operation.resume", operationId: id });
  assert.equal((recovered.operation as { state: string }).state, "completed"); assert.equal(s.rpc.submissions.length, 1);
});

test("local SOL resume releases locks during saved-effect observation and discards a competing journal update", async (t) => {
  const temporary = await temporaryState(); t.after(temporary.cleanup); const s = await solanaFixture(temporary.root);
  const id = await s.prepare(); s.rpc.finalized = false;
  const pending = await s.core.execute({ command: "transfer.approve", operationId: id });
  assert.equal((pending.operation as { state: string }).state, "submitted_pending");
  const frozen = (await s.core.rails.records.findOperation(id))!;
  s.rpc.finalized = true;
  let releaseInspect!: () => void;
  const inspectionBlocked = new Promise<void>((resolve) => { releaseInspect = resolve; });
  let markInspectEntered!: () => void;
  const inspectEntered = new Promise<void>((resolve) => { markInspectEntered = resolve; });
  const inspect = s.adapter.inspect.bind(s.adapter);
  let inspectCalls = 0;
  Object.assign(s.adapter, { inspect: async (...args: Parameters<typeof inspect>) => {
    inspectCalls++;
    assert.equal(args[2], frozen.transactionId);
    assert.equal(args[3], frozen.rawPayloadHash);
    assert.deepEqual(args[4], frozen.send ?? null);
    markInspectEntered(); await inspectionBlocked;
    return await inspect(...args);
  } });
  const resumed = s.core.rails.resume(id);
  await inspectEntered;
  // This writer needs the same profile and operation locks. It can advance while RPC waits.
  await Promise.race([
    s.core.context.state.withLocks([`profile:${frozen.profileHash}`, `operation:${id}`], async () => {
      const current = (await s.core.rails.records.findOperation(id))!;
      await s.core.rails.records.persist(transitionRail(current, { state: "unknown_finality", at: s.now.toISOString(),
        reason: "concurrent_observation_update", proofClass: "effect_outcome_unknown" }));
    }),
    new Promise<never>((_resolve, reject) => setTimeout(() => reject(new Error("resume held locks during inspection")), 2000)),
  ]);
  releaseInspect();
  const stale = await resumed as { state: string; reason: string };
  assert.equal(stale.state, "unknown_finality");
  assert.equal(stale.reason, "concurrent_observation_update");
  assert.equal((await s.core.rails.records.findOperation(id))!.evidence, null);
  const completed = await s.core.rails.resume(id) as { state: string };
  assert.equal(completed.state, "completed");
  const stored = (await s.core.rails.records.findOperation(id))!;
  assert.equal(stored.transitions.filter((entry) => entry.state === "completed").length, 1);
  const lease = stored.allowlistLease!.reservation;
  assert.equal((await new AssetUsageLedger(temporary.root).load(lease, lease.reservationId))?.state, "finalized");
  assert.equal(s.rpc.submissions.length, 1);
  assert.equal(inspectCalls, 2);
});

test("local SOL submitting timeout resumes observation without a second send", async (t) => {
  const temporary = await temporaryState(); t.after(temporary.cleanup); const s = await solanaFixture(temporary.root);
  const id = await s.prepare(); s.rpc.submissionTimeout = true;
  const persist = s.core.rails.records.persist.bind(s.core.rails.records);
  Object.assign(s.core.rails.records, { persist: async (record: Parameters<typeof persist>[0]) => {
    if (record.state === "unknown_finality" && record.reason === "submission_outcome_unknown") throw new Error("synthetic crash after send timeout");
    return await persist(record);
  } });
  await assert.rejects(s.core.rails.approve(id), /synthetic crash/);
  Object.assign(s.core.rails.records, { persist });
  assert.equal((await s.core.rails.records.findOperation(id))!.state, "submitting");
  assert.equal(s.rpc.submissions.length, 1);
  const resumed = await s.core.rails.resume(id) as { state: string; reason: string };
  assert.equal(resumed.state, "completed");
  const stored = (await s.core.rails.records.findOperation(id))!;
  assert.ok(stored.transitions.some((entry) => entry.state === "unknown_finality" && entry.reason === "interrupted_submission_observation_only"));
  assert.equal(s.rpc.submissions.length, 1);
  const lease = stored.allowlistLease!.reservation;
  assert.equal((await new AssetUsageLedger(temporary.root).load(lease, lease.reservationId))?.state, "finalized");
});

test("simultaneous local SOL observations finalize one journal transition and one usage lease", async (t) => {
  const temporary = await temporaryState(); t.after(temporary.cleanup); const s = await solanaFixture(temporary.root);
  const id = await s.prepare(); s.rpc.finalized = false;
  assert.equal((await s.core.rails.approve(id) as { state: string }).state, "submitted_pending");
  s.rpc.finalized = true;
  const inspect = s.adapter.inspect.bind(s.adapter);
  let release!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  let entered = 0;
  let bothEntered!: () => void;
  const started = new Promise<void>((resolve) => { bothEntered = resolve; });
  Object.assign(s.adapter, { inspect: async (...args: Parameters<typeof inspect>) => {
    if (++entered === 2) bothEntered();
    await gate;
    return await inspect(...args);
  } });
  const first = s.core.rails.resume(id);
  const second = s.core.rails.resume(id);
  await started; release();
  const results = await Promise.all([first, second]) as { state: string }[];
  assert.deepEqual(results.map((result) => result.state), ["completed", "completed"]);
  const stored = (await s.core.rails.records.findOperation(id))!;
  assert.equal(stored.transitions.filter((entry) => entry.state === "completed").length, 1);
  const lease = stored.allowlistLease!.reservation;
  assert.equal((await new AssetUsageLedger(temporary.root).load(lease, lease.reservationId))?.state, "finalized");
  assert.equal(s.rpc.submissions.length, 1);
});

test("finalized rollback records actual fee and no delivered principal or rent", async (t) => {
  const temporary = await temporaryState(); t.after(temporary.cleanup); const s = await solanaFixture(temporary.root);
  const id = await s.prepare(); s.rpc.failed = true;
  const result = await s.core.execute({ command: "transfer.approve", operationId: id });
  assert.equal(result.ok, true); assert.equal((result.operation as { state: string }).state, "failed_confirmed_revert");
  const record = (await s.core.rails.records.findOperation(id))!;
  assert.equal(record.evidence?.senderEffectVerified, false); assert.equal(record.evidence?.actualNetworkFeeAtomic, "5000");
});

test("pinned awal amount conversion preserves exact atomic inputs and production economics block before provider launch", async (t) => {
  assert.equal(awalAmount(chainAsset("solana", "usdc"), "1000001"), "1000001");
  assert.equal(awalAmount(chainAsset("solana", "usdc"), "1"), "0.000001");
  assert.equal(awalAmount(chainAsset("solana", "sol"), "1000000000"), "1");
  assert.throws(() => awalAmount(chainAsset("solana", "usdc"), "9007199254740993"), { code: "APN_PROVIDER_CAPABILITY_UNAVAILABLE" });
  const temporary = await temporaryState(); t.after(temporary.cleanup); const s = await solanaFixture(temporary.root);
  let launches = 0;
  const adapter = new SolanaAwalAdapter(s.storage, s.rpc, { run: async () => { launches++; throw new Error("must not launch"); } });
  await assert.rejects(adapter.prepare({ account: s.account, asset: chainAsset("solana", "sol"), recipient: SOL_RECIPIENT, amountAtomic: "1", maximumFeeAtomic: "5000", now: s.now }), { code: "APN_PROVIDER_CAPABILITY_UNAVAILABLE" });
  assert.equal(launches, 0);
});

test("provider finality binds signed instruction bytes to the exact prepared amount and parsed RPC evidence", async (t) => {
  const temporary = await temporaryState(); t.after(temporary.cleanup); const s = await solanaFixture(temporary.root);
  const id = await s.prepare();
  await s.core.execute({ command: "transfer.approve", operationId: id });
  const local = (await s.core.rails.records.findOperation(id))!;
  const { identityHash: _hash, ...accountBody } = s.account;
  const account = sealChainAccount({ ...accountBody, provider: "coinbase-awal", custody: "provider_managed" });
  const prepared = { ...local.prepared, unsignedPayload: null, economics: { ...local.prepared.economics, feeControl: "provider_guarantee" as const } };
  assert.equal((await inspectSolana(s.rpc, account, prepared, local.transactionId!, s.now)).status, "completed");
  // A valid signature over another amount must not inherit a fabricated parsed result.
  const signer = await createKeyPairSignerFromPrivateKeyBytes(Buffer.alloc(32, 47));
  const changed = await solanaMessage({ ...local.prepared, amountAtomic: "2000" });
  const transaction = await signTransaction([signer.keyPair], changed.transaction);
  s.rpc.submissions.push(getBase64EncodedWireTransaction(transaction));
  await assert.rejects(inspectSolana(s.rpc, account, prepared, getSignatureFromTransaction(transaction), s.now), { code: "APN_RPC_PROTOCOL" });
});

test("Solana HTTPS rejects wrong ids, malformed and oversized responses and credential URLs with bounded safe errors", async () => {
  let calls = 0;
  const fetcher = (async () => { calls++; return new Response(JSON.stringify({ jsonrpc: "2.0", id: "wrong", result: "secret_external_data" }), { headers: { "content-type": "application/json" } }); }) as typeof fetch;
  await assert.rejects(new SolanaRpc("https://user:secret@rpc.example", fetcher).call("getGenesisHash", []), { code: "APN_RPC_CONFIG" });
  assert.equal(calls, 0);
  await assert.rejects(new SolanaRpc("https://rpc.example", fetcher).call("getGenesisHash", []), (error: Error) => !error.message.includes("secret_external_data"));
  const oversized = (async () => new Response("x".repeat(2_097_153), { headers: { "content-type": "application/json" } })) as typeof fetch;
  await assert.rejects(new SolanaRpc("https://rpc.example", oversized).call("getGenesisHash", []), { code: "APN_RPC_PROTOCOL" });
});

class RailAbandonApproval implements OperationAbandonApprovalPort {
  readonly calls: OperationAbandonIntent[] = [];
  async approve(intent: OperationAbandonIntent): Promise<void> { this.calls.push(intent); }
}

test("Solana expired unlanded transfer is owner-abandoned only after its finalized validity window and never resent", async (t) => {
  const temporary = await temporaryState(); t.after(temporary.cleanup); const approval = new RailAbandonApproval();
  const s = await solanaFixture(temporary.root, { abandonApproval: approval }); const id = await s.prepare();
  s.rpc.submissionTimeout = true; const first = await s.core.execute({ command: "transfer.approve", operationId: id });
  assert.equal((first.operation as { state: string }).state, "unknown_finality"); assert.equal(s.rpc.submissions.length, 1);
  s.rpc.absentHistory = true; s.rpc.blockHeight = 200n;
  assert.equal((await s.core.execute({ command: "operation.abandon", operationId: id })).error?.code, "APN_OPERATION_BLOCKED");
  s.rpc.blockHeight = 201n; s.rpc.absentHistory = false;
  assert.equal((await s.core.execute({ command: "operation.abandon", operationId: id })).error?.code, "APN_OPERATION_BLOCKED");
  assert.equal(approval.calls.length, 0); s.rpc.absentHistory = true;
  const abandoned = await s.core.execute({ command: "operation.abandon", operationId: id });
  assert.equal(abandoned.ok, true, abandoned.error?.message); assert.equal((abandoned.operation as { state: string }).state, "abandoned_unknown");
  assert.equal(approval.calls.length, 1); assert.equal(s.rpc.submissions.length, 1);
  await new OperationService(s.core.context.state).assertProfileAvailable(s.account.profileHash);
});
