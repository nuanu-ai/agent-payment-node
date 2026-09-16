import assert from "node:assert/strict";
import test from "node:test";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { privateKeyToAccount } from "viem/accounts";
import { parseTransaction, serializeTransaction } from "viem";
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
  route: "base_usdc_to_solana_usdc_circle_cctp_v2", createdAt: at(0), maxSourceNativeDebitWei: "1000000000000000",
  sourceCall: { chainId: 8453, from: account.address, to: BASE_CCTP_V2_TOKEN_MESSENGER_WITH_FEES,
    valueAtomic: "0", data, dataSha256: sha256(Buffer.from(data.slice(2), "hex")),
    type: "eip1559", nonceAtomic: "7", gasLimitAtomic: "100000",
    maxFeePerGasAtomic: "1000000000", maxPriorityFeePerGasAtomic: "1000000", accessList: [] },
  admissionProof: { kind: "synthetic_untrusted", claimedValidationHash: "d".repeat(64), note: "offline fixture only" },
};
async function signed(nonce: number, input: `0x${string}` = data, gas = 100000n, maxFeePerGas = 1000000000n) {
  return account.signTransaction({ chainId: 8453, to: BASE_CCTP_V2_TOKEN_MESSENGER_WITH_FEES,
    data: input, value: 0n, nonce, gas, maxFeePerGas,
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
  j = await repo.seal(j.profileHash, j.operationId, j.integrityHash, await signed(7), "7", at(2));
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

test("two operation IDs cannot reserve the same sender and nonce or replay the same raw transaction", async t => {
  const tmp = await temporaryState(); t.after(tmp.cleanup);
  const a = new NonEvmSourceJournalRepository(tmp.root), b = new NonEvmSourceJournalRepository(tmp.root);
  let one = await a.stage(binding);
  let two = await b.stage({ ...binding, operationId: "e".repeat(64), draftIntegrityHash: "f".repeat(64) });
  one = await a.signingStarted(one.profileHash, one.operationId, one.integrityHash, at(1));
  two = await b.signingStarted(two.profileHash, two.operationId, two.integrityHash, at(1));
  const raw = await signed(7);
  const outcomes = await Promise.allSettled([
    a.seal(one.profileHash, one.operationId, one.integrityHash, raw, "7", at(2)),
    b.seal(two.profileHash, two.operationId, two.integrityHash, raw, "7", at(2)),
  ]);
  assert.equal(outcomes.filter(r => r.status === "fulfilled").length, 1);
  assert.equal(outcomes.filter(r => r.status === "rejected").length, 1);
  const winner = outcomes.find(r => r.status === "fulfilled") as PromiseFulfilledResult<typeof one>;
  const loser = outcomes.find(r => r.status === "rejected") as PromiseRejectedResult;
  assert.equal((loser.reason as { code: string }).code, "APN_OPERATION_BLOCKED");
  const recorded = await new NonEvmSourceJournalRepository(tmp.root).load(winner.value.profileHash, winner.value.operationId);
  assert.equal(recorded?.phase, "sealed");
  const losing = await b.load(binding.profileHash, winner.value.operationId === one.operationId ? two.operationId : one.operationId);
  assert.equal(losing?.phase, "signing_started");
  await assert.rejects(b.seal(losing!.profileHash, losing!.operationId, losing!.integrityHash, raw, "7", at(2)),
    { code: "APN_OPERATION_BLOCKED" });
});

test("reservation survives an interrupted seal write and cannot be taken by another operation", async t => {
  const tmp = await temporaryState(); t.after(tmp.cleanup);
  class Interrupted extends NonEvmSourceJournalRepository {
    protected override async writeJson(path: string, value: unknown): Promise<void> {
      if (path.startsWith("non-evm-source-journals/") &&
        (value as { phase?: string }).phase === "sealed") throw new Error("simulated crash after reservation");
      await super.writeJson(path, value);
    }
  }
  const interrupted = new Interrupted(tmp.root), other = new NonEvmSourceJournalRepository(tmp.root);
  let one = await interrupted.stage(binding);
  let two = await other.stage({ ...binding, operationId: "e".repeat(64), draftIntegrityHash: "f".repeat(64) });
  one = await interrupted.signingStarted(one.profileHash, one.operationId, one.integrityHash, at(1));
  two = await other.signingStarted(two.profileHash, two.operationId, two.integrityHash, at(1));
  const raw = await signed(7);
  await assert.rejects(interrupted.seal(one.profileHash, one.operationId, one.integrityHash, raw, "7", at(2)),
    /simulated crash/);
  assert.equal((await other.load(one.profileHash, one.operationId))?.phase, "signing_started");
  await assert.rejects(other.seal(two.profileHash, two.operationId, two.integrityHash, raw, "7", at(2)),
    { code: "APN_OPERATION_BLOCKED" });
  const recovered = await other.seal(one.profileHash, one.operationId, one.integrityHash, raw, "7", at(2));
  assert.equal(recovered.phase, "sealed");
});

test("seal rejects legacy, EIP-2930, alternate economics, access list and nonce", async t => {
  const tmp = await temporaryState(); t.after(tmp.cleanup);
  const repo = new NonEvmSourceJournalRepository(tmp.root);
  let j = await repo.stage(binding);
  j = await repo.signingStarted(j.profileHash, j.operationId, j.integrityHash, at(1));
  const legacy = await account.signTransaction({ type: "legacy", chainId: 8453,
    to: BASE_CCTP_V2_TOKEN_MESSENGER_WITH_FEES, data, value: 0n, nonce: 7, gas: 100000n, gasPrice: 1000000000n });
  const eip2930 = await account.signTransaction({ type: "eip2930", chainId: 8453,
    to: BASE_CCTP_V2_TOKEN_MESSENGER_WITH_FEES, data, value: 0n, nonce: 7, gas: 100000n,
    gasPrice: 1000000000n, accessList: [] });
  const accessList = await account.signTransaction({ type: "eip1559", chainId: 8453,
    to: BASE_CCTP_V2_TOKEN_MESSENGER_WITH_FEES, data, value: 0n, nonce: 7, gas: 100000n,
    maxFeePerGas: 1000000000n, maxPriorityFeePerGas: 1000000n,
    accessList: [{ address: BASE_CCTP_V2_TOKEN_MESSENGER_WITH_FEES, storageKeys: [] }] });
  for (const raw of [legacy, eip2930, await signed(7, data, 100001n),
    await signed(7, data, 100000n, 1000000001n), accessList, await signed(8)]) {
    await assert.rejects(repo.seal(j.profileHash, j.operationId, j.integrityHash, raw, "7", at(2)),
      { code: "APN_STATE_CORRUPT" });
  }
  assert.equal((await repo.load(j.profileHash, j.operationId))?.phase, "signing_started");
});

test("seal rejects a high-s malleated EIP-1559 signature", async t => {
  const tmp = await temporaryState(); t.after(tmp.cleanup);
  const repo = new NonEvmSourceJournalRepository(tmp.root);
  let j = await repo.stage(binding);
  j = await repo.signingStarted(j.profileHash, j.operationId, j.integrityHash, at(1));
  const tx = parseTransaction(await signed(7));
  const curveOrder = 0xfffffffffffffffffffffffffffffffebaaedce6af48a03bbfd25e8cd0364141n;
  const highS = `0x${(curveOrder - BigInt(tx.s!)).toString(16)}` as `0x${string}`;
  const altered = serializeTransaction(tx, { r: tx.r!, s: highS, yParity: tx.yParity === 0 ? 1 : 0 });
  await assert.rejects(repo.seal(j.profileHash, j.operationId, j.integrityHash, altered, "7", at(2)),
    { code: "APN_STATE_CORRUPT" });
  assert.equal((await repo.load(j.profileHash, j.operationId))?.phase, "signing_started");
});
