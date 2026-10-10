import test from "node:test";
import assert from "node:assert/strict";
import { readFile, writeFile, mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { hashObject } from "../../src/canonical.js";
import { cleanup85Envelope, evmRpcSignatureScalar, verifyCleanup85Observation } from "../../src/circle-cleanup85-native-codec.js";
import { verifyCancellationPublic, verifyCleanup85PublicWire } from "../../src/circle-v2-evm/cleanup85-public-proof.js";
import { circleHex, type CircleObservation } from "../../src/circle-v2-evm/protocol.js";
import type { Cleanup85CancellationProof } from "../../src/circle-cleanup85-cancellation-contract.js";
import type { EvmNativeCustody } from "../../src/evm-native-custody.js";
import type { CircleRpc } from "../../src/circle-v2-evm/rpc.js";
import type { Address, Hex } from "../../src/model.js";

// Exact public transaction from the 2026-10-10 diagnostic (SHA256 73ce2bf4...ab57).
// Receipt, headers and custody below are synthetic test metadata, not fresh chain evidence.
async function fixture() {
  const captured = JSON.parse(await readFile(new URL("../fixtures/cleanup85-retained-rpc-quantity.json", import.meta.url), "utf8")) as { result: Record<string, string> };
  const transaction = captured.result, envelope = cleanup85Envelope(BigInt(transaction.gas!).toString(), BigInt(transaction.maxFeePerGas!).toString(), BigInt(transaction.maxPriorityFeePerGas!).toString());
  const receipt = { transactionHash: transaction.hash!, blockHash: transaction.blockHash!, blockNumber: transaction.blockNumber!, transactionIndex: transaction.transactionIndex!, type: "0x2", status: "0x1", from: transaction.from!, to: transaction.to!, gasUsed: "0x5208", effectiveGasPrice: "0x1", logs: [] };
  const canonicalBlock = { hash: transaction.blockHash!, number: transaction.blockNumber!, timestamp: "0x6ac90000", transactions: ["0x" + "a".repeat(64), "0x" + "b".repeat(64), "0x" + "c".repeat(64), transaction.hash!] };
  const observation: CircleObservation = { transaction, receipt, canonicalBlock, recheckedBlock: structuredClone(canonicalBlock), finalityHead: structuredClone(canonicalBlock), chainId: 42161, finalityTag: "finalized" };
  const custody = (walletAddress: Address): EvmNativeCustody => ({ schemaVersion: "apn.evm-native-custody.v1", profileHash: "a".repeat(64), walletAddress, walletBindingHash: "b".repeat(64), walletCreatedAt: "2026-10-09T00:00:00.000Z", providerId: "local", providerAccountBindingHash: "b".repeat(64), providerCapabilityHash: "c".repeat(64), providerRevision: 1 });
  const body = { version: "apn.circle-cleanup85-native-cancellation-proof.v1" as const, requestBinding: "a".repeat(64), operationId: "b".repeat(64), fingerprint: "c".repeat(64), materialHash: "d".repeat(64), transactionHash: transaction.hash!, envelope, sourceCustody: custody(envelope.from), recipientCustody: custody(envelope.to), observation, actualFeeAtomic: "21000", nativeReservationId: "e".repeat(64), nativeOutcomeDigest: "f".repeat(64), nativeConsumedAtomic: "21001" };
  return { transaction, observation, envelope, proof: { ...body, proofHash: hashObject(body) } satisfies Cleanup85CancellationProof };
}

test("retained cancellation re-verifies captured valid 63-digit r without rewriting its persisted proof", async t => {
  const { transaction, observation, envelope, proof } = await fixture();
  assert.equal(transaction.r, "0x3427df945d12574186c532479a756f475d3d0dcc73c007ac55520547924824f");
  assert.equal(transaction.r!.length - 2, 63);
  assert.throws(() => circleHex(transaction.r, 32), { code: "APN_RPC_PROTOCOL", message: "circle_evm_hex" });
  assert.equal((await verifyCleanup85Observation(envelope, transaction.hash as Hex, observation)).transactionHash, transaction.hash);
  const root = await mkdtemp(join(tmpdir(), "apn-retained-scalar-")); t.after(() => rm(root, { recursive: true, force: true }));
  const path = join(root, "public-proof.json"), bytes = JSON.stringify(proof); await writeFile(path, bytes);
  const retained = JSON.parse(await readFile(path, "utf8")) as Cleanup85CancellationProof, calls: string[] = [];
  const source = { block: async (number: string) => { calls.push("block"); assert.equal(number, transaction.blockNumber); return observation.canonicalBlock; }, observation: async (hash: Hex, tag: string) => { calls.push("observation"); assert.equal(hash, transaction.hash); assert.equal(tag, "finalized"); return structuredClone(observation); } } as unknown as CircleRpc;
  assert.deepEqual(await verifyCancellationPublic(source, retained), observation);
  assert.deepEqual(calls, ["block", "block", "observation", "block", "block"]);
  assert.equal(await readFile(path, "utf8"), bytes); assert.equal(hashObject(retained), hashObject(proof));
});

for (const form of ["quantity", "legacy_word", "legacy_uppercase"] as const) test(`captured r/s ${form} reconstruct the same exact signed transaction`, async () => {
  const { transaction, observation, envelope } = await fixture();
  if (form !== "quantity") for (const field of ["r", "s"] as const) transaction[field] = "0x" + transaction[field]!.slice(2).padStart(64, "0")[form === "legacy_uppercase" ? "toUpperCase" : "toLowerCase"]();
  const native = await verifyCleanup85Observation(envelope, transaction.hash as Hex, observation);
  assert.equal(native.transactionHash, transaction.hash);
  assert.match(await verifyCleanup85PublicWire(observation, envelope, transaction.hash!, true), /^0x02/u);
});

for (const field of ["r", "s"] as const) for (const scalar of [undefined, "0x01", "0X1", "0xA", "0x" + "1".repeat(65), "0xgg", "0x0", "0x" + "f".repeat(64)]) test(`retained wire rejects ${field} scalar ${String(scalar)}`, async () => {
  const { observation, envelope, transaction } = await fixture();
  (observation.transaction as Record<string, unknown>)[field] = scalar;
  await assert.rejects(verifyCleanup85PublicWire(observation, envelope, transaction.hash!, true));
});

test("short s uses the native scalar decoder but cannot bypass exact transaction hash verification", async () => {
  const { observation, envelope, transaction } = await fixture();
  assert.equal(evmRpcSignatureScalar("0x1"), "0x" + "0".repeat(63) + "1");
  (observation.transaction as Record<string, unknown>).s = "0x1";
  await assert.rejects(verifyCleanup85PublicWire(observation, envelope, transaction.hash!, true), /public_signature_changed/u);
});

for (const field of ["input", "hash", "blockHash"] as const) test(`signature quantity support retains strict DATA validation for ${field}`, async () => {
  const { observation, envelope, transaction } = await fixture();
  (observation.transaction as Record<string, unknown>)[field] = field === "input" ? "0x0" : "0x" + "a".repeat(63);
  await assert.rejects(verifyCleanup85PublicWire(observation, envelope, transaction.hash!, true), { code: "APN_RPC_PROTOCOL", message: "circle_evm_hex" });
});
