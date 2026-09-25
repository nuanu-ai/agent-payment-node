import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import test from "node:test";
import { privateKeyToAccount } from "viem/accounts";
import type { Hex } from "viem";
import { hashObject } from "../../src/canonical.js";
import { sealAssetPolicyRegistry } from "../../src/asset-policy-registry.js";
import { ArbitrumSourceEffectJournalRepository, advanceArbitrumSourceEffectJournal,
  arbitrumSourceRecoveryClass, createArbitrumSourceEffectJournal, validateArbitrumSourceEffectJournal } from
  "../../src/relay/arbitrum-source-effect-journal.js";
import { RELAY_ARBITRUM_USDC } from "../../src/relay/arbitrum-usdc-ethereum-quote.js";
import { RELAY_ARBITRUM_SOURCE_DRAFT_REFERENCE } from "../../src/relay/arbitrum-usdc-source-draft.js";
import { RelayUnsignedPrepareService } from "../../src/relay/prepare.js";
import { RelayUnsignedOperationRepository, freezeRelayUnsignedOperation } from "../../src/relay-unsigned-operation.js";
import { StateStore } from "../../src/state.js";
import { temporaryState } from "./helpers.js";

const owner = "0x0B4Dd0C3dA001Fa146EEd3f80B01860BEF6B8a14";
const now = new Date(1790347296 * 1000);
const t0 = now.toISOString();
const t1 = new Date(now.getTime() + 1000).toISOString();
const quoteFile = resolve("tests/core/relay-fixtures/arbitrum-usdc-ethereum-usdc-quote-20260925.json");
const account = privateKeyToAccount(`0x${"1".repeat(64)}`);
function active() {
  const registry = sealAssetPolicyRegistry({ schemaVersion: "apn.asset-policy-registry.v2",
    registryVersion: "test.relay.arb.effects.1", publishedAt: "2026-09-25T00:00:00.000Z",
    effectiveDate: "2026-09-25", effectiveAt: "2026-09-25T00:00:00.000Z",
    expiresAt: "2026-10-03T00:00:00.000Z", chains: [{ chain: "eip155:42161", family: "evm",
      name: "Arbitrum One", assets: [{ kind: "token", identifier: RELAY_ARBITRUM_USDC, symbol: "USDC", decimals: 6,
        rails: { direct: false, gasless: false, x402: false, bridge: true, swap: false },
        railCaps: { bridge: { maximumPerTransferAtomic: "1000000", dailyLimitAtomic: "2000000" } },
        mechanismPins: { bridge: { provider: "relay", reference: RELAY_ARBITRUM_SOURCE_DRAFT_REFERENCE } } }] }] });
  return { profile: "default", registry, digest: registry.policyDigest, revision: 1,
    accounts: { evm: owner }, activationDigest: "a".repeat(64), activatedAt: t0 };
}
async function prepared() {
  const temporary = await temporaryState();
  const state = new StateStore(temporary.root);
  const service = new RelayUnsignedPrepareService(state, { now: () => now }, undefined,
    { activePolicy: async () => active(), dailyUsage: async () => "0" });
  const publicOp = await service.prepareArbitrum({ profile: "default", owner, amountAtomic: "500000",
    minOutputAtomic: "94065", maxProviderFeeAtomic: "401482", maxApprovalNetworkFeeWei: "2000000000000",
    maxDepositNetworkFeeWei: "2000000000000", quoteFile, idempotencyKey: "relay-arb-effects-0001" });
  const op = await new RelayUnsignedOperationRepository(temporary.root).loadOperation(
    state.profileHash("default"), publicOp.operationId);
  assert.ok(op);
  return { temporary, state, op };
}
function syntheticSignerOp(real: NonNullable<Awaited<ReturnType<typeof prepared>>["op"]>) {
  const rawQuote = structuredClone(real.arbitrumDraft!.rawQuote) as any;
  for (const step of rawQuote.steps) step.items[0].data.from = account.address;
  const draftBody = { ...real.arbitrumDraft!, owner: account.address.toLowerCase(), rawQuote };
  const { integrityHash: _draftHash, ...restDraft } = draftBody;
  const draft = { ...restDraft, integrityHash: hashObject(restDraft) };
  const { integrityHash: _operationHash, ...operationBody } = real;
  return freezeRelayUnsignedOperation({ ...operationBody, sourceAccount: account.address.toLowerCase(), arbitrumDraft: draft });
}
async function sign(op: ReturnType<typeof syntheticSignerOp>, role: "approval" | "deposit", nonce: number) {
  const raw = op.arbitrumDraft!.rawQuote as any;
  const envelope = raw.steps[role === "approval" ? 0 : 1].items[0].data;
  return account.signTransaction({ type: "eip1559", chainId: 42161, nonce,
    to: envelope.to as Hex, data: envelope.data as Hex, value: 0n, gas: BigInt(envelope.gas),
    maxFeePerGas: BigInt(envelope.maxFeePerGas), maxPriorityFeePerGas: BigInt(envelope.maxPriorityFeePerGas) });
}

test("offline journal seals exact signed approval/deposit, marks send first, and never retries uncertain attempts", async t => {
  const { temporary, op: real } = await prepared(); t.after(temporary.cleanup);
  const op = syntheticSignerOp(real);
  let j = await createArbitrumSourceEffectJournal(op, t0);
  assert.equal(await arbitrumSourceRecoveryClass(j, op), "not_started");
  await assert.rejects(advanceArbitrumSourceEffectJournal(j, op,
    { kind: "begin_signing", role: "deposit", marker: "a".repeat(64), at: t1 }), { code: "APN_OPERATION_BLOCKED" });
  j = await advanceArbitrumSourceEffectJournal(j, op,
    { kind: "begin_signing", role: "approval", marker: "a".repeat(64), at: t1 });
  assert.equal(await arbitrumSourceRecoveryClass(j, op), "observation_only");
  await assert.rejects(advanceArbitrumSourceEffectJournal(j, op,
    { kind: "begin_signing", role: "approval", marker: "b".repeat(64), at: t1 }), { code: "APN_OPERATION_BLOCKED" });
  const approvalRaw = await sign(op, "approval", 7);
  const approvalEnvelope = (op.arbitrumDraft!.rawQuote as any).steps[0].items[0].data;
  const wrongTarget = await account.signTransaction({ type: "eip1559", chainId: 42161, nonce: 7,
    to: owner as Hex, data: approvalEnvelope.data as Hex, value: 0n, gas: BigInt(approvalEnvelope.gas),
    maxFeePerGas: BigInt(approvalEnvelope.maxFeePerGas), maxPriorityFeePerGas: 0n });
  await assert.rejects(advanceArbitrumSourceEffectJournal(j, op,
    { kind: "seal_signed", role: "approval", rawTransaction: wrongTarget, nonce: "7" }), { code: "APN_STATE_CORRUPT" });
  const wrongChain = await account.signTransaction({ type: "eip1559", chainId: 1, nonce: 7,
    to: approvalEnvelope.to as Hex, data: approvalEnvelope.data as Hex, value: 0n, gas: BigInt(approvalEnvelope.gas),
    maxFeePerGas: BigInt(approvalEnvelope.maxFeePerGas), maxPriorityFeePerGas: 0n });
  await assert.rejects(advanceArbitrumSourceEffectJournal(j, op,
    { kind: "seal_signed", role: "approval", rawTransaction: wrongChain, nonce: "7" }), { code: "APN_STATE_CORRUPT" });
  const wrongSigner = await privateKeyToAccount(`0x${"2".repeat(64)}`).signTransaction({ type: "eip1559",
    chainId: 42161, nonce: 7, to: approvalEnvelope.to as Hex, data: approvalEnvelope.data as Hex,
    value: 0n, gas: BigInt(approvalEnvelope.gas), maxFeePerGas: BigInt(approvalEnvelope.maxFeePerGas),
    maxPriorityFeePerGas: 0n });
  await assert.rejects(advanceArbitrumSourceEffectJournal(j, op,
    { kind: "seal_signed", role: "approval", rawTransaction: wrongSigner, nonce: "7" }), { code: "APN_STATE_CORRUPT" });
  const exactTransaction = { type: "eip1559" as const, chainId: 42161, nonce: 7,
    to: approvalEnvelope.to as Hex, data: approvalEnvelope.data as Hex, value: 0n,
    gas: BigInt(approvalEnvelope.gas), maxFeePerGas: BigInt(approvalEnvelope.maxFeePerGas),
    maxPriorityFeePerGas: 0n };
  const mutations = [
    { label: "calldata", fields: { data: "0x095ea7b3" as Hex } },
    { label: "value", fields: { value: 1n } },
    { label: "gas limit", fields: { gas: exactTransaction.gas + 1n } },
    { label: "max fee", fields: { maxFeePerGas: exactTransaction.maxFeePerGas + 1n } },
    { label: "priority fee", fields: { maxPriorityFeePerGas: 1n } },
  ] as const;
  for (const mutation of mutations) {
    const rawTransaction = await account.signTransaction({ ...exactTransaction, ...mutation.fields });
    await assert.rejects(advanceArbitrumSourceEffectJournal(j, op,
      { kind: "seal_signed", role: "approval", rawTransaction, nonce: "7" }),
    { code: "APN_STATE_CORRUPT" }, mutation.label);
  }
  await assert.rejects(advanceArbitrumSourceEffectJournal(j, op,
    { kind: "seal_signed", role: "approval", rawTransaction: approvalRaw, nonce: "8" }), { code: "APN_STATE_CORRUPT" });
  j = await advanceArbitrumSourceEffectJournal(j, op,
    { kind: "seal_signed", role: "approval", rawTransaction: approvalRaw, nonce: "7" });
  await assert.rejects(advanceArbitrumSourceEffectJournal(j, op,
    { kind: "record_send", role: "approval", outcome: "accepted" }), { code: "APN_OPERATION_BLOCKED" });
  j = await advanceArbitrumSourceEffectJournal(j, op, { kind: "mark_submitting", role: "approval", at: t1 });
  assert.equal(await arbitrumSourceRecoveryClass(j, op), "observation_only");
  await assert.rejects(advanceArbitrumSourceEffectJournal(j, op,
    { kind: "mark_submitting", role: "approval", at: t1 }), { code: "APN_OPERATION_BLOCKED" });
  j = await advanceArbitrumSourceEffectJournal(j, op,
    { kind: "record_send", role: "approval", outcome: "uncertain" });
  assert.equal(j.effects[0].phase, "unknown_finality");
  await assert.rejects(advanceArbitrumSourceEffectJournal(j, op,
    { kind: "begin_signing", role: "deposit", marker: "b".repeat(64), at: t1 }), { code: "APN_OPERATION_BLOCKED" });
  j = await advanceArbitrumSourceEffectJournal(j, op,
    { kind: "record_verified_observation", role: "approval", outcome: "confirmed", proofDigest: "c".repeat(64) });
  assert.equal(await arbitrumSourceRecoveryClass(j, op), "approval_confirmed");
  j = await advanceArbitrumSourceEffectJournal(j, op,
    { kind: "begin_signing", role: "deposit", marker: "d".repeat(64), at: t1 });
  const depositRaw = await sign(op, "deposit", 8);
  await assert.rejects(advanceArbitrumSourceEffectJournal(j, op,
    { kind: "seal_signed", role: "deposit", rawTransaction: depositRaw, nonce: "7" }), { code: "APN_STATE_CORRUPT" });
  j = await advanceArbitrumSourceEffectJournal(j, op,
    { kind: "seal_signed", role: "deposit", rawTransaction: depositRaw, nonce: "8" });
  j = await advanceArbitrumSourceEffectJournal(j, op, { kind: "mark_submitting", role: "deposit", at: t1 });
  j = await advanceArbitrumSourceEffectJournal(j, op,
    { kind: "record_send", role: "deposit", outcome: "accepted" });
  assert.equal(await arbitrumSourceRecoveryClass(j, op), "observation_only");
  const tampered = structuredClone(j) as any;
  tampered.effects[1].attempt.rawTransaction = approvalRaw;
  const { integrityHash: _hash, ...body } = tampered; tampered.integrityHash = hashObject(body);
  await assert.rejects(validateArbitrumSourceEffectJournal(tampered, op), { code: "APN_STATE_CORRUPT" });
  const wrongHash = structuredClone(j) as any;
  wrongHash.effects[1].attempt.transactionHash = `0x${"f".repeat(64)}`;
  const { integrityHash: _wrongHash, ...wrongHashBody } = wrongHash;
  wrongHash.integrityHash = hashObject(wrongHashBody);
  await assert.rejects(validateArbitrumSourceEffectJournal(wrongHash, op), { code: "APN_STATE_CORRUPT" });
  j = await advanceArbitrumSourceEffectJournal(j, op,
    { kind: "record_verified_observation", role: "deposit", outcome: "confirmed", proofDigest: "e".repeat(64) });
  assert.equal(await arbitrumSourceRecoveryClass(j, op), "completed");
});

test("repository binds saved operation and CAS, detects corruption even with recalculated journal hash", async t => {
  const { temporary, state, op } = await prepared(); t.after(temporary.cleanup);
  const repository = new ArbitrumSourceEffectJournalRepository(temporary.root);
  const j = await repository.create(op.profileHash, op.operationId, t0);
  assert.deepEqual(await repository.load(op.profileHash, op.operationId), j);
  await assert.rejects(repository.create(op.profileHash, op.operationId, t0), { code: "APN_OPERATION_BLOCKED" });
  const marked = await repository.beginSigning(op.profileHash, op.operationId, j.integrityHash, "approval", t1);
  assert.equal(marked.effects[0].phase, "signing_started");
  await assert.rejects(repository.transition(op.profileHash, op.operationId, marked.integrityHash,
    { kind: "record_verified_observation", role: "approval", outcome: "confirmed", proofDigest: "c".repeat(64) }),
    { code: "APN_OPERATION_BLOCKED" });
  await assert.rejects(repository.beginSigning(op.profileHash, op.operationId, j.integrityHash, "approval", t1),
    { code: "APN_OPERATION_BLOCKED" });
  assert.equal(await arbitrumSourceRecoveryClass((await new ArbitrumSourceEffectJournalRepository(temporary.root)
    .load(op.profileHash, op.operationId))!, op), "observation_only");
  const path = join(temporary.root, "relay-arbitrum-source-effect-journals", state.profileHash("default"),
    `${op.operationId}.json`);
  const forged = JSON.parse(await readFile(path, "utf8")) as any;
  forged.owner = account.address.toLowerCase();
  const { integrityHash: _hash, ...body } = forged; forged.integrityHash = hashObject(body);
  await writeFile(path, JSON.stringify(forged), { mode: 0o600 });
  await assert.rejects(repository.load(op.profileHash, op.operationId), { code: "APN_STATE_CORRUPT" });
});

test("repository persists only an injected verified observation and reopens its proof binding", async t => {
  const { temporary, op: real } = await prepared(); t.after(temporary.cleanup);
  const op = syntheticSignerOp(real);
  // The synthetic owner has a test key; the production loader remains unchanged and strict.
  const syntheticRepository = (verifier?: ConstructorParameters<typeof ArbitrumSourceEffectJournalRepository>[1]) => {
    const repository = new ArbitrumSourceEffectJournalRepository(temporary.root, verifier);
    (repository as any).operations = { loadOperation: async () => op };
    return repository;
  };
  const withoutProof = syntheticRepository();
  let j = await withoutProof.create(op.profileHash, op.operationId, t0);
  j = await withoutProof.beginSigning(op.profileHash, op.operationId, j.integrityHash, "approval", t1);
  j = await withoutProof.transition(op.profileHash, op.operationId, j.integrityHash,
    { kind: "seal_signed", role: "approval", rawTransaction: await sign(op, "approval", 7), nonce: "7" });
  j = await withoutProof.transition(op.profileHash, op.operationId, j.integrityHash,
    { kind: "mark_submitting", role: "approval", at: t1 });
  j = await withoutProof.transition(op.profileHash, op.operationId, j.integrityHash,
    { kind: "record_send", role: "approval", outcome: "uncertain" });
  const proofDigest = "c".repeat(64);
  const event = { kind: "record_verified_observation" as const, role: "approval" as const,
    outcome: "confirmed" as const, proofDigest };
  await assert.rejects(withoutProof.transition(op.profileHash, op.operationId, j.integrityHash, event),
    { code: "APN_OPERATION_BLOCKED" });
  let checks = 0;
  const withProof = syntheticRepository(async input => {
    checks++;
    assert.equal(input.operation.integrityHash, op.integrityHash);
    assert.equal(input.journal.effects[0].attempt?.transactionHash, j.effects[0].attempt?.transactionHash);
    return input.role === "approval" && input.outcome === "confirmed" && input.proofDigest === proofDigest;
  });
  await assert.rejects(withProof.transition(op.profileHash, op.operationId, j.integrityHash,
    { ...event, proofDigest: "d".repeat(64) }), { code: "APN_OPERATION_BLOCKED" });
  assert.deepEqual(await withoutProof.load(op.profileHash, op.operationId), j);
  const confirmed = await withProof.transition(op.profileHash, op.operationId, j.integrityHash, event);
  assert.equal(checks, 2);
  assert.equal(confirmed.effects[0].phase, "confirmed");
  assert.equal(confirmed.effects[0].attempt?.observationDigest, proofDigest);
  assert.deepEqual(await syntheticRepository()
    .load(op.profileHash, op.operationId), confirmed);
  assert.equal(await arbitrumSourceRecoveryClass(confirmed, op), "approval_confirmed");
});
