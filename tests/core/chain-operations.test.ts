import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";
import { OperationService } from "../../src/operation-service.js";
import { hashObject } from "../../src/canonical.js";
import { transitionRail, validateRailOperation } from "../../src/rail-operation-model.js";
import { createMcpServer } from "../../src/mcp-server.js";
import { ApnCore } from "../../src/core.js";
import { chainAsset, SOLANA_GENESIS } from "../../src/chain-policy.js";
import type { DirectRailPort } from "../../src/direct-rail-ports.js";
import { Client, InMemoryTransport } from "@modelcontextprotocol/client";
import { makeCore, temporaryState, TestNative, TestRpc } from "./helpers.js";
import { solanaFixture, SOL_RECIPIENT } from "./solana-helpers.js";

test("restart after custody saved an effect recovers the same signature without another approval or signing", async (t) => {
  const temporary = await temporaryState(); t.after(temporary.cleanup); const s = await solanaFixture(temporary.root); const id = await s.prepare();
  const original = s.adapter.sign.bind(s.adapter); let signs = 0;
  s.adapter.sign = async (binding) => { signs++; await original(binding); throw new Error("synthetic process interruption"); };
  const first = await s.core.execute({ command: "transfer.approve", operationId: id });
  assert.equal(first.ok, false); assert.equal((await s.core.rails.records.findOperation(id))!.state, "signing_started");
  assert.equal(s.rpc.submissions.length, 0); assert.equal(signs, 1);
  assert.equal((await s.core.execute({ command: "operation.resume", operationId: id, waitSeconds: 1 })).error?.code, "APN_INVALID_INPUT");
  assert.equal(s.rpc.submissions.length, 0);
  const restart = await solanaFixture(temporary.root, { rpc: s.rpc, wrapping: s.wrapping, admit: false });
  const result = await restart.core.execute({ command: "operation.resume", operationId: id });
  assert.equal(result.ok, true); assert.equal((result.operation as { state: string }).state, "completed");
  assert.equal(s.rpc.submissions.length, 1); assert.equal(restart.approval.calls.length, 0); assert.equal(signs, 1);
});

test("lost broadcast response plus expired blockhash and absent history cannot rebuild or repay", async (t) => {
  const temporary = await temporaryState(); t.after(temporary.cleanup); const s = await solanaFixture(temporary.root); const id = await s.prepare("usdc");
  s.rpc.submissionTimeout = true;
  const first = await s.core.execute({ command: "transfer.approve", operationId: id });
  assert.equal((first.operation as { state: string }).state, "unknown_finality");
  const transaction = s.rpc.submissions[0]; assert.ok(transaction);
  s.rpc.blockHeight = 201n; s.rpc.absentHistory = true; s.now.setUTCDate(s.now.getUTCDate() + 1);
  for (let i = 0; i < 2; i++) {
    const result = await s.core.execute({ command: "operation.resume", operationId: id });
    assert.equal((result.operation as { state: string }).state, "unknown_finality");
    assert.equal(s.rpc.submissions.length, 1);
  }
  await assert.rejects(new OperationService(s.core.context.state).assertProfileAvailable(s.account.profileHash), { code: "APN_OPERATION_BLOCKED" });
  s.rpc.absentHistory = false;
  const result = await s.core.execute({ command: "operation.resume", operationId: id });
  assert.equal((result.operation as { state: string }).state, "completed"); assert.deepEqual(s.rpc.submissions, [transaction]);
});

test("operation-first receipt crash preserves submission boundary and resume repairs only the derived receipt", async (t) => {
  const temporary = await temporaryState(); t.after(temporary.cleanup); const s = await solanaFixture(temporary.root); const id = await s.prepare();
  const repair = s.core.rails.records.repairReceipt.bind(s.core.rails.records);
  s.core.rails.records.repairReceipt = async (operation) => {
    if (operation.state === "submitting") throw new Error("synthetic receipt interruption");
    return await repair(operation);
  };
  const failed = await s.core.execute({ command: "transfer.approve", operationId: id });
  assert.equal(failed.ok, false); assert.equal((await s.core.rails.records.findOperation(id))!.state, "submitting");
  assert.equal(s.rpc.submissions.length, 0);
  const receipt = await s.core.execute({ command: "receipt.get", operationId: id });
  assert.equal(receipt.error?.code, "APN_OPERATION_BLOCKED");
  assert.deepEqual(receipt.next_actions, [`apn operation resume --operation ${id}`]);
  const restart = await solanaFixture(temporary.root, { rpc: s.rpc, wrapping: s.wrapping, admit: false }); s.rpc.absentHistory = true;
  const resumed = await restart.core.execute({ command: "operation.resume", operationId: id });
  assert.equal((resumed.operation as { state: string }).state, "unknown_finality"); assert.equal(s.rpc.submissions.length, 0);
  assert.equal((await restart.core.execute({ command: "receipt.get", operationId: id })).ok, true);
});

test("trusted missing effect can end interrupted local signing, while missing committed effect is corruption", async (t) => {
  const temporary = await temporaryState(); t.after(temporary.cleanup); const s = await solanaFixture(temporary.root); const id = await s.prepare();
  const initial = (await s.core.rails.records.findOperation(id))!;
  await s.core.rails.records.persist(transitionRail(initial, { state: "signing_started", at: s.now.toISOString(), reason: "foreground_signing_started", proofClass: "durable_pre_effect" }));
  const result = await s.core.execute({ command: "operation.resume", operationId: id });
  assert.equal((result.operation as { state: string }).state, "failed_before_effect"); assert.equal(s.rpc.submissions.length, 0);
  const nextId = await s.prepare("sol", "solana-missing-effect-0002");
  let next = (await s.core.rails.records.findOperation(nextId))!;
  next = transitionRail(next, { state: "signing_started", at: s.now.toISOString(), reason: "foreground_signing_started", proofClass: "durable_pre_effect" });
  await s.core.rails.records.persist(next);
  const effect = await s.adapter.sign({ account: next.account, prepared: next.prepared, operationId: next.operationId, fingerprint: next.fingerprint });
  next = transitionRail(next, { state: "signed_not_submitted", at: s.now.toISOString(), reason: "encrypted_effect_bound", proofClass: "durable_signed_effect", transactionId: effect.transactionId, rawPayloadHash: effect.rawPayloadHash });
  await s.core.rails.records.persist(next);
  s.adapter.recoverEffect = async () => null;
  assert.equal((await s.core.execute({ command: "operation.resume", operationId: nextId })).error?.code, "APN_STATE_CORRUPT");
  assert.equal((await s.core.rails.records.findOperation(nextId))!.state, "signed_not_submitted");
  assert.equal(s.rpc.submissions.length, 0);
});

test("same-key replay is stable; cross-kind idempotency and EVM/new-rail profile exclusion share physical state", async (t) => {
  const temporary = await temporaryState(); t.after(temporary.cleanup); const s = await solanaFixture(temporary.root); const id = await s.prepare();
  const count = s.rpc.calls.length;
  assert.equal(await s.prepare(), id); assert.equal(s.rpc.calls.length, count);
  const changed = await s.core.execute({ command: "transfer.prepare-solana", profile: s.account.profile, asset: "sol", recipient: SOL_RECIPIENT,
    amount: "0.000002", maximumFee: "0.003", idempotencyKey: "solana-fixture-0001" });
  assert.equal(changed.error?.code, "APN_IDEMPOTENCY_CONFLICT");
  const operation = (await s.core.rails.records.findOperation(id))!;
  await assert.rejects(new OperationService(s.core.context.state).resolvePrepare({ kind: "direct_transfer", profileHash: operation.profileHash,
    operationId: id, idempotencyHash: operation.idempotencyHash, requestHash: operation.requestHash }), { code: "APN_IDEMPOTENCY_CONFLICT" });
  const evm = makeCore({ root: temporary.root, native: new TestNative(), rpc: new TestRpc() });
  await assert.rejects(evm.wallet.ensure(s.account.profile), { code: "APN_OPERATION_BLOCKED" });
  const result = await evm.execute({ command: "transfer.prepare", profile: s.account.profile, recipient: "0x2222222222222222222222222222222222222222", amount: "1", idempotencyKey: "evm-cross-rail-0001" });
  assert.equal(result.error?.code, "APN_OPERATION_BLOCKED");
  assert.equal(s.rpc.submissions.length, 0);
});

test("strict operation and historic-receipt integrity reject added fields and forbidden terminal mutation", async (t) => {
  const temporary = await temporaryState(); t.after(temporary.cleanup); const s = await solanaFixture(temporary.root); const id = await s.prepare();
  const initial = (await s.core.rails.records.findOperation(id))!;
  assert.throws(() => validateRailOperation({ ...initial, injected: "field" }), { code: "APN_STATE_CORRUPT" });
  await s.core.execute({ command: "transfer.approve", operationId: id });
  const final = (await s.core.rails.records.findOperation(id))!;
  assert.throws(() => transitionRail(final, { state: "unknown_finality", at: s.now.toISOString(), reason: "invalid_reopen", proofClass: "effect_outcome_unknown" }), { code: "APN_STATE_CORRUPT" });
  const path = join(temporary.root, "rail-receipts", s.account.profileHash, `${id}.json`);
  const value = JSON.parse(await readFile(path, "utf8")) as Record<string, unknown>;
  const { receipt_hash: _hash, ...body } = value; body.transaction_id = "invalid";
  await writeFile(path, JSON.stringify({ ...body, receipt_hash: hashObject(body) }), { mode: 0o600 });
  assert.equal((await s.core.execute({ command: "receipt.get", operationId: id })).error?.code, "APN_STATE_CORRUPT");
  assert.equal((await s.core.execute({ command: "operation.resume", operationId: id })).error?.code, "APN_STATE_CORRUPT");
  assert.equal(s.rpc.submissions.length, 1);
});

test("MCP provides exact foreground rail and policy handoffs without entering approval or another network request", async (t) => {
  const temporary = await temporaryState(); t.after(temporary.cleanup); const s = await solanaFixture(temporary.root); const id = await s.prepare();
  const server = createMcpServer({ stateRoot: temporary.root, wrappingSecret: s.wrapping, chainAccounts: s.storage, directRails: [s.adapter], railApproval: s.approval });
  const client = new Client({ name: "synthetic-solana-acceptance", version: "1" }); const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport); await client.connect(clientTransport); t.after(async () => { await client.close(); await server.close(); });
  const calls = s.rpc.calls.length;
  const result = await client.callTool({ name: "apn_pay_transfer_approve", arguments: { operation: id } });
  const envelope = result.structuredContent as { error: { code: string }; next_actions: string[] };
  assert.equal(envelope.error.code, "APN_FOREGROUND_APPROVAL_REQUIRED"); assert.deepEqual(envelope.next_actions, [`apn pay transfer approve --operation ${id}`]);
  assert.equal(s.rpc.calls.length, calls); assert.equal(s.approval.calls.length, 0); assert.equal(s.rpc.submissions.length, 0);
  const policy = await client.callTool({ name: "apn_policy_admit_solana", arguments: { profile: s.account.profile, asset: "usdc", max_per_transfer: "1", daily_limit: "3", max_fee_sol: "0.003" } });
  assert.equal((policy.structuredContent as { error: { code: string } }).error.code, "APN_FOREGROUND_APPROVAL_REQUIRED");
  assert.equal(s.rpc.calls.length, calls);
});

test("provider invocation is durable before launch and an ambiguous result without an id is never re-launched", async (t) => {
  const temporary = await temporaryState(); t.after(temporary.cleanup); const s = await solanaFixture(temporary.root, { admit: false });
  const account = await s.storage.ensureProvider({ profile: "solana-provider", rail: "solana", provider: "coinbase-awal", address: SOL_RECIPIENT });
  let launches = 0; let inspections = 0; let core: ApnCore;
  const adapter: DirectRailPort = {
    rail: "solana", provider: "coinbase-awal", execution: "provider_atomic", asset: (alias) => chainAsset("solana", alias),
    canonicalAddress: (value) => value, assertNetwork: async () => SOLANA_GENESIS, account: async () => account, ensureAccount: async () => account,
    balance: async () => { throw new Error("balance not used by synthetic fee contract"); },
    prepare: async (input) => ({ rail: "solana", networkIdentity: SOLANA_GENESIS, asset: input.asset, sender: account.address,
      recipient: input.recipient, amountAtomic: input.amountAtomic, maximumFeeAtomic: input.maximumFeeAtomic,
      preparedAt: input.now.toISOString(), expiresAt: new Date(input.now.getTime() + 60_000).toISOString(), blockReference: "11111111111111111111111111111111",
      lastValidBlockHeight: "200", unsignedPayload: null, sourceTokenAccount: null, destinationTokenAccount: null, createsRecipientAccount: false,
      economics: { networkFeeMaximumAtomic: "5000", recipientRentAtomic: "0", maximumNativeDebitAtomic: "5000", networkFeePayer: account.address, rentPayer: null, feeControl: "provider_guarantee" } }),
    revalidate: async () => {}, sign: async () => { throw new Error("provider cannot use local signing"); }, recoverEffect: async () => null,
    submit: async (binding) => {
      assert.equal((await core.rails.records.findOperation(binding.operationId))!.state, "submitting");
      launches++; throw new Error("synthetic protected provider response lost");
    },
    inspect: async () => { inspections++; return { status: "unproven", reason: "synthetic_unproven" }; },
  };
  core = new ApnCore({ state: s.core.context.state, chainAccounts: s.storage, directRails: [adapter], clock: { now: () => s.now },
    railApproval: s.approval, chainPolicyApproval: { approve: async () => {} } });
  assert.equal((await core.execute({ command: "policy.admit-solana", profile: account.profile, asset: "sol", maximumPerTransfer: "1", dailyLimit: "2", maximumFee: "0.003" })).ok, true);
  const prepared = await core.execute({ command: "transfer.prepare-solana", profile: account.profile, asset: "sol", recipient: s.account.address, amount: "0.000001", maximumFee: "0.003", idempotencyKey: "solana-provider-0001" });
  assert.equal(prepared.ok, true, prepared.error?.message); const id = (prepared.operation as { operation_id: string }).operation_id;
  const result = await core.execute({ command: "transfer.approve", operationId: id });
  assert.equal(result.ok, true); assert.equal((result.operation as { state: string }).state, "unknown_finality");
  assert.equal(JSON.stringify(result).includes("synthetic protected provider response lost"), false);
  for (let i = 0; i < 2; i++) await core.execute({ command: "operation.resume", operationId: id });
  assert.equal(launches, 1); assert.equal(inspections, 0);
  const record = (await core.rails.records.findOperation(id))!; assert.equal(record.transactionId, null); assert.equal(record.terminal, false);
});
