import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import test from "node:test";
import { randomBytes } from "node:crypto";
import { privateKeyToAccount } from "viem/accounts";
import type { Hex } from "viem";
import { hashObject } from "../../src/canonical.js";
import { AssetUsageLedger, assetUsageReservationId } from "../../src/asset-usage-ledger.js";
import { activeAssetPolicyFromState, type ActiveAssetPolicy } from "../../src/allowlist-active-policy.js";
import { loadAllowlistInventory } from "../../src/allowlist-inventory.js";
import { AllowlistPolicyStore } from "../../src/allowlist-policy-store.js";
import { sealAssetPolicyRegistry } from "../../src/asset-policy-registry.js";
import { bindArgv } from "../../src/command-binder.js";
import { ApnError } from "../../src/errors.js";
import type { WrappingSecretPort } from "../../src/macos-keychain.js";
import { freezeRelayUnsignedOperation, type RelayUnsignedOperation } from "../../src/relay-unsigned-operation.js";
import { RelayArbitrumDepositDispatchService } from "../../src/relay/arbitrum-deposit-dispatch.js";
import type { RelayArbitrumDepositPreflightReader } from "../../src/relay/arbitrum-deposit-preflight.js";
import { advanceArbitrumSourceEffectJournal, createArbitrumSourceEffectJournal,
  type ArbitrumSourceEffectJournal, type ArbitrumSourceEffectJournalRepository } from "../../src/relay/arbitrum-source-effect-journal.js";
import { RELAY_ARBITRUM_USDC } from "../../src/relay/arbitrum-usdc-ethereum-quote.js";
import { RELAY_ARBITRUM_SOURCE_DRAFT_REFERENCE } from "../../src/relay/arbitrum-usdc-source-draft.js";
import { RelayArbitrumSourceObserveService } from "../../src/relay/arbitrum-source-observe.js";
import { RelayUnsignedPrepareService } from "../../src/relay/prepare.js";
import { StateStore } from "../../src/state.js";
import { temporaryState } from "./helpers.js";

const account = privateKeyToAccount(`0x${"1".repeat(64)}`);
const fixtureOwner = "0x0B4Dd0C3dA001Fa146EEd3f80B01860BEF6B8a14";
const now = new Date(1790347296 * 1000);
const quoteFile = resolve("tests/core/relay-fixtures/arbitrum-usdc-ethereum-usdc-quote-20260925.json");
function active(owner: string, profile = "default") {
  const registry = sealAssetPolicyRegistry({ schemaVersion: "apn.asset-policy-registry.v2",
    registryVersion: "test.relay.arb.approval.execute.1", publishedAt: "2026-09-25T00:00:00.000Z",
    effectiveDate: "2026-09-25", effectiveAt: "2026-09-25T00:00:00.000Z",
    expiresAt: "2026-10-03T00:00:00.000Z", chains: [{ chain: "eip155:42161", family: "evm",
      name: "Arbitrum One", assets: [{ kind: "token", identifier: RELAY_ARBITRUM_USDC, symbol: "USDC", decimals: 6,
        rails: { direct: false, gasless: false, x402: false, bridge: true, swap: false },
        railCaps: { bridge: { maximumPerTransferAtomic: "1000000", dailyLimitAtomic: "2000000" } },
        mechanismPins: { bridge: { provider: "relay", reference: RELAY_ARBITRUM_SOURCE_DRAFT_REFERENCE } } }] }] });
  return { profile, registry, digest: registry.policyDigest, revision: 1,
    accounts: { evm: owner }, activationDigest: "a".repeat(64), activatedAt: now.toISOString() };
}
async function setup(policyFactory?: (root: string) => Promise<ActiveAssetPolicy>, profile = "default") {
  const temporary = await temporaryState();
  const state = new StateStore(temporary.root);
  const policy = policyFactory === undefined ? active(fixtureOwner, profile) :
    { ...await policyFactory(temporary.root), accounts: { evm: fixtureOwner } };
  const prepared = await new RelayUnsignedPrepareService(state, { now: () => now }, undefined,
    { activePolicy: async () => policy, dailyUsage: async () => "0" }).prepareArbitrum({
    profile, owner: fixtureOwner, amountAtomic: "500000", minOutputAtomic: "94065",
    maxProviderFeeAtomic: "401482", maxApprovalNetworkFeeWei: "2000000000000",
    maxDepositNetworkFeeWei: "2000000000000", quoteFile, idempotencyKey: "relay-arb-execute-test",
  });
  const saved = await import("../../src/relay-unsigned-operation.js").then(m =>
    new m.RelayUnsignedOperationRepository(temporary.root).loadOperation(state.profileHash(profile), prepared.operationId));
  assert.ok(saved);
  const rawQuote = JSON.parse(await readFile(quoteFile, "utf8")) as any;
  for (const step of rawQuote.steps) step.items[0].data.from = account.address;
  const draftBody = { ...saved.arbitrumDraft!, owner: account.address.toLowerCase(), rawQuote };
  const { integrityHash: _draftHash, ...draftFields } = draftBody;
  const draft = { ...draftFields, integrityHash: hashObject(draftFields) };
  const { integrityHash: _opHash, ...opFields } = saved;
  const op = freezeRelayUnsignedOperation({ ...opFields, sourceAccount: account.address.toLowerCase(), arbitrumDraft: draft });
  return { temporary, state, op, policy: { ...policy, accounts: { evm: account.address.toLowerCase() } } };
}

async function skippedJournal(op: RelayUnsignedOperation) {
  const initial = await createArbitrumSourceEffectJournal(op, now.toISOString());
  const { integrityHash: _, ...fields } = initial;
  const proof = { proofClass: "canonical_allowance_observation" as const,
    operationIntegrityHash: op.integrityHash, policyDigest: op.policyDigest!, policyRevision: op.policyRevision!,
    token: RELAY_ARBITRUM_USDC, owner: op.sourceAccount,
    spender: (await import("../../src/relay/quote.js")).ETHEREUM_DEPOSITORY,
    amountAtomic: op.amountAtomic, allowanceAtomic: op.amountAtomic,
    blockNumber: "100", blockHash: `0x${"1".repeat(64)}`, observedAt: now.toISOString() };
  const body = { ...fields, effects: [{ role: "approval" as const, phase: "approval_skipped" as const,
    attempt: null, skipProof: proof }, initial.effects[1]] as const };
  return { ...body, integrityHash: hashObject(body) } as ArbitrumSourceEffectJournal;
}
async function approvalJournal(op: RelayUnsignedOperation, observe: boolean) {
  let current = await createArbitrumSourceEffectJournal(op, now.toISOString());
  current = await advanceArbitrumSourceEffectJournal(current, op, { kind: "begin_signing", role: "approval",
    marker: randomBytes(32).toString("hex"), at: now.toISOString() });
  const envelope = (op.arbitrumDraft!.rawQuote as any).steps[0].items[0].data;
  const raw = await account.signTransaction({ type: "eip1559", chainId: 42161, nonce: 6,
    to: envelope.to as Hex, data: envelope.data as Hex, value: 0n, gas: BigInt(envelope.gas),
    maxFeePerGas: BigInt(envelope.maxFeePerGas), maxPriorityFeePerGas: BigInt(envelope.maxPriorityFeePerGas) });
  current = await advanceArbitrumSourceEffectJournal(current, op,
    { kind: "seal_signed", role: "approval", rawTransaction: raw, nonce: "6" });
  current = await advanceArbitrumSourceEffectJournal(current, op,
    { kind: "mark_submitting", role: "approval", at: now.toISOString() });
  current = await advanceArbitrumSourceEffectJournal(current, op,
    { kind: "record_send", role: "approval", outcome: "uncertain" });
  return observe ? advanceArbitrumSourceEffectJournal(current, op,
    { kind: "record_verified_observation", role: "approval", outcome: "confirmed", proofDigest: "1".repeat(64) }) : current;
}
const confirmedJournal = (op: RelayUnsignedOperation) => approvalJournal(op, true);
function harness(state: StateStore, op: RelayUnsignedOperation, initial: ArbitrumSourceEffectJournal,
  options: { failReadAt?: number; revokeAtPolicyRead?: number; send?: (raw: Hex) => Promise<Hex>;
    confirm?: boolean } = {}) {
  let current = initial, reads = 0, signs = 0, sends = 0, confirmations = 0, policyReads = 0;
  const journals = {
    load: async () => current,
    createUnderLocks: async () => { throw new Error("unexpected journal creation"); },
    beginSigningUnderLocks: async (_p: string, _id: string, expected: string, role: "approval" | "deposit", at: string) => {
      assert.equal(current.integrityHash, expected);
      current = await advanceArbitrumSourceEffectJournal(current, op,
        { kind: "begin_signing", role, marker: randomBytes(32).toString("hex"), at });
      return current;
    },
    transitionUnderLocks: async (_p: string, _id: string, expected: string,
      event: Parameters<ArbitrumSourceEffectJournalRepository["transitionUnderLocks"]>[3]) => {
      assert.equal(current.integrityHash, expected);
      current = await advanceArbitrumSourceEffectJournal(current, op, event);
      return current;
    },
  } as unknown as Pick<ArbitrumSourceEffectJournalRepository,
    "load" | "createUnderLocks" | "beginSigningUnderLocks" | "transitionUnderLocks">;
  const reader = { read: async () => {
    if (reads++ === options.failReadAt) throw new Error("canonical block reorg");
    return { approvalRequired: false, allowanceAtomic: "500000", readOnlyConditionsSatisfied: true,
      reasons: [], confirmedNonce: "7", pendingNonce: "7", observedAt: now.toISOString() };
  } } as unknown as Pick<RelayArbitrumDepositPreflightReader, "read">;
  const service = new RelayArbitrumDepositDispatchService(state, reader, {
    confirm: async summary => { confirmations++; assert.equal(summary.depositAmountAtomic, "500000");
      return options.confirm ?? true; },
    signer: { sign: async (operation, nonce) => { signs++;
      const envelope = (operation.arbitrumDraft!.rawQuote as any).steps[1].items[0].data;
      return account.signTransaction({ type: "eip1559", chainId: 42161, nonce: Number(nonce),
        to: envelope.to as Hex, data: envelope.data as Hex, value: 0n, gas: BigInt(envelope.gas),
        maxFeePerGas: BigInt(envelope.maxFeePerGas), maxPriorityFeePerGas: BigInt(envelope.maxPriorityFeePerGas) });
    } },
    send: async raw => { sends++; return options.send?.(raw) ?? (await import("viem")).keccak256(raw); },
    activePolicyUnderLock: async () => ++policyReads === options.revokeAtPolicyRead ? null :
      { ...active(fixtureOwner, op.arbitrumDraft!.profile), accounts: { evm: account.address.toLowerCase() } },
    dailyUsage: async () => "0", now: () => now, operation: async () => op, journals,
  }, {} as WrappingSecretPort);
  return { service, journal: () => current, counts: () => ({ reads, signs, sends, confirmations }) };
}
async function lease(state: StateStore, op: RelayUnsignedOperation) {
  const identity = { account: account.address, chain: "eip155:42161",
    asset: { kind: "token" as const, identifier: RELAY_ARBITRUM_USDC } };
  return new AssetUsageLedger(state.root).load(identity,
    assetUsageReservationId(identity, `relay-arbitrum-approval:${op.operationId}`));
}

test("verified skip permits one pinned deposit; replay is observation only and lease is counted once", async t => {
  const { temporary, state, op } = await setup(); t.after(temporary.cleanup);
  const bound = bindArgv(["relay", "arbitrum", "deposit-dispatch", "--profile", "default",
    "--operation", op.operationId, "--rpc-url", "https://arb-rpc.example"]);
  assert.equal(bound.request.command, "relay.arbitrum.deposit-dispatch");
  const h = harness(state, op, await skippedJournal(op));
  const first = await h.service.execute("default", op.operationId);
  assert.equal(first.state, "deposit_submitted");
  assert.equal(first.depositPhase, "submitted");
  assert.equal((await lease(state, op))?.state, "submitted");
  const replay = await h.service.execute("default", op.operationId);
  assert.equal(replay.state, "observation_only");
  assert.deepEqual(h.counts(), { reads: 3, signs: 1, sends: 1, confirmations: 1 });
});

test("buyer deposit dispatch reads its selected profile policy and rejects profile mismatch", async t => {
  const { temporary, state, op } = await setup(undefined, "evm-live-buyer"); t.after(temporary.cleanup);
  const h = harness(state, op, await skippedJournal(op));
  await assert.rejects(h.service.execute("default", op.operationId), { code: "APN_OPERATION_BLOCKED" });
  assert.equal(h.counts().sends, 0);
  const first = await h.service.execute("evm-live-buyer", op.operationId);
  assert.equal(first.state, "deposit_submitted");
  assert.equal(h.counts().sends, 1);
});

test("confirmed approval admits deposit but ambiguous send cannot replay", async t => {
  const { temporary, state, op } = await setup(); t.after(temporary.cleanup);
  const policy = { ...active(fixtureOwner), accounts: { evm: account.address.toLowerCase() } };
  const identity = { account: account.address, chain: "eip155:42161",
    asset: { kind: "token" as const, identifier: RELAY_ARBITRUM_USDC } };
  const usage = new AssetUsageLedger(state.root);
  const reserved = await usage.reserve({ ...identity, registry: policy.registry, rail: "bridge",
    mechanism: { provider: "relay", reference: RELAY_ARBITRUM_SOURCE_DRAFT_REFERENCE },
    amountAtomic: op.amountAtomic, idempotencyKey: `relay-arbitrum-approval:${op.operationId}`, now });
  await usage.transition({ ...identity, reservationId: reserved.reservationId,
    policyDigest: op.policyDigest!, state: "submitted", expectedCurrentStates: ["reserved"], now });
  const h = harness(state, op, await confirmedJournal(op), { send: async () => { throw new Error("timeout"); } });
  assert.equal((await h.service.execute("default", op.operationId)).state, "observation_only");
  assert.equal(h.journal().effects[1].phase, "unknown_finality");
  assert.equal((await lease(state, op))?.state, "unknown_finality");
  await h.service.execute("default", op.operationId);
  assert.equal(h.counts().sends, 1);
  let depositJournal = h.journal();
  const blockHash = `0x${"3".repeat(64)}` as Hex;
  const source = new RelayArbitrumSourceObserveService(state, { observe: async (deposit, approval) => ({
    sourceChainId: 42161 as const, rpcOrigin: "https://arb-rpc.example",
    deposit: { transactionHash: deposit.transactionHash, blockNumber: "120", blockHash },
    approval: approval === undefined ? null : { transactionHash: approval.transactionHash,
      blockNumber: "100", blockHash },
    safeHead: { number: "130", hash: `0x${"4".repeat(64)}` as Hex },
    proofClass: "canonical_safe_source_receipts" as const,
    destinationDeliveryProven: false as const, causalLinkCryptographicallyProven: false as const,
    paidAcceptance: false as const,
  }) }, { operation: async () => op, journal: async () => depositJournal,
    transition: async (_profileHash, _id, expectedHash, role, digest, verify) => {
      assert.equal(expectedHash, depositJournal.integrityHash);
      assert.equal(await verify({ operation: op, journal: depositJournal, role,
        outcome: "confirmed", proofDigest: digest }), true);
      depositJournal = await advanceArbitrumSourceEffectJournal(depositJournal, op,
        { kind: "record_verified_observation", role, outcome: "confirmed", proofDigest: digest });
      return depositJournal;
    } });
  assert.equal((await source.observe(op.operationId)).state, "deposit_source_confirmed");
  assert.equal((await lease(state, op))?.state, "finalized");
  assert.equal((await lease(state, op))?.outcomeDigest, depositJournal.effects[1].attempt?.observationDigest);
  assert.equal((await source.observe(op.operationId)).state, "deposit_source_confirmed");
});

test("approval gate, owner decline, policy race and canonical reorg prevent send", async t => {
  const { temporary, state, op } = await setup(); t.after(temporary.cleanup);
  const empty = await createArbitrumSourceEffectJournal(op, now.toISOString());
  const gated = harness(state, op, empty);
  await assert.rejects(() => gated.service.execute("default", op.operationId));
  assert.equal(gated.counts().sends, 0);
  const declined = harness(state, op, await skippedJournal(op), { confirm: false });
  await assert.rejects(() => declined.service.execute("default", op.operationId));
  assert.equal(declined.counts().signs, 0);
  const race = harness(state, op, await skippedJournal(op), { revokeAtPolicyRead: 3 });
  assert.equal((await race.service.execute("default", op.operationId)).state, "observation_only");
  assert.equal(race.counts().sends, 0);
  const reorg = harness(state, op, await skippedJournal(op), { failReadAt: 2 });
  assert.equal((await reorg.service.execute("default", op.operationId)).state, "observation_only");
  assert.equal(reorg.counts().sends, 0);
});

test("uncertain approval lease remains counted after safe approval proof and permits one deposit", async t => {
  const { temporary, state, op } = await setup(); t.after(temporary.cleanup);
  const policy = { ...active(fixtureOwner), accounts: { evm: account.address.toLowerCase() } };
  const identity = { account: account.address, chain: "eip155:42161",
    asset: { kind: "token" as const, identifier: RELAY_ARBITRUM_USDC } };
  const usage = new AssetUsageLedger(state.root);
  const reserved = await usage.reserve({ ...identity, registry: policy.registry, rail: "bridge",
    mechanism: { provider: "relay", reference: RELAY_ARBITRUM_SOURCE_DRAFT_REFERENCE },
    amountAtomic: op.amountAtomic, idempotencyKey: `relay-arbitrum-approval:${op.operationId}`, now });
  await usage.transition({ ...identity, reservationId: reserved.reservationId,
    policyDigest: op.policyDigest!, state: "unknown_finality", expectedCurrentStates: ["reserved"], now });
  let journal = await approvalJournal(op, false);
  const unconfirmed = harness(state, op, journal);
  await assert.rejects(() => unconfirmed.service.execute("default", op.operationId));
  assert.equal(unconfirmed.counts().sends, 0);
  const observe = new RelayArbitrumSourceObserveService(state, { observe: async expected => ({
    sourceChainId: 42161 as const, rpcOrigin: "https://arb-rpc.example",
    deposit: { transactionHash: expected.transactionHash, blockNumber: "100",
      blockHash: `0x${"1".repeat(64)}` as Hex }, approval: null,
    safeHead: { number: "110", hash: `0x${"2".repeat(64)}` as Hex },
    proofClass: "canonical_safe_source_receipts" as const,
    destinationDeliveryProven: false as const, causalLinkCryptographicallyProven: false as const,
    paidAcceptance: false as const,
  }) }, { operation: async () => op, journal: async () => journal,
    transition: async (_profileHash, _id, expectedHash, role, digest, verify) => {
      assert.equal(expectedHash, journal.integrityHash);
      assert.equal(await verify({ operation: op, journal, role, outcome: "confirmed", proofDigest: digest }), true);
      journal = await advanceArbitrumSourceEffectJournal(journal, op,
        { kind: "record_verified_observation", role, outcome: "confirmed", proofDigest: digest });
      return journal;
    } });
  assert.equal((await observe.observe(op.operationId)).state, "approval_source_confirmed");
  assert.equal(journal.effects[0].phase, "confirmed");
  const h = harness(state, op, journal);
  assert.equal((await h.service.execute("default", op.operationId)).state, "deposit_submitted");
  assert.equal((await lease(state, op))?.state, "unknown_finality");
  await h.service.execute("default", op.operationId);
  assert.equal(h.counts().sends, 1);
});

test("submitting marker before any POST and 429 before start never claim dispatch or replay", async t => {
  const { temporary, state, op } = await setup(); t.after(temporary.cleanup);
  let journal = await skippedJournal(op);
  journal = await advanceArbitrumSourceEffectJournal(journal, op, { kind: "begin_signing",
    role: "deposit", marker: randomBytes(32).toString("hex"), at: now.toISOString() });
  const envelope = (op.arbitrumDraft!.rawQuote as any).steps[1].items[0].data;
  const raw = await account.signTransaction({ type: "eip1559", chainId: 42161, nonce: 7,
    to: envelope.to as Hex, data: envelope.data as Hex, value: 0n, gas: BigInt(envelope.gas),
    maxFeePerGas: BigInt(envelope.maxFeePerGas), maxPriorityFeePerGas: BigInt(envelope.maxPriorityFeePerGas) });
  journal = await advanceArbitrumSourceEffectJournal(journal, op,
    { kind: "seal_signed", role: "deposit", rawTransaction: raw, nonce: "7" });
  journal = await advanceArbitrumSourceEffectJournal(journal, op,
    { kind: "mark_submitting", role: "deposit", at: now.toISOString() });
  const crashed = harness(state, op, journal);
  const replay = await crashed.service.execute("default", op.operationId);
  assert.equal(replay.state, "observation_only");
  assert.equal(replay.depositDispatched, false);
  assert.equal(crashed.counts().sends, 0);
  const limited = harness(state, op, await skippedJournal(op), {
    send: async () => { throw new ApnError("APN_RPC_RATE_LIMITED", "before POST", { httpStatus: 429 }); },
  });
  const first = await limited.service.execute("default", op.operationId);
  assert.equal(first.depositPhase, "unknown_finality");
  assert.equal(first.depositDispatched, false);
  await limited.service.execute("default", op.operationId);
  assert.equal(limited.counts().sends, 1);
});
