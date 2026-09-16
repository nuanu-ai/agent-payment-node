import assert from "node:assert/strict";
import test from "node:test";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { privateKeyToAccount } from "viem/accounts";
import { hashObject, sha256 } from "../../src/canonical.js";
import { BASE_CCTP_V2_TOKEN_MESSENGER_WITH_FEES } from "../../src/lifi/circle-v2-source-receipt.js";
import { NonEvmSourceJournalRepository, validateNonEvmSourceJournal,
  type NonEvmSourceBinding } from "../../src/lifi/non-evm-source-journal.js";
import { temporaryState } from "./helpers.js";

const account = privateKeyToAccount(`0x${"11".repeat(32)}`);
const data = "0xc62fa55e" as const;
const at = (n: number) => `2026-09-16T00:00:0${n}.000Z`;
const binding: NonEvmSourceBinding = {
  profileHash: "a".repeat(64), operationId: "b".repeat(64), draftIntegrityHash: "c".repeat(64),
  route: "base_usdc_to_solana_usdc_circle_cctp_v2", createdAt: at(0),
  sourceCall: { chainId: 8453, from: account.address, to: BASE_CCTP_V2_TOKEN_MESSENGER_WITH_FEES,
    valueAtomic: "0", data, dataSha256: sha256(Buffer.from(data.slice(2), "hex")) },
  admissionProof: { kind: "synthetic_untrusted", claimedValidationHash: "d".repeat(64), note: "offline fixture only" },
};
async function signed(nonce: number, input: `0x${string}` = data) {
  return account.signTransaction({ chainId: 8453, to: BASE_CCTP_V2_TOKEN_MESSENGER_WITH_FEES,
    data: input, value: 0n, nonce, gas: 100000n, maxFeePerGas: 1000000000n,
    maxPriorityFeePerGas: 1000000n, type: "eip1559" });
}

test("journal survives restart and preserves the committed one-send boundary", async t => {
  const tmp = await temporaryState(); t.after(tmp.cleanup);
  const first = new NonEvmSourceJournalRepository(tmp.root);
  let j = await first.stage(binding);
  assert.equal(j.executionAdmitted, false);
  j = await first.signingStarted(j.profileHash, j.operationId, j.integrityHash, at(1));
  assert.equal((await new NonEvmSourceJournalRepository(tmp.root).load(j.profileHash, j.operationId))?.phase, "signing_started");
  j = await first.seal(j.profileHash, j.operationId, j.integrityHash, await signed(7), "7", at(2));
  j = await first.committingSubmission(j.profileHash, j.operationId, j.integrityHash, at(3));
  assert.equal(j.submissionAttempts, 1);
  const restarted = new NonEvmSourceJournalRepository(tmp.root);
  assert.equal((await restarted.load(j.profileHash, j.operationId))?.phase, "submitting");
  await assert.rejects(restarted.committingSubmission(j.profileHash, j.operationId, j.integrityHash, at(4)), { code: "APN_OPERATION_BLOCKED" });
  j = await restarted.observeUnknown(j.profileHash, j.operationId, j.integrityHash, "response_lost", at(4));
  assert.equal(j.phase, "unknown_finality");
  assert.equal(j.submissionAttempts, 1);
  await assert.rejects(restarted.committingSubmission(j.profileHash, j.operationId, j.integrityHash, at(5)), { code: "APN_OPERATION_BLOCKED" });
});

test("concurrent workers admit one transition; replay and changed source binding fail", async t => {
  const tmp = await temporaryState(); t.after(tmp.cleanup);
  const a = new NonEvmSourceJournalRepository(tmp.root), b = new NonEvmSourceJournalRepository(tmp.root);
  const j = await a.stage(binding);
  const results = await Promise.allSettled([
    a.signingStarted(j.profileHash, j.operationId, j.integrityHash, at(1)),
    b.signingStarted(j.profileHash, j.operationId, j.integrityHash, at(1)),
  ]);
  assert.equal(results.filter(r => r.status === "fulfilled").length, 1);
  assert.equal(results.filter(r => r.status === "rejected").length, 1);
  await assert.rejects(a.stage({ ...binding, sourceCall: { ...binding.sourceCall, data: "0xc62fa55e00",
    dataSha256: sha256(Buffer.from("c62fa55e00", "hex")) } }), { code: "APN_STATE_CORRUPT" });
  await assert.rejects(a.stage({ ...binding, draftIntegrityHash: "e".repeat(64) }), { code: "APN_STATE_CORRUPT" });
});

test("seal rejects wrong calldata and signer; persisted hash mismatch is corrupt", async t => {
  const tmp = await temporaryState(); t.after(tmp.cleanup);
  const repo = new NonEvmSourceJournalRepository(tmp.root);
  let j = await repo.stage(binding);
  j = await repo.signingStarted(j.profileHash, j.operationId, j.integrityHash, at(1));
  await assert.rejects(repo.seal(j.profileHash, j.operationId, j.integrityHash, await signed(7, "0xc62fa55e00"), "7", at(2)), { code: "APN_STATE_CORRUPT" });
  const other = privateKeyToAccount(`0x${"22".repeat(32)}`);
  const wrongSigner = await other.signTransaction({ chainId: 8453, to: BASE_CCTP_V2_TOKEN_MESSENGER_WITH_FEES,
    data, value: 0n, nonce: 7, gas: 100000n, maxFeePerGas: 1000000000n,
    maxPriorityFeePerGas: 1000000n, type: "eip1559" });
  await assert.rejects(repo.seal(j.profileHash, j.operationId, j.integrityHash, wrongSigner, "7", at(2)), { code: "APN_STATE_CORRUPT" });
  assert.equal((await repo.load(j.profileHash, j.operationId))?.phase, "signing_started");
  j = await repo.seal(j.profileHash, j.operationId, j.integrityHash, await signed(7), "7", at(2));
  const file = join(tmp.root, "non-evm-source-journals", j.profileHash, `${j.operationId}.json`);
  const raw = JSON.parse(await readFile(file, "utf8")); raw.transactionHash = `0x${"f".repeat(64)}`;
  await writeFile(file, `${JSON.stringify(raw)}\n`);
  await assert.rejects(repo.load(j.profileHash, j.operationId), { code: "APN_STATE_CORRUPT" });
  assert.throws(() => validateNonEvmSourceJournal({ ...j, executionAdmitted: true,
    integrityHash: hashObject({ ...j, executionAdmitted: true }) }), { code: "APN_STATE_CORRUPT" });
});

test("safe Base source receipt is source-only; reorg returns to observe-only", async t => {
  const tmp = await temporaryState(); t.after(tmp.cleanup);
  const repo = new NonEvmSourceJournalRepository(tmp.root);
  let j = await repo.stage(binding);
  j = await repo.signingStarted(j.profileHash, j.operationId, j.integrityHash, at(1));
  j = await repo.seal(j.profileHash, j.operationId, j.integrityHash, await signed(7), "7", at(2));
  j = await repo.committingSubmission(j.profileHash, j.operationId, j.integrityHash, at(3));
  j = await repo.observePending(j.profileHash, j.operationId, j.integrityHash, at(4));
  const proof = { provenance: "synthetic_untrusted" as const, transactionHash: j.transactionHash!, status: "success" as const,
    blockNumberAtomic: "10", blockHash: `0x${"1".repeat(64)}`,
    safeBlockNumberAtomic: "12", safeBlockHash: `0x${"2".repeat(64)}`, observedAt: at(5) };
  await assert.rejects(repo.observeSafeSource(j.profileHash, j.operationId, j.integrityHash,
    { ...proof, transactionHash: `0x${"3".repeat(64)}` }, at(5)), { code: "APN_STATE_CORRUPT" });
  j = await repo.observeSafeSource(j.profileHash, j.operationId, j.integrityHash, proof, at(5));
  assert.equal(j.phase, "source_confirmed"); assert.equal(j.executionAdmitted, false);
  assert.equal("destinationProof" in j, false);
  j = await repo.observeUnknown(j.profileHash, j.operationId, j.integrityHash, "safe_block_reorg", at(6));
  assert.equal(j.phase, "unknown_finality"); assert.equal(j.safeSourceProof, null);
});

test("safe source revert remains source-only and cannot be replayed as success", async t => {
  const tmp = await temporaryState(); t.after(tmp.cleanup);
  const repo = new NonEvmSourceJournalRepository(tmp.root);
  let j = await repo.stage(binding);
  j = await repo.signingStarted(j.profileHash, j.operationId, j.integrityHash, at(1));
  j = await repo.seal(j.profileHash, j.operationId, j.integrityHash, await signed(8), "8", at(2));
  j = await repo.committingSubmission(j.profileHash, j.operationId, j.integrityHash, at(3));
  j = await repo.observeSafeSource(j.profileHash, j.operationId, j.integrityHash, {
    provenance: "synthetic_untrusted", transactionHash: j.transactionHash!, status: "reverted", blockNumberAtomic: "20",
    blockHash: `0x${"4".repeat(64)}`, safeBlockNumberAtomic: "21",
    safeBlockHash: `0x${"5".repeat(64)}`, observedAt: at(4),
  }, at(4));
  assert.equal(j.phase, "source_reverted"); assert.equal(j.submissionAttempts, 1);
  await assert.rejects(repo.observeSafeSource(j.profileHash, j.operationId, j.integrityHash,
    { ...j.safeSourceProof!, status: "success" }, at(5)), { code: "APN_OPERATION_BLOCKED" });
});
