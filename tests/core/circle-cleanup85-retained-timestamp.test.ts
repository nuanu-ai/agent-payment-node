import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { hashObject, sha256 } from "../../src/canonical.js";
import { verifyCancellationPublic } from "../../src/circle-v2-evm/cleanup85-public-proof.js";
import type { Cleanup85CancellationProof } from "../../src/circle-cleanup85-cancellation-contract.js";
import type { CircleObservation } from "../../src/circle-v2-evm/protocol.js";
import type { CircleRpc } from "../../src/circle-v2-evm/rpc.js";

// Frozen public-only03:04 diagnostic responses and original immutable F85 proof.
// Finality head and repeated header in this offline fixture are retained copies, not new live finality proof.
async function fixture() {
  const read = async (name: string) => readFile(new URL(`../fixtures/cleanup85-retained-timestamp/${name}`, import.meta.url), "utf8");
  const proofBytes = await read("retained-proof.json"), txBytes = await read("raw-response-1.json");
  assert.equal(sha256(proofBytes), "934ff924dd3c5e6444462a114b016c761bf7b5cde7713b8e0453687ff7beea19");
  assert.equal(sha256(txBytes), "73ce2bf47782a14213d89c5663d512a4b0c3387a478420bb42eeb2a5af23ab57");
  const proof = JSON.parse(proofBytes) as Cleanup85CancellationProof;
  const transaction = JSON.parse(txBytes).result as Record<string, unknown>, receipt = JSON.parse(await read("raw-response-2.json")).result as Record<string, unknown>, block = JSON.parse(await read("raw-response-3.json")).result as Record<string, unknown>;
  const observation: CircleObservation = { ...structuredClone(proof.observation), transaction, receipt, canonicalBlock: block, recheckedBlock: structuredClone(block) };
  const source = { block: async (number: string) => number === String(block.number) ? structuredClone(block) : structuredClone(proof.observation.finalityHead), observation: async () => structuredClone(observation) } as unknown as CircleRpc;
  return { proof, proofBytes, observation, source, transaction, receipt, block };
}

for (const form of ["missing", "exact_present"] as const) test(`retained cancellation accepts ${form} canonical timestamp without changing the raw proof`, async () => {
  const f = await fixture(), before = JSON.stringify(f.proof);
  assert.deepEqual(f.receipt, f.proof.observation.receipt); assert.deepEqual(f.block, f.proof.observation.canonicalBlock);
  if (form === "exact_present") f.transaction.blockTimestamp = f.block.timestamp;
  assert.deepEqual(await verifyCancellationPublic(f.source, f.proof), f.observation);
  assert.equal(JSON.stringify(f.proof), before); assert.equal(sha256(f.proofBytes), "934ff924dd3c5e6444462a114b016c761bf7b5cde7713b8e0453687ff7beea19");
});

for (const timestamp of [null, 1791585721, "bad", "0x", "0x0", "0x6ac96db8", "0x06ac96db9"] as const) test(`present malformed or wrong timestamp ${String(timestamp)} is never overwritten`, async () => {
  const f = await fixture(); f.transaction.blockTimestamp = timestamp;
  await assert.rejects(verifyCancellationPublic(f.source, f.proof)); assert.equal(f.transaction.blockTimestamp, timestamp);
});

for (const field of ["hash", "number", "timestamp"] as const) test(`changed canonical header ${field} is rejected`, async () => {
  const f = await fixture(); f.block[field] = field === "hash" ? "0x" + "a".repeat(64) : field === "number" ? "0x1e98e3d5" : "0x6ac96dba";
  (f.observation.recheckedBlock as Record<string, unknown>)[field] = f.block[field];
  await assert.rejects(verifyCancellationPublic(f.source, f.proof));
});

for (const field of ["gas", "maxFeePerGas", "from", "nonce", "r", "gasPrice", "extraProviderField"] as const) test(`timestamp compatibility still rejects changed transaction ${field}`, async () => {
  const f = await fixture(); f.transaction[field] = field === "from" ? "0x" + "1".repeat(40) : field === "r" ? "0x" + "1".repeat(64) : "0x1";
  await assert.rejects(verifyCancellationPublic(f.source, f.proof));
});

for (const field of ["gasUsed", "effectiveGasPrice", "status", "extraProviderField"] as const) test(`timestamp compatibility still rejects changed receipt ${field}`, async () => {
  const f = await fixture(); f.receipt[field] = field === "status" ? "0x0" : "0x1";
  await assert.rejects(verifyCancellationPublic(f.source, f.proof));
});

test("an originally absent timestamp retains exact transaction binding and rejects a newly present field", async () => {
  const f = await fixture(), body = structuredClone(f.proof); delete (body.observation.transaction as Record<string, unknown>).blockTimestamp;
  const { proofHash: _old, ...unsigned } = body; const absent = { ...unsigned, proofHash: hashObject(unsigned) };
  assert.deepEqual(await verifyCancellationPublic(f.source, absent), f.observation);
  f.transaction.blockTimestamp = f.block.timestamp;
  await assert.rejects(verifyCancellationPublic(f.source, absent), /cancellation_receipt_changed/u);
});

test("a malformed retained timestamp is refused even when its proof digest is recomputed", async () => {
  const f = await fixture(), body = structuredClone(f.proof); (body.observation.transaction as Record<string, unknown>).blockTimestamp = "0x0";
  const { proofHash: _old, ...unsigned } = body;
  await assert.rejects(verifyCancellationPublic(f.source, { ...unsigned, proofHash: hashObject(unsigned) }));
});
