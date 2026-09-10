import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import test from "node:test";
import { promisify } from "node:util";
import { hashObject } from "../../src/canonical.js";
import type { GaslessObservation } from "../../src/gasless/model.js";
import type { GaslessOperationRecord } from "../../src/gasless/operation-model.js";
import { OperationService } from "../../src/operation-service.js";
import { gaslessFixture, testWord } from "./gasless-helpers.js";
import { temporaryState } from "./helpers.js";

function invalidation(op: GaslessOperationRecord): GaslessObservation {
  const i = op.intent.initialSnapshot;
  const eoa = (BigInt(i.eoaNonceAtomic) + 1n).toString();
  const safeBlock = { numberAtomic: "101", hash: testWord("101"), timestampAtomic: i.block.timestampAtomic };
  const account = { owner: i.owner, balanceAtomic: i.balanceAtomic, nativeBalanceWei: i.nativeBalanceWei,
    allowanceAtomic: "0", permitNonceAtomic: (BigInt(i.permitNonceAtomic) + 1n).toString(),
    entryPointNonceAtomic: (BigInt(i.entryPointNonceAtomic) + 1n).toString(),
    eoaNonceAtomic: eoa, pendingEoaNonceAtomic: eoa, delegation: i.delegation };
  const proof = { chainId: i.chainId, intentHash: hashObject(op.intent),
    bootstrapMaterialHash: op.bootstrap.materialHash!, userOperationMaterialHash: op.userOperation.materialHash!,
    userOperationHash: op.userOperation.userOperationHash!, protocolHash: i.protocolHash, safeBlock,
    headBlock: { ...safeBlock, numberAtomic: "102", hash: testWord("102") }, safeAccount: account, headAccount: { ...account } };
  return { status: "permissions_invalidated", transactionHash: null, settlement: null,
    cursor: { startBlock: i.block, nextBlockAtomic: "102", previousEndBlock: { ...safeBlock } },
    evidenceHash: hashObject(proof), reason: "gasless_final_permissions_invalidated", permissionInvalidation: proof };
}

for (const [delegation, pending] of [["empty", false], ["expected", false], ["empty", true]] as const) test(`gasless ${delegation} ${pending ? "acknowledged" : "ambiguous"} final invalidation releases only future authority and preserves ambiguous financial results`, async t => {
  const temporary = await temporaryState(); t.after(temporary.cleanup);
  const s = await gaslessFixture(temporary.root, 8453, { delegation }), { id } = await s.prepare();
  s.rpc.timeout = !pending; s.rpc.result = "missing";
  if (pending) s.rpc.observe = async (_intent, _identity, cursor) => ({ status: "pending", transactionHash: null,
    settlement: null, cursor, evidenceHash: hashObject("pending"), reason: null });
  assert.equal((await s.core.execute({ command: "gasless.transfer.approve", operationId: id })).ok, true);
  const before = await s.record(id), loads = s.wrapping.loads;
  assert.equal(before.state, pending ? "submitted_pending" : "unknown_finality");
  assert.equal(before.userOperation.submissionAttempts, 1); assert.equal(before.terminal, false);
  const receiptPath = resolve(temporary.root, "gasless-receipts", before.profileHash, `${id}.json`);
  const oldReceipt = await readFile(receiptPath, "utf8");
  s.rpc.observe = async () => invalidation(before); s.now.setTime(s.now.getTime() + 360000);
  const result = await s.core.execute({ command: "operation.resume", operationId: id });
  assert.equal(result.ok, true, result.error?.message); const after = await s.record(id), publicOp = result.operation as any;
  assert.equal(after.state, "failed_permissions_invalidated"); assert.equal(after.terminal, true);
  for (const key of ["intent", "bootstrap", "userOperation", "approval", "fingerprint"] as const) assert.deepEqual(after[key], before[key]);
  assert.deepEqual(after.transitions.slice(0, before.transitions.length), before.transitions);
  assert.equal(publicOp.proof_class, "rpc_safe_final_permissions_invalidated");
  assert.equal(publicOp.payment_submission_attempted, true); assert.equal(publicOp.payment_submitted, null);
  assert.equal(publicOp.prior_payment_effects, "unknown"); assert.equal(publicOp.permission.guard_held, false);
  assert.equal(publicOp.transfer.actual_delivered_atomic, null); assert.equal(publicOp.fees.actual_fee_atomic, null);
  assert.equal(s.wrapping.loads, loads); assert.equal(s.rpc.sends.length, 1);
  assert.equal(s.rpc.calls.filter(c => c === "estimate").length, 1);
  await new OperationService(s.state).assertProfileAvailable(after.profileHash);
  await writeFile(receiptPath, oldReceipt, { mode: 0o600 });
  assert.equal((await s.core.execute({ command: "operation.status", operationId: id })).ok, true);
  const child = await promisify(execFile)(process.execPath,
    [resolve("tests/core/gasless-fixtures/restart.mjs"), temporary.root, id], { cwd: process.cwd(), timeout: 30000, maxBuffer: 1024 * 1024 });
  const restart = JSON.parse(child.stdout);
  assert.equal(restart.ok, true); assert.equal(restart.state, "failed_permissions_invalidated");
  assert.equal(restart.signingCalls + restart.sendCalls + restart.estimateCalls + restart.wrappingLoads, 0);
  assert.equal(hashObject(await s.record(id)), hashObject(after));
});

test("gasless final invalidation requires both sealed identities, invalidated nonces and the completed canonical scan", async t => {
  const temporary = await temporaryState(); t.after(temporary.cleanup);
  const s = await gaslessFixture(temporary.root), { id } = await s.prepare(); s.rpc.timeout = true; s.rpc.result = "missing";
  await s.core.execute({ command: "gasless.transfer.approve", operationId: id });
  const before = await s.record(id); s.now.setTime(s.now.getTime() + 360000);
  const faults: Array<(o: any) => void> = [
    o => { delete o.permissionInvalidation.userOperationHash; },
    o => { delete o.permissionInvalidation.userOperationMaterialHash; },
    o => { o.permissionInvalidation.userOperationHash = testWord("foreign"); },
    o => { o.permissionInvalidation.userOperationMaterialHash = "f".repeat(64); },
    o => { o.permissionInvalidation.bootstrapMaterialHash = "f".repeat(64); },
    o => { o.permissionInvalidation.safeAccount.entryPointNonceAtomic = before.intent.initialSnapshot.entryPointNonceAtomic; },
    o => { o.permissionInvalidation.headAccount.entryPointNonceAtomic = before.intent.initialSnapshot.entryPointNonceAtomic; },
    o => { o.permissionInvalidation.safeAccount.permitNonceAtomic = before.intent.initialSnapshot.permitNonceAtomic; },
    o => { o.permissionInvalidation.headAccount.permitNonceAtomic = before.intent.initialSnapshot.permitNonceAtomic; },
    o => { o.permissionInvalidation.safeAccount.allowanceAtomic = "1"; },
    o => { o.permissionInvalidation.headAccount.allowanceAtomic = "1"; },
    o => { o.permissionInvalidation.headAccount.pendingEoaNonceAtomic = "100"; },
    o => { o.permissionInvalidation.safeAccount.eoaNonceAtomic = before.intent.initialSnapshot.eoaNonceAtomic; },
    o => { o.cursor.previousEndBlock = null; }, o => { o.cursor.nextBlockAtomic = "101"; },
    o => { o.permissionInvalidation.safeBlock.hash = testWord("foreign"); },
    o => { o.reason = "gasless_bootstrap_permissions_invalidated"; },
  ];
  for (const [index, fault] of faults.entries()) {
    const proof = structuredClone(invalidation(before)); fault(proof);
    s.rpc.observe = async () => ({ ...proof, evidenceHash: hashObject(proof.permissionInvalidation) });
    const result = await s.core.execute({ command: "operation.resume", operationId: id }); assert.equal(result.ok, true);
    const held = await s.record(id); assert.equal(held.terminal, false, `fault ${index}`); assert.equal(held.state, "unknown_finality");
    await assert.rejects(new OperationService(s.state).assertProfileAvailable(held.profileHash), { code: "APN_OPERATION_BLOCKED" });
  }
  assert.equal(s.rpc.sends.length, 1); assert.equal(s.rpc.calls.filter(c => c === "estimate").length, 1);
});
