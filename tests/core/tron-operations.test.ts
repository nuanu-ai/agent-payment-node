import assert from "node:assert/strict";
import { readFile, readdir, unlink } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";
import { Client, InMemoryTransport } from "@modelcontextprotocol/client";
import { createMcpServer } from "../../src/mcp-server.js";
import { ApnCore } from "../../src/core.js";
import { OperationService } from "../../src/operation-service.js";
import { chainUsage } from "../../src/chain-policy.js";
import { transitionRail } from "../../src/rail-operation-model.js";
import { temporaryState } from "./helpers.js";
import type { OperationAbandonApprovalPort, OperationAbandonIntent } from "../../src/operation-abandon-approval.js";
import { SOL_RECIPIENT } from "./solana-helpers.js";
import { TRON_RECIPIENT, tronFixture } from "./tron-helpers.js";
import { reserveRailLease } from "./direct-allowlist-helpers.js";

test("TRON assets are default-denied independently before RPC or signer access", async (t) => {
  const temporary = await temporaryState(); t.after(temporary.cleanup); const s = await tronFixture(temporary.root, { admit: false });
  const request = { command: "transfer.prepare-tron", profile: s.account.profile, asset: "trx", recipient: TRON_RECIPIENT, amount: "0.000001", maximumFee: "30", idempotencyKey: "tron-default-deny-0001" } as const;
  const before = s.rpc.calls.length; const loads = s.wrapping.loads;
  assert.equal((await s.core.execute(request)).error?.code, "APN_WALLET_POLICY_REQUIRED"); assert.equal(s.rpc.calls.length, before);
  assert.equal((await s.core.execute({ command: "policy.admit-tron", profile: s.account.profile, asset: "usdt", maximumPerTransfer: "1", dailyLimit: "2", maximumFee: "30" })).ok, true);
  const after = s.rpc.calls.length;
  assert.equal((await s.core.execute(request)).error?.code, "APN_WALLET_POLICY_REQUIRED"); assert.equal(s.rpc.calls.length, after); assert.equal(s.wrapping.loads, loads);
});

test("TRON sealing interruption recovers exactly one signed protobuf without another approval or signature", async (t) => {
  const temporary = await temporaryState(); t.after(temporary.cleanup); const s = await tronFixture(temporary.root); const id = await s.prepare("usdt");
  const original = s.adapter.sign.bind(s.adapter); let signs = 0;
  s.adapter.sign = async (binding) => { signs++; await original(binding); throw new Error("synthetic interruption after sealed effect"); };
  assert.equal((await s.core.execute({ command: "transfer.approve", operationId: id })).ok, false);
  assert.equal((await s.core.rails.records.findOperation(id))!.state, "signing_started"); assert.equal(s.rpc.submissions.length, 0);
  const restart = await tronFixture(temporary.root, { rpc: s.rpc, wrapping: s.wrapping, admit: false });
  const result = await restart.core.execute({ command: "operation.resume", operationId: id });
  assert.equal((result.operation as { state: string }).state, "completed"); assert.equal(signs, 1); assert.equal(restart.approval.calls.length, 0); assert.equal(s.rpc.submissions.length, 1);
});

test("TRON interrupted submission, expired TAPOS and absent history preserve the transaction and never resend", async (t) => {
  const temporary = await temporaryState(); t.after(temporary.cleanup); const s = await tronFixture(temporary.root); const id = await s.prepare("usdt");
  s.rpc.submissionTimeout = true; const first = await s.core.execute({ command: "transfer.approve", operationId: id });
  assert.equal((first.operation as { state: string }).state, "unknown_finality"); const transaction = s.rpc.submissions[0]; assert.ok(transaction);
  s.rpc.absentHistory = true; s.now.setUTCDate(s.now.getUTCDate() + 1); s.rpc.energyPrice = 900n;
  const policy = await s.core.rails.policies.requiredPolicy(s.account, "usdt"); const record = (await s.core.rails.records.findOperation(id))!;
  assert.deepEqual(chainUsage(policy, [record], s.now), { principalAtomic: "1000000", nativeFeeAtomic: record.prepared.resources!.totalFeeMaximumAtomic });
  for (let i = 0; i < 2; i++) {
    const result = await s.core.execute({ command: "operation.resume", operationId: id }); assert.equal((result.operation as { state: string }).state, "unknown_finality"); assert.deepEqual(s.rpc.submissions, [transaction]);
  }
  await assert.rejects(new OperationService(s.core.context.state).assertProfileAvailable(s.account.profileHash), { code: "APN_OPERATION_BLOCKED" });
  assert.equal((await s.core.execute({ command: "policy.admit-tron", profile: s.account.profile, asset: "usdt", maximumPerTransfer: "2", dailyLimit: "3", maximumFee: "30" })).error?.code, "APN_OPERATION_BLOCKED");
  s.rpc.energyPrice = 100n; s.rpc.absentHistory = false;
  const recovered = await s.core.execute({ command: "operation.resume", operationId: id }); assert.equal((recovered.operation as { state: string }).state, "completed"); assert.deepEqual(s.rpc.submissions, [transaction]);
});

for (const mutation of ["price", "maintenance", "reference", "solid-reference", "expiry", "last-slot", "permission", "funding"] as const) test(`TRON ${mutation} drift after foreground review fails before any sealed or broadcast effect`, async (t) => {
  const temporary = await temporaryState(); t.after(temporary.cleanup); const s = await tronFixture(temporary.root); const id = await s.prepare();
  s.approval.approve = async (input) => {
    s.approval.calls.push(input);
    if (mutation === "price") s.rpc.bandwidthPrice++;
    if (mutation === "maintenance") s.rpc.maintenance += 1000n;
    if (mutation === "reference") s.rpc.referenceMismatch = true;
    if (mutation === "solid-reference") s.rpc.solidReferenceMismatch = true;
    if (mutation === "expiry") s.now.setTime(s.now.getTime() + 121_000);
    if (mutation === "last-slot") s.now.setTime(s.now.getTime() + 119_000);
    if (mutation === "permission") s.rpc.badPermission = true;
    if (mutation === "funding") s.rpc.native = 0n;
  };
  const result = await s.core.execute({ command: "transfer.approve", operationId: id }); assert.equal(result.ok, false);
  const record = (await s.core.rails.records.findOperation(id))!; assert.equal(record.state, "failed_before_effect"); assert.equal(s.approval.calls.length, 1); assert.equal(s.rpc.submissions.length, 0);
  assert.equal(await s.storage.effect(s.account, id, record.fingerprint), null);
});

test("TRON durable submission boundary survives receipt-write interruption without transmitting on restart", async (t) => {
  const temporary = await temporaryState(); t.after(temporary.cleanup); const s = await tronFixture(temporary.root); const id = await s.prepare();
  const repair = s.core.rails.records.repairReceipt.bind(s.core.rails.records);
  s.core.rails.records.repairReceipt = async (operation) => { if (operation.state === "submitting") throw new Error("synthetic receipt write interruption"); await repair(operation); };
  assert.equal((await s.core.execute({ command: "transfer.approve", operationId: id })).ok, false);
  assert.equal((await s.core.rails.records.findOperation(id))!.state, "submitting"); assert.equal(s.rpc.submissions.length, 0);
  s.rpc.absentHistory = true; const restart = await tronFixture(temporary.root, { rpc: s.rpc, wrapping: s.wrapping, admit: false });
  const result = await restart.core.execute({ command: "operation.resume", operationId: id }); assert.equal((result.operation as { state: string }).state, "unknown_finality"); assert.equal(s.rpc.submissions.length, 0);
  assert.equal((await restart.core.execute({ command: "receipt.get", operationId: id })).ok, true);
});

test("TRON missing uncommitted effect ends safely, while a sealed expired transaction is retained without first submission", async (t) => {
  const temporary = await temporaryState(); t.after(temporary.cleanup); const s = await tronFixture(temporary.root); const id = await s.prepare();
  let record = (await s.core.rails.records.findOperation(id))!;
  record = transitionRail(record, { state: "signing_started", at: s.now.toISOString(), reason: "foreground_signing_started", proofClass: "durable_pre_effect",
    allowlistLease: await reserveRailLease(temporary.root, s.now, record) }); await s.core.rails.records.persist(record);
  assert.equal(((await s.core.execute({ command: "operation.resume", operationId: id })).operation as { state: string }).state, "failed_before_effect");
  const next = await s.prepare("trx", "tron-sealed-expiry-0002"); const nextRecord = (await s.core.rails.records.findOperation(next))!;
  const signing = transitionRail(nextRecord, { state: "signing_started", at: s.now.toISOString(), reason: "foreground_signing_started", proofClass: "durable_pre_effect",
    allowlistLease: await reserveRailLease(temporary.root, s.now, nextRecord) }); await s.core.rails.records.persist(signing);
  const effect = await s.adapter.sign({ account: signing.account, operationId: next, fingerprint: signing.fingerprint, prepared: signing.prepared, send: null });
  s.now.setTime(s.now.getTime() + 121_000);
  const result = await s.core.execute({ command: "operation.resume", operationId: next }); assert.equal((result.operation as { state: string }).state, "failed_before_effect"); assert.equal(s.rpc.submissions.length, 0);
  assert.deepEqual(await s.storage.effect(s.account, next, signing.fingerprint), effect);
});

test("TRON MCP preparation and status share CLI state, while approval and policy provide foreground-only handoffs", async (t) => {
  const temporary = await temporaryState(); t.after(temporary.cleanup); const s = await tronFixture(temporary.root);
  const server = createMcpServer({ stateRoot: temporary.root, chainAccounts: s.storage, directRails: [s.adapter], wrappingSecret: s.wrapping, clock: { now: () => s.now }, railApproval: s.approval });
  const client = new Client({ name: "synthetic-tron-acceptance", version: "1" }); const [a, b] = InMemoryTransport.createLinkedPair(); await server.connect(b); await client.connect(a); t.after(async () => { await client.close(); await server.close(); });
  const prepared = await client.callTool({ name: "apn_pay_transfer_prepare_tron", arguments: { profile: s.account.profile, asset: "usdt", to: TRON_RECIPIENT, amount: "1", max_fee_trx: "30", idempotency_key: "tron-mcp-0001" } });
  const first = prepared.structuredContent as { ok: boolean; operation: { operation_id: string } }; assert.equal(first.ok, true); const id = first.operation.operation_id;
  s.rpc.prepared = (await s.core.rails.records.findOperation(id))!.prepared;
  const calls = s.rpc.calls.length;
  const approve = (await client.callTool({ name: "apn_pay_transfer_approve", arguments: { operation: id } })).structuredContent as { error: { code: string }; next_actions: string[] };
  assert.equal(approve.error.code, "APN_FOREGROUND_APPROVAL_REQUIRED"); assert.deepEqual(approve.next_actions, [`apn pay transfer approve --operation ${id}`]);
  const policy = (await client.callTool({ name: "apn_policy_admit_tron", arguments: { profile: s.account.profile, asset: "usdt", max_per_transfer: "2", daily_limit: "3", max_fee_trx: "30" } })).structuredContent as { error: { code: string }; next_actions: string[] };
  assert.equal(policy.error.code, "APN_FOREGROUND_APPROVAL_REQUIRED"); assert.ok(policy.next_actions.some((line) => line.includes("policy admit-tron") && line.includes("--max-fee-trx 30")));
  assert.equal(s.rpc.calls.length, calls); assert.equal(s.approval.calls.length, 0); assert.equal(s.rpc.submissions.length, 0);
  assert.equal((await s.core.execute({ command: "transfer.approve", operationId: id })).ok, true);
  const receipt = (await client.callTool({ name: "apn_receipt_get", arguments: { operation: id } })).structuredContent as { ok: boolean; receipt: { state: string } }; assert.equal(receipt.ok, true);
  const status = (await client.callTool({ name: "apn_operation_status", arguments: { operation: id } })).structuredContent as { operation: { state: string } }; assert.equal(status.operation.state, "completed"); assert.equal(s.rpc.submissions.length, 1);
});

test("TRON custody remains separate, survives interrupted account publication and never leaks its signed effect", async (t) => {
  const temporary = await temporaryState(); t.after(temporary.cleanup); const s = await tronFixture(temporary.root);
  const creates = s.wrapping.creates; const publicPath = join(temporary.root, "chain-accounts", "tron", `${s.account.profileHash}.json`); await unlink(publicPath);
  assert.equal((await s.core.execute({ command: "wallet.ensure-tron", profile: s.account.profile, provider: "local", acceptRisk: true })).ok, true);
  assert.deepEqual(await s.storage.account(s.account.profile, "tron"), s.account); assert.equal(s.wrapping.creates, creates);
  const id = await s.prepare(); await s.core.execute({ command: "transfer.approve", operationId: id }); const tx = s.rpc.submissions[0]!;
  for (const directory of ["chain-wallets/tron", `rail-operations/${s.account.profileHash}`, `rail-receipts/${s.account.profileHash}`]) for (const path of await readdir(join(temporary.root, directory))) {
    const text = await readFile(join(temporary.root, directory, path), "utf8"); assert.equal(text.includes(Buffer.alloc(32, 47).toString("hex")), false); assert.equal(text.includes(tx.signature![0]!), false);
  }
});

test("TRON and Solana reject reciprocal provider ownership drift before any key or provider creation", async (t) => {
  const temporary = await temporaryState(); t.after(temporary.cleanup); const s = await tronFixture(temporary.root, { admit: false });
  let launches = 0; const provider = { ...s.adapter, rail: "solana", provider: "coinbase-awal", ensureAccount: async () => { launches++; throw new Error("must not launch"); } } as unknown as typeof s.adapter;
  const core = new ApnCore({ state: s.core.context.state, chainAccounts: s.storage, directRails: [s.adapter, provider] });
  assert.equal((await core.execute({ command: "wallet.ensure-solana", profile: s.account.profile, provider: "coinbase-awal", acceptRisk: false })).error?.code, "APN_PROFILE_DRIFT"); assert.equal(launches, 0);
  const loads = s.wrapping.loads;
  await unlink(join(temporary.root, "chain-accounts", "tron", `${s.account.profileHash}.json`));
  assert.equal((await core.execute({ command: "wallet.ensure-solana", profile: s.account.profile, provider: "coinbase-awal", acceptRisk: false })).error?.code, "APN_PROFILE_DRIFT");
  assert.equal(launches, 0); assert.equal(s.wrapping.loads, loads);
  assert.equal((await core.execute({ command: "wallet.ensure-tron", profile: s.account.profile, provider: "local", acceptRisk: true })).ok, true);
  assert.deepEqual(await s.storage.account(s.account.profile, "tron"), s.account);
  const foreign = await s.storage.ensureProvider({ profile: "provider-owned", rail: "solana", provider: "coinbase-awal", address: SOL_RECIPIENT }); const creates = s.wrapping.creates;
  assert.equal((await core.execute({ command: "wallet.ensure-tron", profile: foreign.profile, provider: "local", acceptRisk: true })).error?.code, "APN_PROFILE_DRIFT"); assert.equal(s.wrapping.creates, creates); assert.equal(s.rpc.calls.length, 0);
});

class RailAbandonApproval implements OperationAbandonApprovalPort {
  readonly calls: OperationAbandonIntent[] = [];
  async approve(intent: OperationAbandonIntent): Promise<void> { this.calls.push(intent); }
}

test("TRON expired unlanded transfer is owner-abandoned only after its solidified validity window and never resent", async (t) => {
  const temporary = await temporaryState(); t.after(temporary.cleanup); const approval = new RailAbandonApproval();
  const s = await tronFixture(temporary.root, { abandonApproval: approval }); const id = await s.prepare("usdt");
  s.rpc.submissionTimeout = true; const first = await s.core.execute({ command: "transfer.approve", operationId: id });
  assert.equal((first.operation as { state: string }).state, "unknown_finality"); const transaction = s.rpc.submissions[0]; assert.ok(transaction);
  s.rpc.absentHistory = true;
  assert.equal((await s.core.execute({ command: "operation.abandon", operationId: id })).error?.code, "APN_OPERATION_BLOCKED");
  s.rpc.solidHead = 1100n; s.rpc.absentHistory = false;
  assert.equal((await s.core.execute({ command: "operation.abandon", operationId: id })).error?.code, "APN_OPERATION_BLOCKED");
  assert.equal(approval.calls.length, 0); s.rpc.absentHistory = true;
  const abandoned = await s.core.execute({ command: "operation.abandon", operationId: id });
  assert.equal(abandoned.ok, true, abandoned.error?.message); assert.equal((abandoned.operation as { state: string }).state, "abandoned_unknown");
  assert.equal(approval.calls.length, 1); assert.equal(approval.calls[0]!.operationId, id); assert.deepEqual(s.rpc.submissions, [transaction]);
  await new OperationService(s.core.context.state).assertProfileAvailable(s.account.profileHash);
  assert.equal(((await s.core.execute({ command: "receipt.get", operationId: id })).receipt as { state: string }).state, "abandoned_unknown");
});
