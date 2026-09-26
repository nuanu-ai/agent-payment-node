import assert from "node:assert/strict";
import test from "node:test";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { sealOperation } from "../../src/state.js";
import { DirectAllowlistGate } from "../../src/direct-allowlist-gate.js";
import { evmAllowlistSubject } from "../../src/evm-direct-allowlist.js";
import { EVM_REQUEST, EvmTestRpc, ensureDirectWallet, evmCore } from "./evm-helpers.js";
import { temporaryState } from "./helpers.js";

const request = { ...EVM_REQUEST, asset: { chainId: 1 as const, token: "native" as const } };
async function prepared(context: { after(fn: () => Promise<void>): void }, stopAfterSigning = false) {
  const temporary = await temporaryState(); context.after(temporary.cleanup);
  const rpc = new EvmTestRpc();
  const setup = evmCore(temporary.root, rpc, undefined, undefined, native => ({ request: async request => {
    const result = await native.request(request);
    if (stopAfterSigning && request.operation === "directTransfer.approveAndSign") rpc.nativeAtomic = "0";
    return result;
  } })); setup.rpc.chainId = 1; setup.rpc.l1Fee = 0n; setup.rpc.operatorFee = 0n;
  await ensureDirectWallet(setup);
  const result = await setup.core.transfer.prepare(request) as { operation_id: string };
  const old = (await setup.state.findOperation(result.operation_id))!;
  return { ...setup, old, wrappingLoads: setup.wrapping.loads, fresh: { ...request, idempotencyKey: "fresh-after-expiry" } };
}

for (const delta of [0, 1]) test(`fresh Ethereum prepare durably retires unsigned expiry at boundary +${delta}ms`, async context => {
  const setup = await prepared(context);
  setup.clock.value = new Date(Date.parse(setup.old.expiresAt) + delta);
  const fresh = await setup.core.transfer.prepare(setup.fresh) as { operation_id: string };
  assert.notEqual(fresh.operation_id, setup.old.operationId);
  const retired = (await setup.state.findOperation(setup.old.operationId))!;
  assert.equal(retired.state, "failed_before_effect"); assert.equal(retired.terminal, true);
  assert.equal(retired.reason, "approval_window_expired"); assert.equal(retired.proofClass, "durable_pre_effect_failure");
  assert.deepEqual(retired.transitions.slice(0, -1), setup.old.transitions);
  assert.equal(retired.transitions.length, 2);
  const receipt = (await setup.state.loadReceipt(retired.profileHash, retired.operationId))!;
  assert.equal(receipt.operationIntegrityHash, retired.integrityHash); assert.equal(receipt.terminal, true);
  assert.equal(setup.approval.intents.length, 0); assert.equal(setup.wrapping.loads, setup.wrappingLoads); assert.equal(setup.rpc.broadcastCount, 0);
  assert.equal((await setup.state.findOperation(fresh.operation_id))!.state, "awaiting_approval");
});

test("prepare before expiry blocks without fresh RPC or changing the journal", async context => {
  const setup = await prepared(context); setup.clock.value = new Date(Date.parse(setup.old.expiresAt) - 1);
  const calls = setup.rpc.genericBalanceCalls;
  await assert.rejects(setup.core.transfer.prepare(setup.fresh), { code: "APN_OPERATION_BLOCKED" });
  assert.equal(setup.rpc.genericBalanceCalls, calls); assert.deepEqual(await setup.state.findOperation(setup.old.operationId), setup.old);
});

test("an orphan exact usage reservation blocks retirement and stays reserved", async context => {
  const setup = await prepared(context);
  const gate = new DirectAllowlistGate(setup);
  await gate.reserve(evmAllowlistSubject(setup.old), setup.old.allowlist);
  setup.clock.value = new Date(setup.old.expiresAt); const calls = setup.rpc.genericBalanceCalls;
  await assert.rejects(setup.core.transfer.prepare(setup.fresh), { code: "APN_OPERATION_BLOCKED" });
  assert.equal(await gate.hasReservation(evmAllowlistSubject(setup.old)), true);
  assert.deepEqual(await setup.state.findOperation(setup.old.operationId), setup.old); assert.equal(setup.rpc.genericBalanceCalls, calls);
});

test("expiry never retires an approved effect-bearing operation", async context => {
  const setup = await prepared(context);
  await setup.core.transfer.approve(setup.old.operationId);
  const approved = (await setup.state.findOperation(setup.old.operationId))!;
  assert.notEqual(approved.state, "awaiting_approval"); assert.ok(approved.transactionHash);
  setup.clock.value = new Date(setup.old.expiresAt); const calls = setup.rpc.genericBalanceCalls;
  await assert.rejects(setup.core.transfer.prepare(setup.fresh), { code: "APN_OPERATION_BLOCKED" });
  assert.deepEqual(await setup.state.findOperation(setup.old.operationId), approved); assert.equal(setup.rpc.genericBalanceCalls, calls);
});

test("expiry on another domain or profile remains untouched", async context => {
  const setup = await prepared(context); setup.clock.value = new Date(setup.old.expiresAt);
  setup.rpc.chainId = 8453;
  await setup.core.transfer.prepare({ ...setup.fresh, asset: { chainId: 8453, token: "native" }, idempotencyKey: "other-chain" });
  assert.deepEqual(await setup.state.findOperation(setup.old.operationId), setup.old);
  await ensureDirectWallet(setup, "other"); setup.rpc.chainId = 1;
  await setup.core.transfer.prepare({ ...setup.fresh, profile: "other", idempotencyKey: "other-profile" });
  assert.deepEqual(await setup.state.findOperation(setup.old.operationId), setup.old);
});

test("simultaneous expiry approval and fresh prepare serialize one terminal transition", async context => {
  const setup = await prepared(context); setup.clock.value = new Date(setup.old.expiresAt);
  let release!: () => void; let acquired!: () => void;
  const held = new Promise<void>(resolve => { acquired = resolve; });
  const blocker = setup.state.withLocks([`profile:${setup.old.profileHash}`], async () => {
    acquired(); await new Promise<void>(resolve => { release = resolve; });
  });
  await held;
  const approve = setup.core.transfer.approve(setup.old.operationId);
  const prepare = setup.core.transfer.prepare(setup.fresh);
  release(); await blocker;
  const [approval, fresh] = await Promise.allSettled([approve, prepare]);
  assert.equal(fresh.status, "fulfilled");
  if (approval.status === "rejected") assert.equal(approval.reason.code, "APN_REPREPARE_REQUIRED");
  const retired = (await setup.state.findOperation(setup.old.operationId))!;
  assert.equal(retired.reason, "approval_window_expired"); assert.equal(retired.transitions.length, 2);
  assert.equal(setup.approval.intents.length, 0); assert.equal(setup.rpc.broadcastCount, 0);
});


test("expiry never retires a signed but unsubmitted operation", async context => {
  const setup = await prepared(context, true);
  await assert.rejects(setup.core.transfer.approve(setup.old.operationId), { code: "APN_INSUFFICIENT_ASSET" });
  const signed = (await setup.state.findOperation(setup.old.operationId))!;
  assert.equal(signed.state, "signed_not_submitted"); assert.equal(setup.rpc.broadcastCount, 0);
  setup.clock.value = new Date(setup.old.expiresAt); const calls = setup.rpc.genericBalanceCalls;
  await assert.rejects(setup.core.transfer.prepare(setup.fresh), { code: "APN_OPERATION_BLOCKED" });
  assert.deepEqual(await setup.state.findOperation(setup.old.operationId), signed); assert.equal(setup.rpc.genericBalanceCalls, calls);
});

test("unexpected signed identity in awaiting approval fails closed without journal rewrite", async context => {
  const setup = await prepared(context);
  const file = join(setup.state.root, "operations", setup.old.profileHash, `${setup.old.operationId}.json`);
  const { integrityHash: _, ...body } = setup.old;
  const corrupt = JSON.stringify(sealOperation({ ...body, transactionHash: `0x${"1".repeat(64)}` }));
  await writeFile(file, corrupt);
  setup.clock.value = new Date(setup.old.expiresAt); const calls = setup.rpc.genericBalanceCalls;
  await assert.rejects(setup.core.transfer.prepare(setup.fresh), error =>
    ["APN_STATE_CORRUPT", "APN_OPERATION_BLOCKED"].includes((error as { code: string }).code));
  assert.equal(await readFile(file, "utf8"), corrupt); assert.equal(setup.rpc.genericBalanceCalls, calls);
});


test("expired legacy Base direct operation keeps blocking and is never auto-retired", async context => {
  const temporary = await temporaryState(); context.after(temporary.cleanup);
  const setup = evmCore(temporary.root); await ensureDirectWallet(setup);
  const legacy = await setup.core.transfer.prepare({ command: "transfer.prepare", profile: "default",
    recipient: EVM_REQUEST.recipient, amount: "1", idempotencyKey: "legacy-expired" }) as { operation_id: string };
  const old = (await setup.state.findOperation(legacy.operation_id))!;
  assert.equal(old.evm, undefined); setup.clock.value = new Date(old.expiresAt);
  const calls = setup.rpc.genericBalanceCalls;
  await assert.rejects(setup.core.transfer.prepare({ ...EVM_REQUEST, idempotencyKey: "generic-after-legacy" }), { code: "APN_OPERATION_BLOCKED" });
  assert.deepEqual(await setup.state.findOperation(old.operationId), old); assert.equal(setup.rpc.genericBalanceCalls, calls);
});
