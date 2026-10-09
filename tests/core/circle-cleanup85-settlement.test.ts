import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, realpath, rm, readFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { hashObject } from "../../src/canonical.js";
import { ApnError } from "../../src/errors.js";
import { seal as sealUsage } from "../../src/asset-usage-ledger-record.js";
import { AssetUsageLedger } from "../../src/asset-usage-ledger.js";
import { CircleEvmService } from "../../src/circle-v2-evm/runtime.js";
import { advanceCircle } from "../../src/circle-v2-evm/operation-model.js";
import { canonicalJson } from "../../src/canonical.js";
import { CircleUsage } from "../../src/circle-v2-evm/usage.js";
import { CirclePublicFailureStore } from "../../src/circle-v2-evm/public-failure-store.js";
import { validateCleanup85RecoveryProof } from "../../src/circle-v2-evm/cleanup85-recovery-proof.js";
import { CLEANUP85_HASH, CLEANUP85_MATERIAL, CLEANUP85_ENVELOPE, Cleanup85RecoveryStore } from "../../src/circle-v2-evm/cleanup85-recovery-store.js";
import { consumeCleanup85Settlement, verifyCleanup85Settlement } from "../../src/circle-v2-evm/cleanup85-settlement-authority.js";
import { CircleRpc } from "../../src/circle-v2-evm/rpc.js";
import type { CircleNonceRetirementProof } from "../../src/circle-v2-evm/nonce-retirement-proof.js";
import { installCleanup85PublicFixture } from "./circle-cleanup85-public-fixture.js";
/** Deliberately synthetic future receipt proof: parser positivity is NOT canonical settlement.
 * This test demonstrates that even valid-shaped durable evidence cannot mint ledger authority. */
async function fixture() {
  const root = await realpath(await mkdtemp(join(tmpdir(), "cleanup85-settlement-"))), f = await installCleanup85PublicFixture(root);
  const cleanupProof = { ...f.parent.consumedBurn!.approvalProof, transactionHash: CLEANUP85_HASH, actualFeeAtomic: "1234", transactionHashBinding: "a".repeat(64), receiptHash: "b".repeat(64), logsHash: "c".repeat(64) } as const;
  const body = { intentHash: f.parent.intentHash, originalApprovalHash: f.op.effects[0]!.transactionHash!, originalNonceAtomic: "85", finalizedNonceAtomic: "86", finalizedBlockHash: cleanupProof.finalityBlockHash, finalizedBlockNumberAtomic: cleanupProof.finalityBlockNumberAtomic, cleanupTransactionHash: CLEANUP85_HASH, actualCleanupFeeAtomic: "1234", cleanup85Recovery: { version: "apn.circle-cleanup85-recovery-proof.v1" as const, mode: "observed_original" as const, parentIntentHash: f.parent.intentHash, recoveryBinding: null, oldCleanupTransactionHash: CLEANUP85_HASH, oldCleanupMaterialHash: CLEANUP85_MATERIAL, oldCleanupEnvelopeHash: CLEANUP85_ENVELOPE, cleanupEnvelope: f.op.effects[2]!.envelope, cleanupMaterialHash: CLEANUP85_MATERIAL, cleanupIntentHash: null, cleanupProof, cancellation: null, ...f.parent.consumedBurn! } } as const;
  const proof: CircleNonceRetirementProof = { ...body, proofHash: hashObject(body) }; return { root, ...f, proof };
}
test("valid-shaped durable proof and forged private token cannot release five real holds", async t => {
  const f = await fixture(); t.after(() => rm(f.root, { recursive: true, force: true })); validateCleanup85RecoveryProof(f.proof, f.op);
  await new Cleanup85RecoveryStore(f.root).createPublicRecord(f.op, "observed-original-proof", f.proof);
  const usage = new CircleUsage(f.state, () => Date.parse("2026-10-09T12:00:00Z"));
  await assert.rejects(usage.closeCleanup85Recovery(f.op, f.proof, { kind: "verified-cleanup85-settlement" }), /private_cleanup85_settlement_required/);
  for (const row of f.op.usage) assert.deepEqual(await new AssetUsageLedger(f.root).load(row, row.reservationId), row);
  await assert.rejects(consumeCleanup85Settlement({ kind: "verified-cleanup85-settlement" }, f.state, f.op, f.proof), /private_cleanup85/);
});
test("canonical receipt absence cannot mint opaque settlement even with valid durable JSON", async t => {
  const f = await fixture(); t.after(() => rm(f.root, { recursive: true, force: true })); let sends = 0;
  const source = new CircleRpc("https://example.org", 42161, { request: async (_url, _method, body) => { const q = JSON.parse(body!); if (q.method === "eth_sendRawTransaction") sends++; return { status: 200, body: JSON.stringify({ jsonrpc: "2.0", id: q.id, result: q.method === "eth_chainId" ? "0xa4b1" : null }) }; } });
  await assert.rejects(verifyCleanup85Settlement(f.state, f.op, f.proof, source), /canonical_receipt_required/); assert.equal(sends, 0);
  for (const row of f.op.usage) assert.deepEqual(await new AssetUsageLedger(f.root).load(row, row.reservationId), row);
});
for (const field of ["zero_head", "nonce", "fee", "intent", "unknown_version"] as const) test(`recomputed versioned JSON rejects ${field}`, async t => {
  const f = await fixture(); t.after(() => rm(f.root, { recursive: true, force: true })); const body = structuredClone(f.proof); const p = body.cleanup85Recovery!;
  if (field === "zero_head") Object.assign(p.cleanupProof, { finalityBlockHash: "0x" + "0".repeat(64) });
  if (field === "nonce") Object.assign(body, { finalizedNonceAtomic: "87" });
  if (field === "fee") { Object.assign(body, { actualCleanupFeeAtomic: "15000000000001" }); Object.assign(p.cleanupProof, { actualFeeAtomic: "15000000000001" }); }
  if (field === "intent") Object.assign(p, { cleanupIntentHash: "a".repeat(64) }); if (field === "unknown_version") Object.assign(p, { version: "arbitrary" });
  const { proofHash: _hash, ...unsigned } = body; assert.throws(() => validateCleanup85RecoveryProof({ ...unsigned, proofHash: hashObject(unsigned) }, f.op));
});
test("first sanitized RPC failure survives later observer error and excludes material", async t => {
  const f = await fixture(); t.after(() => rm(f.root, { recursive: true, force: true })); const store = new CirclePublicFailureStore(f.root);
  await store.record(f.op, "cleanup", new ApnError("APN_RPC_CONFIG", "failed", { method: "eth_getBalance", origin: "https://example.org", status: 503, stage: "response", rawTransaction: "SECRET", params: ["SECRET"] })); const first = await store.read(f.op);
  await store.record(f.op, "cleanup", new ApnError("APN_RPC_PROTOCOL", "later", { method: "eth_call" })); assert.deepEqual(await store.read(f.op), first);
  const wire = await readFile(join(f.root, "circle-public-failures", f.op.operationId + ".json"), "utf8"); assert.ok(!wire.includes("SECRET")); assert.match(wire, /eth_getBalance/); assert.match(wire, /503/);
});

test("terminal status is audit-only while finite canonical observe still requires fresh proof", async t => {
  const f = await fixture(); t.after(() => rm(f.root, { recursive: true, force: true }));
  // A synthetic completed journal, not a claim that this future cleanup receipt exists publicly.
  const rows = f.op.usage.map((row, index) => { const { reservationDigest: _digest, ...body } = row; return sealUsage({ ...body, updatedAt: "2026-10-09T12:00:00.000Z", effectAt: "2026-10-09T12:00:00.000Z", state: "failed_confirmed_revert" as const, consumedAtomic: index === 1 ? "1116903336000" : index === 3 ? "1234" : "0", outcomeDigest: hashObject({ version: "apn.circle-cleanup85-retirement-usage.v1", proofHash: f.proof.proofHash, operationId: f.op.operationId, reservationId: row.reservationId, index }) }); });
  const closed = advanceCircle(f.op, { usage: rows, usageFinalized: true, residualAllowanceAtomic: "0", state: "nonce_retired", terminal: true, nonceRetirement: f.proof }, "cleanup85_observed_onchain_original_finalized_retirement", Date.parse("2026-10-09T12:00:00Z"));
  await f.write("circle-v2-evm", f.op.operationId + ".json", closed); await new Cleanup85RecoveryStore(f.root).createPublicRecord(closed, "observed-original-proof", f.proof); let rpc = 0, privateCalls = 0, tty = 0;
  const service = new CircleEvmService(f.state, { load: async () => { privateCalls++; throw new Error("no key"); } } as never, {}, Date.now, { openTerminal: async () => { tty++; throw new Error("no TTY"); } }, { request: async () => { rpc++; throw new Error("later account nonce90/balance57824 does not reopen historical terminal"); } });
  assert.equal((await service.status(f.op.operationId)).state, "nonce_retired"); assert.deepEqual([rpc, privateCalls, tty], [0, 0, 0]);
  await assert.rejects(service.observe(f.op.operationId), /later account nonce90/); assert.deepEqual([rpc, privateCalls, tty], [1, 0, 0]);
  assert.equal(await readFile(join(f.root, "circle-v2-evm", f.op.operationId + ".json"), "utf8"), canonicalJson(closed));
});

for (const drift of ["reservation_id", "profile", "policy", "outcome", "custody", "recipient"] as const) test(`settlement issuer rejects caller ${drift} before any public or ledger authority`, async t => {
  const f = await fixture(); t.after(() => rm(f.root, { recursive: true, force: true })); const supplied = structuredClone(f.op); let requests = 0;
  if (drift === "reservation_id") Object.assign(supplied.usage[0]!, { reservationId: "f".repeat(64) });
  if (drift === "profile") Object.assign(supplied, { profile: "foreign-owner-profile" });
  if (drift === "policy") Object.assign(supplied.policies[0]!, { policyDigest: "f".repeat(64) });
  if (drift === "outcome") Object.assign(supplied.usage[0]!, { consumedAtomic: "40100", outcomeDigest: "f".repeat(64) });
  if (drift === "custody") Object.assign(supplied.sourceCustody, { keyReference: "foreign-key" });
  if (drift === "recipient") Object.assign(supplied.destinationCustody, { walletAddress: "0x1111111111111111111111111111111111111111" });
  const source = new CircleRpc("https://example.org", 42161, { request: async () => { requests++; throw new Error("no public oracle reached"); } });
  await assert.rejects(verifyCleanup85Settlement(f.state, supplied, f.proof, source), /durable_operation_changed/); assert.equal(requests, 0);
  for (const row of f.op.usage) assert.deepEqual(await new AssetUsageLedger(f.root).load(row, row.reservationId), row);
});
