import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import test from "node:test";
import { privateKeyToAccount } from "viem/accounts";
import type { Hex } from "viem";
import { hashObject, sha256 } from "../../src/canonical.js";
import { bindArgv } from "../../src/command-binder.js";
import { ApnCore } from "../../src/core.js";
import { RelayUnsignedOperationRepository, freezeRelayUnsignedOperation } from "../../src/relay-unsigned-operation.js";
import { advanceArbitrumSourceEffectJournal, createArbitrumSourceEffectJournal,
  type ArbitrumSourceEffectJournal } from "../../src/relay/arbitrum-source-effect-journal.js";
import { RELAY_ARBITRUM_USDC, RELAY_ETHEREUM_USDC_RECIPIENT } from "../../src/relay/arbitrum-usdc-ethereum-quote.js";
import { RelayArbitrumSourceObserveService } from "../../src/relay/arbitrum-source-observe.js";
import type { RelayArbitrumExpectedEffect, RelayArbitrumSourceProof } from "../../src/relay/arbitrum-source-finality.js";
import { ETHEREUM_USDC, relayStatusLocator } from "../../src/relay/quote.js";
import { createApnCore } from "../../src/runtime-factory.js";
import { StateStore } from "../../src/state.js";
import { temporaryState } from "./helpers.js";

const account = privateKeyToAccount(`0x${"1".repeat(64)}`);
const owner = account.address.toLowerCase();
const now = new Date(1790347296 * 1000).toISOString();
const later = new Date(1790347297 * 1000).toISOString();
const blockHash = `0x${"b".repeat(64)}` as Hex;
const safeHash = `0x${"c".repeat(64)}` as Hex;
const quoteFile = resolve("tests/core/relay-fixtures/arbitrum-usdc-ethereum-usdc-quote-20260925.json");

async function synthetic() {
  // Signed synthetic EVM owner is deliberately used only through injected test ports.
  // Production loads the saved operation and re-decodes the solver-signed Relay quote.
  const rawQuote = JSON.parse(await readFile(quoteFile, "utf8")) as any;
  for (const step of rawQuote.steps) step.items[0].data.from = owner;
  const draftBody = { schemaVersion: "apn.relay-arbitrum-source-draft.v1" as const,
    sourceChainId: 42161 as const, destinationChainId: 1 as const,
    sourceToken: RELAY_ARBITRUM_USDC, destinationToken: ETHEREUM_USDC.toLowerCase(),
    recipient: RELAY_ETHEREUM_USDC_RECIPIENT, profile: "default" as const, owner,
    amountAtomic: "500000", minimumOutputAtomic: "94065", maxProviderFeeAtomic: "401482",
    maxApprovalNetworkFeeWei: "2000000000000", maxDepositNetworkFeeWei: "2000000000000",
    policyDigest: "a".repeat(64), policyRevision: 1, quoteDigest: "b".repeat(64),
    requestId: rawQuote.requestId as string, orderId: rawQuote.protocol.v2.orderId as string,
    deadline: new Date(rawQuote.protocol.v2.orderData.output.deadline * 1000).toISOString(), createdAt: now,
    rawQuote, executionAdmitted: false as const, nextActions: [] as const };
  const draft = { ...draftBody, integrityHash: hashObject(draftBody) };
  const op = freezeRelayUnsignedOperation({ schemaVersion: "apn.relay-unsigned-operation.v1", kind: "relay_unsigned",
    state: "prepared", terminal: false, profileHash: sha256("profile\0default"), operationId: "d".repeat(64),
    idempotencyHash: "e".repeat(64), requestHash: "f".repeat(64), sourceChainId: 42161, destinationChainId: 1,
    sourceAccount: owner, recipient: RELAY_ETHEREUM_USDC_RECIPIENT.toLowerCase(), quoteDigest: draft.quoteDigest,
    statusLocator: relayStatusLocator(draft.requestId), arbitrumDraft: draft,
    policyDigest: draft.policyDigest, policyRevision: 1,
    approvalNetworkFeeCeilingWei: draft.maxApprovalNetworkFeeWei,
    depositNetworkFeeCeilingWei: draft.maxDepositNetworkFeeWei, amountAtomic: draft.amountAtomic,
    minOutputAtomic: draft.minimumOutputAtomic, createdAt: now, deadline: draft.deadline });
  return op;
}
async function marked(op: Awaited<ReturnType<typeof synthetic>>, role: "approval" | "deposit",
  j: ArbitrumSourceEffectJournal, nonce: number) {
  j = await advanceArbitrumSourceEffectJournal(j, op,
    { kind: "begin_signing", role, marker: "a".repeat(64), at: later });
  const envelope = (op.arbitrumDraft!.rawQuote as any).steps[role === "approval" ? 0 : 1].items[0].data;
  const rawTransaction = await account.signTransaction({ type: "eip1559", chainId: 42161, nonce,
    to: envelope.to as Hex, data: envelope.data as Hex, value: 0n, gas: BigInt(envelope.gas),
    maxFeePerGas: BigInt(envelope.maxFeePerGas), maxPriorityFeePerGas: BigInt(envelope.maxPriorityFeePerGas) });
  j = await advanceArbitrumSourceEffectJournal(j, op, { kind: "seal_signed", role, rawTransaction, nonce: String(nonce) });
  j = await advanceArbitrumSourceEffectJournal(j, op, { kind: "mark_submitting", role, at: later });
  return advanceArbitrumSourceEffectJournal(j, op, { kind: "record_send", role, outcome: "uncertain" });
}
function proof(deposit: RelayArbitrumExpectedEffect, approval?: RelayArbitrumExpectedEffect): RelayArbitrumSourceProof {
  const receipt = (effect: RelayArbitrumExpectedEffect) =>
    ({ transactionHash: effect.transactionHash, blockNumber: "100", blockHash });
  return { sourceChainId: 42161, rpcOrigin: "https://arb-rpc.example", deposit: receipt(deposit),
    approval: approval === undefined ? null : receipt(approval), safeHead: { number: "112", hash: safeHash },
    proofClass: "canonical_safe_source_receipts", destinationDeliveryProven: false,
    causalLinkCryptographicallyProven: false, paidAcceptance: false };
}

test("saved hash-bound uncertain send observes approval then joint deposit, with CAS and no destination claim", async t => {
  const temp = await temporaryState(); t.after(temp.cleanup);
  const op = await synthetic();
  let journal = await createArbitrumSourceEffectJournal(op, now);
  journal = await marked(op, "approval", journal, 7);
  let reads = 0, writes = 0, joint = false;
  const observer = { observe: async (deposit: RelayArbitrumExpectedEffect, approval?: RelayArbitrumExpectedEffect) => {
    reads++;
    joint = approval !== undefined;
    return proof(deposit, approval);
  } };
  const ports = { operation: async () => op, journal: async () => journal,
    transition: async (_profileHash: string, _operationId: string, expectedHash: string,
      role: "approval" | "deposit", digest: string, verify: (input: any) => Promise<boolean>) => {
      assert.equal(expectedHash, journal.integrityHash);
      assert.equal(await verify({ operation: op, journal, role, outcome: "confirmed", proofDigest: digest }), true);
      writes++;
      journal = await advanceArbitrumSourceEffectJournal(journal, op,
        { kind: "record_verified_observation", role, outcome: "confirmed", proofDigest: digest });
      return journal;
    } };
  const service = new RelayArbitrumSourceObserveService(new StateStore(temp.root), observer, ports);
  const command = bindArgv(["relay", "arbitrum", "observe", "--operation", op.operationId,
    "--rpc-url", "https://arb-rpc.example"]);
  assert.deepEqual(command.request, { command: "relay.arbitrum.observe", operationId: op.operationId });
  const core = new ApnCore({ state: new StateStore(temp.root), relayArbitrumObserve: service });
  const first = await core.execute(command.request);
  assert.equal(first.ok, true, JSON.stringify(first.error));
  assert.equal((first.data as any).state, "approval_source_confirmed");
  assert.equal((first.data as any).sourceProof.deposit, null);
  assert.equal((first.data as any).sourceProof.approval.transactionHash, journal.effects[0].attempt?.transactionHash);
  assert.equal((first.data as any).destinationDeliveryProven, false);
  assert.equal((first.data as any).paidAcceptance, false);
  assert.equal(joint, false);
  assert.equal(reads, 1); assert.equal(writes, 1);
  const waiting = await service.observe(op.operationId);
  assert.equal(waiting.state, "approval_source_confirmed");
  assert.equal(reads, 1);
  journal = await marked(op, "deposit", journal, 8);
  const second = await service.observe(op.operationId);
  assert.equal(second.state, "deposit_source_confirmed");
  assert.equal(second.sourceFinalized, true);
  assert.equal(second.destinationDeliveryProven, false);
  assert.equal(second.paidAcceptance, false);
  assert.equal(joint, true);
  assert.equal(reads, 2); assert.equal(writes, 2);
  assert.equal((await service.observe(op.operationId)).state, "deposit_source_confirmed");
  assert.equal(reads, 2);
  await assert.rejects(advanceArbitrumSourceEffectJournal(journal, op,
    { kind: "begin_signing", role: "deposit", marker: "f".repeat(64), at: later }), { code: "APN_OPERATION_BLOCKED" });
});

test("reorg or wrong hash leaves uncertain saved attempt unchanged", async t => {
  const temp = await temporaryState(); t.after(temp.cleanup);
  const op = await synthetic();
  let journal = await marked(op, "approval", await createArbitrumSourceEffectJournal(op, now), 7);
  const original = journal.integrityHash;
  let writes = 0;
  const ports = { operation: async () => op, journal: async () => journal,
    transition: async () => { writes++; throw new Error("must not transition"); } };
  const state = new StateStore(temp.root);
  const reorg = new RelayArbitrumSourceObserveService(state, { observe: async () => null }, ports);
  assert.equal((await reorg.observe(op.operationId)).state, "source_proof_pending");
  const wrong = new RelayArbitrumSourceObserveService(state, { observe: async expected =>
    proof({ ...expected, transactionHash: `0x${"f".repeat(64)}` as Hex }) }, ports);
  assert.equal((await wrong.observe(op.operationId)).state, "source_proof_pending");
  assert.equal(journal.integrityHash, original);
  assert.equal(writes, 0);
  let reads = 0;
  const wrongJournal = new RelayArbitrumSourceObserveService(state, { observe: async () => {
    reads++; return null;
  } }, { operation: async () => op, journal: async () => ({ ...journal, quoteDigest: "f".repeat(64) }) });
  await assert.rejects(wrongJournal.observe(op.operationId), { code: "APN_STATE_CORRUPT" });
  assert.equal(reads, 0);
});

test("installed command refuses absent saved operation before any RPC", async t => {
  const temp = await temporaryState(); t.after(temp.cleanup);
  let posts = 0;
  const bound = bindArgv(["relay", "arbitrum", "observe", "--operation", "a".repeat(64),
    "--rpc-url", "https://arb-rpc.example"]);
  const core = createApnCore(bound, { stateRoot: temp.root, relayArbitrumObserveRpc: {
    batchCall: async () => { posts++; throw new Error("unexpected network"); } } as any });
  const outcome = await core.execute(bound.request);
  assert.equal(outcome.ok, false);
  assert.equal(outcome.error?.code, "APN_OPERATION_NOT_FOUND");
  assert.equal(posts, 0);
});
