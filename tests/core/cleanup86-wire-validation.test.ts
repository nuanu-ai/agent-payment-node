import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { keccak256, parseTransaction, serializeTransaction, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { circleEnvelope, type CircleOperationV1 } from "../../src/circle-v2-evm/operation-model.js";
import { CIRCLE_SOURCE_TOKEN } from "../../src/circle-v2-evm/catalog.js";
import { encodeCircleApproval } from "../../src/circle-v2-evm/protocol.js";
import { assertCleanup86RestoredWire } from "../../src/circle-v2-evm/cleanup86-wire-validation.js";
import { Cleanup86Custody } from "../../src/circle-v2-evm/cleanup86-custody.js";
import type { Cleanup86Intent } from "../../src/circle-v2-evm/cleanup86-store.js";
import type { Cleanup85RecoveryIntent } from "../../src/circle-v2-evm/cleanup85-recovery-store.js";
import { StateStore } from "../../src/state.js";

// This is a public deterministic TEST key, never the production Buyer identity.
const account = privateKeyToAccount(`0x${"11".repeat(32)}`);
const envelope = circleEnvelope({ chainId: 42161, from: account.address, to: CIRCLE_SOURCE_TOKEN, data: encodeCircleApproval(true), valueAtomic: "0", nonceAtomic: "86", gasLimitAtomic: "46936", maxFeePerGasAtomic: "80024000", maxPriorityFeePerGasAtomic: "0" });
const transaction = { type: "eip1559" as const, chainId: 42161, to: envelope.to, data: envelope.data, value: 0n, nonce: 86, gas: 46936n, maxFeePerGas: 80024000n, maxPriorityFeePerGas: 0n, accessList: [] };
test("cleanup86 restored wire authenticates a real TEST signature and immutable hash", async () => {
  const raw = await account.signTransaction(transaction);
  await assertCleanup86RestoredWire(raw, envelope, keccak256(raw));
  await assert.rejects(assertCleanup86RestoredWire(raw, envelope, `0x${"00".repeat(32)}`));
  await assert.rejects(assertCleanup86RestoredWire(raw, { ...envelope, gasLimitAtomic: "46935" }, keccak256(raw)));
});
for (const variant of ["signer", "nonce", "value", "data", "fee", "priority", "gas", "type", "accesslist", "chain", "to"] as const) test(`cleanup86 rejects independently signed TEST wire with wrong ${variant}`, async () => {
  let raw: Hex;
  if (variant === "signer") raw = await privateKeyToAccount(`0x${"22".repeat(32)}`).signTransaction(transaction);
  else if (variant === "type") raw = await account.signTransaction({ type: "legacy", chainId: 42161, to: envelope.to, data: envelope.data, value: 0n, nonce: 86, gas: 46936n, gasPrice: 80024000n });
  else {
    const patch = variant === "nonce" ? { nonce: 87 } : variant === "value" ? { value: 1n } : variant === "data" ? { data: "0x" as Hex } : variant === "fee" ? { maxFeePerGas: 80024001n } : variant === "priority" ? { maxPriorityFeePerGas: 1n } : variant === "gas" ? { gas: 46935n } : variant === "chain" ? { chainId: 1 } : variant === "to" ? { to: account.address } : { accessList: [{ address: envelope.to, storageKeys: [] }] };
    raw = await account.signTransaction({ ...transaction, ...patch });
  }
  await assert.rejects(assertCleanup86RestoredWire(raw, envelope, keccak256(raw)), /restored_wire_binding/u);
});
for (const variant of ["zero_r", "zero_s", "high_s"] as const) test(`cleanup86 rejects invalid EVM signature ${variant}`, async () => {
  const parsed = parseTransaction(await account.signTransaction(transaction));
  const zero = `0x${"00".repeat(32)}` as Hex;
  const high = "0x7fffffffffffffffffffffffffffffff5d576e7357a4501ddfe92f46681b20a1" as Hex;
  const raw = serializeTransaction({ ...parsed, ...(variant === "zero_r" ? { r: zero } : { s: variant === "zero_s" ? zero : high }) });
  await assert.rejects(assertCleanup86RestoredWire(raw, envelope, keccak256(raw)), /restored_wire_binding/u);
});
test("cleanup86 forged first dispatch grant causes zero keybroker reads", async t => {
  const root = await realpath(await mkdtemp(join(tmpdir(), "cleanup86-restore-test-"))); t.after(() => rm(root, { recursive: true, force: true }));
  let reads = 0;
  const custody = new Cleanup86Custody(new StateStore(root), { load: async () => { reads++; return Buffer.alloc(32); }, create: async () => { throw new Error("forbidden creation"); } });
  const op = { operationId: "a".repeat(64) } as CircleOperationV1;
  const intent = { intentHash: "b".repeat(64), envelope } as Cleanup86Intent;
  const recovery = { recoveryBinding: "c".repeat(64) } as Cleanup85RecoveryIntent;
  await assert.rejects(custody.restoreFirstDispatch(op, intent, recovery, { kind: "cleanup86-first-dispatch-grant" }, { transactionHash: `0x${"dd".repeat(32)}`, materialHash: "e".repeat(64) }, undefined as never), /private_cleanup86_first_dispatch_authority_required/u);
  assert.equal(reads, 0);
});
