import { approvalCode } from "../../src/approval-code.js";
import assert from "node:assert/strict";
import { mkdtemp, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { ApnCore } from "../../src/core.js";
import { ApnError } from "../../src/errors.js";
import { MetaMaskGaslessOperationRepository } from "../../src/metamask-gasless/journal/repository.js";
import { MM_CHAINS } from "../../src/metamask-gasless/model.js";
import { mmFixture, mmTestWord } from "./metamask-gasless-helpers.js";

const sandbox = async () => await mkdtemp(join(await realpath(tmpdir()), "apn-mm-service-test-"));

test("MM eight-chain preparation binds exact economics and reuses stored idempotency before provider reads", async () => {
  const root = await sandbox();
  try {
    for (const chainId of MM_CHAINS) {
      const f = await mmFixture(join(root, String(chainId)), chainId, chainId === 8453 ? "pinned" : "empty");
      const before = await f.state.loadProviderProfile(f.state.profileHash(f.profile));
      const { id, input, operation } = await f.prepare();
      assert.equal(operation.intent.request.chainId, chainId);
      assert.equal(operation.state, "awaiting_approval"); assert.equal(operation.submissionAttempts, 0);
      assert.equal(BigInt(operation.intent.quote.netAtomic) + BigInt(operation.intent.quote.feeAtomic), 10000000n);
      assert.deepEqual(f.provider.calls, ["inspect", "quote", "buildUnsigned"]);
      const calls = [...f.provider.calls]; f.provider.failInspect = true;
      const repeated = await f.restart().execute(input); assert.equal(repeated.ok, true);
      assert.equal((repeated.operation as { operation_id: string }).operation_id, id);
      assert.deepEqual(f.provider.calls, calls);
      assert.deepEqual(await f.state.loadProviderProfile(f.state.profileHash(f.profile)), before);
      const receipt = await f.core.execute({ command: "receipt.get", operationId: id });
      const safe = JSON.stringify([repeated, receipt]);
      for (const forbidden of ["private_rpc_canary", operation.intent.requestId, "unsignedDelegation", "signingDigest", "private_identity_canary"]) {
        assert.equal(safe.includes(forbidden), false, forbidden);
      }
    }
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("MM fee convergence is capped at three quotes and accepts the exact zero-fee allocation", async () => {
  const root = await sandbox();
  try {
    for (const [name, fees, expected] of [
      ["two", ["40000", "40000"], 2], ["three", ["40000", "30000", "30000"], 3],
      ["unstable", ["40000", "30000", "20000"], 3], ["cap", ["50001"], 1],
    ] as const) {
      const f = await mmFixture(join(root, name)); f.provider.fees = [...fees];
      const result = await f.core.execute({ command: "gasless.transfer.prepare", profile: f.profile,
        request: f.request, idempotencyKey: `mm-fees-${name}` });
      assert.equal(f.provider.quotes.length, expected, JSON.stringify(result.error));
      assert.equal(result.ok, name === "two" || name === "three", JSON.stringify(result));
      if (!result.ok) assert.equal((await f.core.metaMaskGasless.records.listAllOperations()).length, 0);
      assert.equal(f.provider.submissions.length, 0);
    }
    const zero = await mmFixture(join(root, "zero")); zero.provider.fees = ["0"];
    const result = await zero.core.execute({ command: "gasless.transfer.prepare", profile: zero.profile,
      request: { ...zero.request, maxFeeAtomic: "0", minReceivedAtomic: "10000000" }, idempotencyKey: "mm-fees-zero" });
    assert.equal(result.ok, true, JSON.stringify(result.error)); assert.equal(zero.provider.quotes.length, 1);
    assert.equal(zero.provider.quotes[0]?.netAtomic, "10000000");
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("MM approval persists one marker before submit; lost response, restart and deadline never cause a second POST", async () => {
  const root = await sandbox();
  try {
    const f = await mmFixture(root), { id } = await f.prepare();
    f.rpc.phase = "pending"; f.rpc.candidate = null; f.provider.failSubmit = true;
    f.provider.beforeSubmit = async intent => {
      const saved = await new MetaMaskGaslessOperationRepository(root).findOperation(id);
      assert.equal(saved?.state, "dispatch_pending"); assert.equal(saved?.submissionAttempts, 1);
      assert.equal(saved?.intent.requestId, intent.requestId); assert.ok(saved?.approval);
    };
    const approved = await f.core.execute({ command: "gasless.transfer.approve", operationId: id });
    assert.equal(approved.ok, true, JSON.stringify(approved.error)); assert.equal((await f.record(id)).state, "unknown_finality");
    const phrase = f.approval.calls[0]!.exactPhrase;
    assert.equal(phrase, approvalCode("gasless", id, (await f.record(id)).fingerprint));
    assert.match(phrase, /^[0-9a-f]{6}$/u);
    f.now.setTime(f.now.getTime() + 600_000); f.provider.failObserve = true;
    const same = f.restart();
    assert.equal((await same.execute({ command: "gasless.transfer.approve", operationId: id })).ok, true);
    assert.equal((await same.execute({ command: "operation.resume", operationId: id })).ok, true);
    f.rpc.phase = "success"; f.rpc.candidate = mmTestWord("transaction-b");
    const completed = await f.restart().execute({ command: "operation.resume", operationId: id });
    assert.equal(completed.ok, true, JSON.stringify(completed.error));
    assert.equal((await f.record(id)).state, "completed"); assert.equal(f.provider.submissions.length, 1);
    assert.equal(f.approval.calls.length, 1);
    const calls = f.provider.calls.length, rpcCalls = f.rpc.calls.length;
    await f.restart().execute({ command: "operation.resume", operationId: id });
    assert.equal(f.provider.calls.length, calls); assert.equal(f.rpc.calls.length, rpcCalls);
    assert.equal(JSON.stringify(completed).includes("private_submit_canary"), false);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("MM canonical revert survives failed reads and later settles another transaction for the same permission", async () => {
  const root = await sandbox();
  try {
    const f = await mmFixture(root), { id } = await f.prepare(); f.rpc.phase = "reverted";
    assert.equal((await f.core.execute({ command: "gasless.transfer.approve", operationId: id })).ok, true);
    assert.equal((await f.record(id)).state, "failed_effects_pending");
    const fingerprint = (await f.record(id)).fingerprint;
    f.now.setTime(f.now.getTime() + 600_000); f.rpc.phase = "unavailable"; f.provider.failObserve = true;
    assert.equal((await f.restart().execute({ command: "operation.resume", operationId: id })).ok, true);
    assert.equal((await f.record(id)).state, "failed_effects_pending");
    f.rpc.phase = "success"; f.rpc.candidate = mmTestWord("transaction-b"); f.provider.failObserve = false;
    f.provider.status = "failed"; f.provider.txHash = mmTestWord("transaction-b");
    const result = await f.restart().execute({ command: "operation.resume", operationId: id });
    assert.equal(result.ok, true, JSON.stringify(result.error));
    const final = await f.record(id); assert.equal(final.state, "completed"); assert.equal(final.fingerprint, fingerprint);
    assert.equal(final.settlement?.txHash, mmTestWord("transaction-b")); assert.equal(f.provider.submissions.length, 1);
    assert.ok(final.transitions.some(t => t.observation?.candidateTxHash === mmTestWord("transaction-a")));
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("MM provider MFA remains visible through restart and completes by observation without resubmission", async () => {
  const root = await sandbox();
  try {
    const f = await mmFixture(root), { id } = await f.prepare();
    f.rpc.phase = "pending"; f.rpc.candidate = null;
    f.provider.status = "awaiting_approval"; f.provider.txHash = null;
    const approved = await f.core.execute({ command: "gasless.transfer.approve", operationId: id });
    assert.equal(approved.ok, true, JSON.stringify(approved.error));
    const saved = await f.record(id);
    assert.equal(saved.state, "unknown_finality"); assert.equal(saved.failure?.reason, "mm_gasless_provider_approval");
    assert.equal(saved.submissionAttempts, 1); assert.equal(saved.terminal, false);
    const actions = (approved.operation as { next_actions: string[] }).next_actions;
    assert.match(actions[0]!, /existing transaction in MetaMask Mobile or the email/u);
    assert.equal(actions[1], `apn operation resume --operation ${id}`);
    f.now.setTime(f.now.getTime() + 600_000);
    const resumed = await f.restart().execute({ command: "operation.resume", operationId: id });
    assert.equal(resumed.ok, true, JSON.stringify(resumed.error));
    assert.equal((await f.record(id)).failure?.reason, "mm_gasless_provider_approval");
    assert.equal((await f.restart().execute({ command: "receipt.get", operationId: id })).ok, true);
    f.provider.status = "confirmed"; f.provider.txHash = mmTestWord("transaction-a");
    f.rpc.phase = "success"; f.rpc.candidate = f.provider.txHash;
    const completed = await f.restart().execute({ command: "operation.resume", operationId: id });
    assert.equal(completed.ok, true, JSON.stringify(completed.error));
    assert.equal((await f.record(id)).state, "completed");
    assert.equal(f.provider.submissions.length, 1); assert.equal(f.approval.calls.length, 1);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("MM pre-effect expiry, refusal, clock rollback and state drift fail without submission", async () => {
  const root = await sandbox();
  try {
    for (const mode of ["expired", "refused", "rollback", "throw-rollback", "counter", "fee-above-ceiling"] as const) {
      const f = await mmFixture(join(root, mode)), { id } = await f.prepare();
      if (mode === "expired") f.now.setTime(f.now.getTime() + 300_000);
      if (mode === "refused") f.approval.accepted = false;
      if (mode === "rollback" || mode === "throw-rollback") f.approval.hook = () => f.now.setTime(f.now.getTime() - 1);
      if (mode === "throw-rollback") f.approval.error = new ApnError("APN_FOREGROUND_APPROVAL_REQUIRED", "TTY unavailable");
      if (mode === "counter") f.rpc.state = { ...f.rpc.state, counterAtomic: "1" };
      // A fee inside the owner's ceiling is now repriced and dispatched; only a fee above it still refuses.
      if (mode === "fee-above-ceiling") f.provider.fees = ["50001"];
      const result = await f.core.execute({ command: "gasless.transfer.approve", operationId: id });
      assert.equal(result.ok, true, JSON.stringify(result.error));
      const saved = await f.record(id); assert.equal(saved.state, "failed_before_effect", mode);
      assert.equal(saved.submissionAttempts, 0); assert.equal(f.provider.submissions.length, 0);
      if (mode.includes("rollback")) assert.equal(saved.failure?.reason, "mm_gasless_clock");
    }
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("MM absent foreground answer leaves approval pending and generic transfer approval cannot dispatch", async () => {
  const root = await sandbox();
  try {
    const f = await mmFixture(root), { id } = await f.prepare();
    f.approval.error = new ApnError("APN_FOREGROUND_APPROVAL_REQUIRED", "TTY unavailable");
    const result = await f.core.execute({ command: "gasless.transfer.approve", operationId: id });
    assert.equal(result.ok, false); assert.equal((await f.record(id)).state, "awaiting_approval");
    const generic = await f.core.execute({ command: "transfer.approve", operationId: id });
    assert.equal(generic.error?.code, "APN_FOREGROUND_APPROVAL_REQUIRED");
    assert.equal(f.provider.submissions.length, 0);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("MM uncertain durable marker write is recovered without dispatch or resetting the attempt", async () => {
  const root = await sandbox();
  try {
    const f = await mmFixture(root), { id } = await f.prepare();
    const records = new MetaMaskGaslessOperationRepository(root), original = records.persist.bind(records);
    records.persist = async op => {
      if (op.state === "dispatch_pending") { await records.writeOperation(op); throw new Error("synthetic fsync acknowledgement loss"); }
      await original(op);
    };
    const crashing = new ApnCore({ state: f.state, metaMaskGasless: { ...f.dependencies, records }, clock: f.clock });
    const result = await crashing.execute({ command: "gasless.transfer.approve", operationId: id });
    assert.equal(result.ok, false); assert.equal(f.provider.submissions.length, 0);
    assert.equal((await f.record(id)).submissionAttempts, 1);
    f.rpc.phase = "pending"; f.rpc.candidate = null;
    const resumed = await f.restart().execute({ command: "operation.resume", operationId: id });
    assert.equal(resumed.ok, true, JSON.stringify(resumed.error));
    assert.equal((await f.record(id)).state, "unknown_finality"); assert.equal(f.provider.submissions.length, 0);
    assert.equal((await f.core.execute({ command: "receipt.get", operationId: id })).ok, true);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("MM post-marker clock warning preserves the saved guard until a usable clock returns", async () => {
  const root = await sandbox();
  try {
    const f = await mmFixture(root), { id } = await f.prepare(); f.rpc.phase = "pending";
    await f.core.execute({ command: "gasless.transfer.approve", operationId: id });
    const before = await f.record(id), calls = f.provider.calls.length;
    f.now.setTime(f.now.getTime() - 1);
    const held = await f.restart().execute({ command: "operation.resume", operationId: id });
    assert.equal(held.ok, true); assert.equal(JSON.stringify(held).includes("mm_gasless_clock"), true);
    assert.equal(f.provider.calls.length, calls); assert.deepEqual(await f.record(id), before);
    f.now.setTime(f.now.getTime() + 2); f.rpc.phase = "success";
    const resumed = await f.restart().execute({ command: "operation.resume", operationId: id });
    assert.equal(resumed.ok, true, JSON.stringify(resumed.error)); assert.equal((await f.record(id)).state, "completed");
  } finally { await rm(root, { recursive: true, force: true }); }
});
