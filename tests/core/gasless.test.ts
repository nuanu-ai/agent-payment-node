import { approvalCode } from "../../src/approval-code.js";
import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";
import { hashObject } from "../../src/canonical.js";
import { OperationService } from "../../src/operation-service.js";
import { gaslessCapabilities } from "../../src/gasless/catalog.js";
import { GASLESS_CHAINS } from "../../src/gasless/validation.js";
import { gaslessFixture } from "./gasless-helpers.js";
import { temporaryState } from "./helpers.js";

for (const chain of GASLESS_CHAINS.filter(chain => chain !== 43114)) for (const delegation of ["empty", "expected"] as const) {
  test(`gasless ${chain} ${delegation} funds principal and gas from USDC with zero native balance`, async (t) => {
    const temporary = await temporaryState(); t.after(temporary.cleanup);
    const s = await gaslessFixture(temporary.root, chain, { delegation }), { id, input, operation } = await s.prepare();
    assert.equal(operation.intent.wireVersion, "apn.gasless-wire.v4");
    const calls = s.rpc.calls.length, loads = s.wrapping.loads;
    assert.equal(s.rpc.sends.length, 0); assert.equal(operation.intent.initialSnapshot.nativeBalanceWei, "0");
    const replay = await s.core.execute(input); assert.equal(replay.ok, true); assert.equal(s.rpc.calls.length, calls);
    assert.equal(s.wrapping.loads, loads);
    const response = await s.core.execute({ command: "gasless.transfer.approve", operationId: id });
    assert.equal(response.ok, true, response.error?.message);
    assert.equal((await s.record(id)).state, "submitted_pending");
    const observed = await s.core.execute({ command: "operation.resume", operationId: id });
    assert.equal(observed.ok, true, observed.error?.message);
    const stored = await s.record(id), publicOp = observed.operation as any;
    assert.equal(stored.state, "completed"); assert.equal(stored.fingerprint, operation.fingerprint);
    assert.equal(stored.bootstrap.signingAttempts, 1); assert.equal(stored.bootstrap.disclosureAttempts, 1);
    assert.equal(stored.userOperation.signingAttempts, 1); assert.equal(stored.userOperation.submissionAttempts, 1);
    assert.equal(s.rpc.sends.length, 1); assert.equal(s.rpc.calls.filter((c) => c === "estimate").length, 1);
    const sealed = s.rpc.sends[0]!; assert.equal(sealed.role, "user_operation");
    if (sealed.role === "user_operation") {
      assert.equal(sealed.userOperation.eip7702Auth !== undefined, delegation === "empty");
      assert.equal("factory" in sealed.userOperation, delegation === "empty");
      assert.equal("factoryData" in sealed.userOperation, delegation === "empty");
    }
    assert.equal(s.approval.calls[0]!.exactPhrase, approvalCode("gasless", stored.fingerprint));
    assert.equal(publicOp.fees.proven_sender_native_debit_wei, "0");
    assert.equal(BigInt(publicOp.transfer.actual_sender_debit_atomic) + BigInt(publicOp.transfer.unused_gross_atomic), 10000000n);
    assert.equal(publicOp.transfer.actual_delivered_atomic, operation.intent.recipientAtomic);
    const receipt = await s.core.execute({ command: "receipt.get", operationId: id }); assert.equal(receipt.ok, true);
    const encoded = JSON.stringify(receipt); assert.equal(encoded.includes(s.key), false);
    if (sealed.role === "user_operation") assert.equal(encoded.includes(sealed.userOperation.signature), false);
    assert.equal(s.wrapping.creates, 0);
    const lastCalls = s.rpc.calls.length, recordHash = hashObject(stored);
    await s.core.execute({ command: "operation.resume", operationId: id });
    await s.core.execute({ command: "gasless.transfer.approve", operationId: id });
    assert.equal(hashObject(await s.record(id)), recordHash); assert.equal(s.rpc.calls.length, lastCalls);
  });
}

test("gasless capability matrix is static and separates four providers and mainnet acceptance", () => {
  const c = gaslessCapabilities("no-wallet"); assert.equal(c.profile_binding_inspected, false);
  assert.equal(c.networks.length, 7); assert.equal(c.profiles.length, 4);
  assert.deepEqual(c.profiles.filter((p) => p.adapter === "implemented").map(p => p.provider),
    ["local", "metamask-agent-wallet", "metamask-smart-account", "coinbase-agentic-wallet"]);
  assert.deepEqual(c.provider_networks.local, [1, 10, 130, 137, 8453, 42161]);
  assert.equal(c.networks.find(row => row.chain_id === 43114)?.executable_adapter, false);
  assert.deepEqual(c.provider_networks["metamask-agent-wallet"].map(row => row.chain_id), [1, 10, 137, 143, 1329, 8453, 42161, 59144]);
  assert.deepEqual(c.provider_networks["coinbase-agentic-wallet"].map(row => row.chain_id), [8453]);
  assert.ok(c.profiles.every((p) => p.mainnet_acceptance === "open"));
  assert.equal(c.semantics.x402_support_implied, false);
});

for (const delegation of ["empty", "expected"] as const) {
  test(`gasless Avalanche ${delegation} never offers the EIP-7702 adapter and needs the facilitator runtime`, async (t) => {
    const temporary = await temporaryState(); t.after(temporary.cleanup);
    const s = await gaslessFixture(temporary.root, 43114, { delegation });
    const key = "avalanche-capability-refusal";
    const response = await s.core.execute({ command: "gasless.transfer.prepare", profile: s.profile,
      request: s.request, idempotencyKey: key });
    assert.equal(response.error?.code, "APN_PROVIDER_CAPABILITY_UNAVAILABLE");
    assert.match(response.error?.message ?? "", /Avalanche facilitator/u);
    assert.equal(await s.core.gasless.records.findOperation(s.state.operationId(s.profile, key)), null);
    assert.deepEqual(s.rpc.calls, []); assert.equal(s.rpc.sends.length, 0);
    assert.equal(s.wrapping.loads, 0); assert.equal(s.approval.calls.length, 0);
    await new OperationService(s.state).assertProfileAvailable(s.state.profileHash(s.profile));
  });
}

for (const boundary of ["decline", "expiry", "nonce", "allowance", "balance", "price", "domain"] as const) {
  test(`gasless ${boundary} after review fails before signing and releases its profile`, async (t) => {
    const temporary = await temporaryState(); t.after(temporary.cleanup);
    const s = await gaslessFixture(temporary.root), { id } = await s.prepare();
    const loads = s.wrapping.loads;
    s.approval.confirm = async () => {
      if (boundary === "expiry") s.now.setTime(s.now.getTime() + 286000);
      if (boundary === "nonce") s.rpc.current = { ...s.rpc.current, permitNonceAtomic: "8" };
      if (boundary === "allowance") s.rpc.current = { ...s.rpc.current, allowanceAtomic: "1" };
      if (boundary === "balance") s.rpc.current = { ...s.rpc.current, balanceAtomic: "1" };
      if (boundary === "price") s.rpc.current = { ...s.rpc.current, baseFeePerGas: "99000000000" };
      if (boundary === "domain") s.rpc.current = { ...s.rpc.current, protocolHash: "1".repeat(64) };
      return boundary !== "decline";
    };
    const response = await s.core.execute({ command: "gasless.transfer.approve", operationId: id });
    assert.equal(response.ok, true, response.error?.message); assert.equal((await s.record(id)).state, "failed_before_effect");
    assert.equal(s.wrapping.loads, loads); assert.equal(s.rpc.sends.length, 0);
    await new OperationService(s.state).assertProfileAvailable(s.state.profileHash(s.profile));
  });
}

test("gasless joins global identity, profile, duplicate lookup and different-input guards", async (t) => {
  const temporary = await temporaryState(); t.after(temporary.cleanup);
  const s = await gaslessFixture(temporary.root), { id, input, operation } = await s.prepare();
  const service = new OperationService(s.state);
  for (const kind of ["direct_transfer", "x402_fetch", "rail_transfer", "bridge_route"] as const) {
    await assert.rejects(service.resolvePrepare({ kind, profileHash: operation.profileHash, operationId: id,
      idempotencyHash: operation.idempotencyHash, requestHash: operation.requestHash }), { code: "APN_IDEMPOTENCY_CONFLICT" });
  }
  await assert.rejects(service.assertProfileAvailable(operation.profileHash), { code: "APN_OPERATION_BLOCKED" });
  const changed = await s.core.execute({ ...input, request: { ...input.request, grossAtomic: "10000001" } });
  assert.equal(changed.error?.code, "APN_IDEMPOTENCY_CONFLICT");
  s.state.findOperation = async () => operation as never;
  await assert.rejects(service.required(id), { code: "APN_STATE_CORRUPT" });
});

test("gasless strict history binding rejects a rehashed amount mutation and repairs only an authentic stale receipt", async (t) => {
  const temporary = await temporaryState(); t.after(temporary.cleanup);
  const s = await gaslessFixture(temporary.root), { id, operation } = await s.prepare();
  const receiptPath = join(temporary.root, "gasless-receipts", operation.profileHash, `${id}.json`);
  const originalReceipt = await readFile(receiptPath, "utf8");
  s.approval.accepted = false;
  const declined = await s.core.execute({ command: "gasless.transfer.approve", operationId: id }); assert.equal(declined.ok, true);
  await writeFile(receiptPath, originalReceipt, { mode: 0o600 });
  const status = await s.core.execute({ command: "operation.status", operationId: id }); assert.equal(status.ok, true);
  assert.equal(JSON.parse(await readFile(receiptPath, "utf8")).state, "failed_before_effect");
  const operationPath = join(temporary.root, "gasless-operations", operation.profileHash, `${id}.json`);
  const corrupt = JSON.parse(await readFile(operationPath, "utf8")); corrupt.intent.recipientAtomic = "1";
  const { integrityHash: _hash, ...body } = corrupt; corrupt.integrityHash = hashObject(body);
  await writeFile(operationPath, JSON.stringify(corrupt), { mode: 0o600 });
  assert.equal((await s.core.execute({ command: "operation.status", operationId: id })).error?.code, "APN_STATE_CORRUPT");
});

test("gasless freezes the owner's fee limit so a paymaster fee increase before signing still completes", async (t) => {
  const temporary = await temporaryState(); t.after(temporary.cleanup);
  const s = await gaslessFixture(temporary.root), { id, operation } = await s.prepare();
  assert.equal(operation.intent.wireVersion, "apn.gasless-wire.v4");
  assert.equal(operation.intent.feeCapAtomic, s.request.maxFeeAtomic);
  assert.equal(operation.intent.recipientAtomic, (BigInt(s.request.grossAtomic) - BigInt(s.request.maxFeeAtomic)).toString());
  s.rpc.current = { ...s.rpc.current, feeConfiguration: { ...s.rpc.current.feeConfiguration, nativeTokenPrice: "3000000000" } };
  const response = await s.core.execute({ command: "gasless.transfer.approve", operationId: id });
  assert.equal(response.ok, true, response.error?.message);
  assert.equal((await s.record(id)).state, "submitted_pending");
  assert.equal((await s.core.execute({ command: "operation.resume", operationId: id })).ok, true);
  const stored = await s.record(id); assert.equal(stored.state, "completed"); assert.equal(s.rpc.sends.length, 1);
  await new OperationService(s.state).assertProfileAvailable(stored.profileHash);
});

test("gasless refuses a prepare whose current quote exceeds the owner's fee limit", async (t) => {
  const temporary = await temporaryState(); t.after(temporary.cleanup);
  const s = await gaslessFixture(temporary.root), key = "gasless-quote-over-limit";
  const response = await s.core.execute({ command: "gasless.transfer.prepare", profile: s.profile,
    request: { ...s.request, maxFeeAtomic: "5000", minReceivedAtomic: "9900000" }, idempotencyKey: key });
  assert.equal(response.error?.code, "APN_FEE_BUDGET_EXCEEDED");
  assert.equal(await s.core.gasless.records.findOperation(s.state.operationId(s.profile, key)), null);
  assert.equal(s.rpc.sends.length, 0); assert.equal(s.approval.calls.length, 0);
});
