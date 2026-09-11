import assert from "node:assert/strict";
import { chmod, readFile, unlink, writeFile, symlink } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";
import { chainAsset, chainUsage, assertChainPolicy, sealChainPolicy } from "../../src/chain-policy.js";
import { ChainAccountStore } from "../../src/chain-account-store.js";
import { temporaryState } from "./helpers.js";
import { SOL_RECIPIENT, solanaFixture } from "./solana-helpers.js";

test("new mainnet assets are denied before RPC preparation until the exact asset receives human policy admission", async (t) => {
  const temporary = await temporaryState(); t.after(temporary.cleanup); const s = await solanaFixture(temporary.root, { admit: false });
  const before = s.rpc.calls.length;
  const result = await s.core.execute({ command: "transfer.prepare-solana", profile: s.account.profile, asset: "sol", recipient: SOL_RECIPIENT, amount: "0.000001", maximumFee: "0.003", idempotencyKey: "solana-default-deny-0001" });
  assert.equal(result.error?.code, "APN_WALLET_POLICY_REQUIRED"); assert.equal(s.rpc.calls.length, before);
  await s.core.execute({ command: "policy.admit-solana", profile: s.account.profile, asset: "usdc", maximumPerTransfer: "1", dailyLimit: "2", maximumFee: "0.003" });
  assert.equal((await s.core.execute({ command: "transfer.prepare-solana", profile: s.account.profile, asset: "sol", recipient: SOL_RECIPIENT, amount: "0.000001", maximumFee: "0.003", idempotencyKey: "solana-default-deny-0002" })).error?.code, "APN_WALLET_POLICY_REQUIRED");
  assert.equal(s.approval.calls.length, 0); assert.equal(s.rpc.submissions.length, 0);
});

test("principal and native fee caps stay separate and unknown reservations survive the next UTC day", async (t) => {
  const temporary = await temporaryState(); t.after(temporary.cleanup); const s = await solanaFixture(temporary.root);
  const id = await s.prepare("usdc"); const record = (await s.core.rails.records.findOperation(id))!;
  const policy = (await s.core.rails.policies.requiredPolicy(s.account, "usdc"));
  s.now.setUTCDate(s.now.getUTCDate() + 1);
  const usage = chainUsage(policy, [record], s.now);
  assert.deepEqual(usage, { principalAtomic: "1000000", nativeFeeAtomic: "2044280" });
  const { policyHash: _hash, ...body } = policy;
  const constrained = sealChainPolicy({ ...body, maximumPerTransferAtomic: "1500000", dailyLimitAtomic: "1500000" });
  assert.throws(() => assertChainPolicy(constrained, s.account, chainAsset("solana", "usdc"), "600000", "3000000", [record], s.now), { code: "APN_OPERATION_BLOCKED" });
  assert.throws(() => assertChainPolicy(policy, s.account, chainAsset("solana", "usdc"), "1", "3000001", [], s.now), { code: "APN_OPERATION_BLOCKED" });
  assert.throws(() => assertChainPolicy(policy, s.account, chainAsset("solana", "sol"), "1", "5000", [], s.now), { code: "APN_OPERATION_BLOCKED" });
});

test("confirmed principal and fee costs are charged on terminal UTC day, and confirmed revert charges only fee", async (t) => {
  const temporary = await temporaryState(); t.after(temporary.cleanup); const s = await solanaFixture(temporary.root);
  const id = await s.prepare("usdc"); s.rpc.finalized = false;
  await s.core.execute({ command: "transfer.approve", operationId: id });
  s.now.setUTCDate(s.now.getUTCDate() + 1); s.rpc.finalized = true;
  await s.core.execute({ command: "operation.resume", operationId: id });
  const record = (await s.core.rails.records.findOperation(id))!; const policy = await s.core.rails.policies.requiredPolicy(s.account, "usdc");
  assert.equal(record.state, "completed"); assert.deepEqual(chainUsage(policy, [record], s.now), { principalAtomic: "1000000", nativeFeeAtomic: "2044280" });
  assert.deepEqual(chainUsage(policy, [record], new Date("2026-09-08T11:00:00.000Z")), { principalAtomic: "0", nativeFeeAtomic: "0" });
  const next = await s.prepare("sol", "solana-revert-fee-0001"); s.rpc.failed = true;
  await s.core.execute({ command: "transfer.approve", operationId: next });
  const failed = (await s.core.rails.records.findOperation(next))!;
  const native = await s.core.rails.policies.requiredPolicy(s.account, "sol");
  assert.equal(failed.state, "failed_confirmed_revert"); assert.deepEqual(chainUsage(native, [failed], s.now), { principalAtomic: "0", nativeFeeAtomic: "5000" });
});

test("an unresolved operation prevents policy replacement and expiry before signing consumes no budget", async (t) => {
  const temporary = await temporaryState(); t.after(temporary.cleanup); const s = await solanaFixture(temporary.root);
  const id = await s.prepare("sol");
  const replaced = await s.core.execute({ command: "policy.admit-solana", profile: s.account.profile, asset: "sol", maximumPerTransfer: "1", dailyLimit: "2", maximumFee: "0.003" });
  assert.equal(replaced.error?.code, "APN_OPERATION_BLOCKED");
  s.now.setUTCMinutes(s.now.getUTCMinutes() + 2);
  await s.core.execute({ command: "transfer.approve", operationId: id });
  const record = (await s.core.rails.records.findOperation(id))!; assert.equal(record.state, "failed_before_effect");
  const policy = await s.core.rails.policies.requiredPolicy(s.account, "sol");
  assert.deepEqual(chainUsage(policy, [record], s.now), { principalAtomic: "0", nativeFeeAtomic: "0" });
  assert.equal(s.approval.calls.length, 0); assert.equal(s.rpc.submissions.length, 0);
});

test("chain seed is separate, idempotent and fails closed on missing wrapping secret, altered public identity and symlink", async (t) => {
  const temporary = await temporaryState(); t.after(temporary.cleanup); const s = await solanaFixture(temporary.root, { admit: false });
  const creates = s.wrapping.creates;
  const again = await s.core.execute({ command: "wallet.ensure-solana", profile: s.account.profile, provider: "local", acceptRisk: true });
  assert.equal(again.ok, true); assert.equal(s.wrapping.creates, creates);
  const secretStore = new ChainAccountStore(temporary.root, s.wrapping);
  s.wrapping.available = false;
  await assert.rejects(secretStore.withSeed(s.account, async () => null), { code: "APN_STATE_CORRUPT" });
  assert.deepEqual(await secretStore.account(s.account.profile, "solana"), s.account);
  s.wrapping.available = true;
  const path = join(temporary.root, "chain-accounts", "solana", `${s.account.profileHash}.json`);
  const original = await readFile(path, "utf8");
  await writeFile(path, JSON.stringify({ ...s.account, address: SOL_RECIPIENT }), { mode: 0o600 });
  await assert.rejects(secretStore.account(s.account.profile, "solana"), { code: "APN_STATE_CORRUPT" });
  await writeFile(path, original, { mode: 0o600 }); await chmod(path, 0o644);
  await assert.rejects(secretStore.account(s.account.profile, "solana"), { code: "APN_STATE_SECURITY" });
  await chmod(path, 0o600);
  const target = join(temporary.root, "synthetic-public-account.json"); await writeFile(target, original, { mode: 0o600 });
  await unlink(path); await symlink(target, path);
  await assert.rejects(secretStore.account(s.account.profile, "solana"), { code: "APN_STATE_SECURITY" });
});
