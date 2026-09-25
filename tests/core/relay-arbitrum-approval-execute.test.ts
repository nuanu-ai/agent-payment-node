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
import type { WrappingSecretPort } from "../../src/macos-keychain.js";
import { freezeRelayUnsignedOperation, type RelayUnsignedOperation } from "../../src/relay-unsigned-operation.js";
import { RelayArbitrumApprovalExecuteService } from "../../src/relay/arbitrum-approval-execute.js";
import type { RelayArbitrumApprovalPreflightReader } from "../../src/relay/arbitrum-approval-preflight.js";
import { advanceArbitrumSourceEffectJournal, createArbitrumSourceEffectJournal,
  type ArbitrumSourceEffectJournal, type ArbitrumSourceEffectJournalRepository } from "../../src/relay/arbitrum-source-effect-journal.js";
import { RELAY_ARBITRUM_USDC } from "../../src/relay/arbitrum-usdc-ethereum-quote.js";
import { RELAY_ARBITRUM_SOURCE_DRAFT_REFERENCE } from "../../src/relay/arbitrum-usdc-source-draft.js";
import { RelayUnsignedPrepareService } from "../../src/relay/prepare.js";
import { StateStore } from "../../src/state.js";
import { temporaryState } from "./helpers.js";

const account = privateKeyToAccount(`0x${"1".repeat(64)}`);
const fixtureOwner = "0x0B4Dd0C3dA001Fa146EEd3f80B01860BEF6B8a14";
const now = new Date(1790347296 * 1000);
const quoteFile = resolve("tests/core/relay-fixtures/arbitrum-usdc-ethereum-usdc-quote-20260925.json");
function active(owner: string) {
  const registry = sealAssetPolicyRegistry({ schemaVersion: "apn.asset-policy-registry.v2",
    registryVersion: "test.relay.arb.approval.execute.1", publishedAt: "2026-09-25T00:00:00.000Z",
    effectiveDate: "2026-09-25", effectiveAt: "2026-09-25T00:00:00.000Z",
    expiresAt: "2026-10-03T00:00:00.000Z", chains: [{ chain: "eip155:42161", family: "evm",
      name: "Arbitrum One", assets: [{ kind: "token", identifier: RELAY_ARBITRUM_USDC, symbol: "USDC", decimals: 6,
        rails: { direct: false, gasless: false, x402: false, bridge: true, swap: false },
        railCaps: { bridge: { maximumPerTransferAtomic: "1000000", dailyLimitAtomic: "2000000" } },
        mechanismPins: { bridge: { provider: "relay", reference: RELAY_ARBITRUM_SOURCE_DRAFT_REFERENCE } } }] }] });
  return { profile: "default", registry, digest: registry.policyDigest, revision: 1,
    accounts: { evm: owner }, activationDigest: "a".repeat(64), activatedAt: now.toISOString() };
}
async function setup(policyFactory?: (root: string) => Promise<ActiveAssetPolicy>) {
  const temporary = await temporaryState();
  const state = new StateStore(temporary.root);
  const policy = policyFactory === undefined ? active(fixtureOwner) :
    { ...await policyFactory(temporary.root), accounts: { evm: fixtureOwner } };
  const prepared = await new RelayUnsignedPrepareService(state, { now: () => now }, undefined,
    { activePolicy: async () => policy, dailyUsage: async () => "0" }).prepareArbitrum({
    profile: "default", owner: fixtureOwner, amountAtomic: "500000", minOutputAtomic: "94065",
    maxProviderFeeAtomic: "401482", maxApprovalNetworkFeeWei: "2000000000000",
    maxDepositNetworkFeeWei: "2000000000000", quoteFile, idempotencyKey: "relay-arb-execute-test",
  });
  const saved = await import("../../src/relay-unsigned-operation.js").then(m =>
    new m.RelayUnsignedOperationRepository(temporary.root).loadOperation(state.profileHash("default"), prepared.operationId));
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
async function storedPolicy(root: string) {
  const inventory = loadAllowlistInventory();
  const store = new AllowlistPolicyStore(root);
  const staged = await store.prepare({ overlayVersion: "test.relay.arb.lock.1", profile: "default",
    account: account.address, datasetVersion: inventory.dataset.version,
    datasetSha256: inventory.dataset.sha256, inventorySha256: inventory.inventorySha256,
    effectiveAt: "2026-09-25T00:00:00.000Z", expiresAt: "2026-10-03T00:00:00.000Z",
    admissions: [{ chain: "eip155:42161", kind: "token", identifier: RELAY_ARBITRUM_USDC,
      rail: "bridge", maximumPerTransferAtomic: "1000000", dailyLimitAtomic: "2000000",
      mechanism: { provider: "relay", reference: RELAY_ARBITRUM_SOURCE_DRAFT_REFERENCE } }], now });
  const activated = await store.appendDecision("default", null, { status: "active", revision: staged.revision,
    stagedRecordDigest: staged.recordDigest, policyDigest: staged.registry.policyDigest,
    registry: staged.registry, approvalFingerprint: "a".repeat(64), decidedAt: now.toISOString() });
  const policy = activeAssetPolicyFromState(await store.read("default"), now);
  assert.ok(policy);
  return { store, staged, activated, policy };
}
function memoryJournal(op: RelayUnsignedOperation) {
  let current: ArbitrumSourceEffectJournal | null = null;
  const repository = {
    load: async () => current,
    createUnderLocks: async (_profile: string, _id: string, at: string) => {
      assert.equal(current, null); current = await createArbitrumSourceEffectJournal(op, at); return current;
    },
    beginSigningUnderLocks: async (_profile: string, _id: string, expected: string, _role: string, at: string) => {
      assert.equal(current?.integrityHash, expected);
      current = await advanceArbitrumSourceEffectJournal(current!, op,
        { kind: "begin_signing", role: "approval", marker: randomBytes(32).toString("hex"), at });
      return current;
    },
    transitionUnderLocks: async (_profile: string, _id: string, expected: string,
      event: Parameters<ArbitrumSourceEffectJournalRepository["transitionUnderLocks"]>[3]) => {
      assert.equal(current?.integrityHash, expected);
      current = await advanceArbitrumSourceEffectJournal(current!, op, event); return current;
    },
  } as unknown as Pick<ArbitrumSourceEffectJournalRepository,
    "load" | "createUnderLocks" | "beginSigningUnderLocks" | "transitionUnderLocks">;
  return { repository, current: () => current };
}
function harness(state: StateStore, op: RelayUnsignedOperation, options: {
  allowances?: readonly bigint[]; send?: (raw: Hex) => Promise<Hex>; failReadAt?: number;
  storedPolicy?: boolean; onSign?: () => Promise<void>; onConfirm?: () => Promise<void>;
  revokeAtPolicyRead?: number;
} = {}) {
  let reads = 0, signs = 0, sends = 0, confirmations = 0, policyReads = 0;
  const journal = memoryJournal(op);
  const allowances = options.allowances ?? [0n, 0n, 0n];
  const reader = { read: async () => {
    const index = reads++;
    if (index === options.failReadAt) throw new Error("canonical block reorg");
    const allowance = allowances[index] ?? 0n;
    return { approvalRequired: allowance < 500_000n, allowanceAtomic: allowance.toString(),
      readOnlyConditionsSatisfied: true, reasons: [], confirmedNonce: "7", pendingNonce: "7",
      observedAt: now.toISOString() };
  } } as unknown as Pick<RelayArbitrumApprovalPreflightReader, "read">;
  const service = new RelayArbitrumApprovalExecuteService(state, reader, {
    confirm: async summary => { confirmations++; assert.equal(summary.approvalValueAtomic, "500000");
      await options.onConfirm?.(); return true; },
    signer: { sign: async (operation, nonce) => {
      signs++; await options.onSign?.();
      const envelope = (operation.arbitrumDraft!.rawQuote as any).steps[0].items[0].data;
      return account.signTransaction({ type: "eip1559", chainId: 42161, nonce: Number(nonce),
        to: envelope.to as Hex, data: envelope.data as Hex, value: 0n, gas: BigInt(envelope.gas),
        maxFeePerGas: BigInt(envelope.maxFeePerGas), maxPriorityFeePerGas: BigInt(envelope.maxPriorityFeePerGas) });
    } },
    send: async raw => { sends++; return options.send?.(raw) ?? (await import("viem")).keccak256(raw); },
    ...(options.storedPolicy ? {} : { activePolicyUnderLock: async () => {
      if (++policyReads === options.revokeAtPolicyRead) return null;
      return { ...active(fixtureOwner), accounts: { evm: account.address.toLowerCase() } };
    } }),
    dailyUsage: async () => "0", now: () => now,
    operation: async () => op, journals: journal.repository,
  }, {} as WrappingSecretPort);
  return { service, journal, counts: () => ({ reads, signs, sends, confirmations }) };
}
async function lease(state: StateStore, op: RelayUnsignedOperation) {
  const identity = { account: account.address, chain: "eip155:42161",
    asset: { kind: "token" as const, identifier: RELAY_ARBITRUM_USDC } };
  return new AssetUsageLedger(state.root).load(identity,
    assetUsageReservationId(identity, `relay-arbitrum-approval:${op.operationId}`));
}

test("approval executes one exact signed transaction; replay is observation-only", async t => {
  const { temporary, state, op } = await setup(); t.after(temporary.cleanup);
  const bound = bindArgv(["relay", "arbitrum", "approval-execute", "--profile", "default",
    "--operation", op.operationId, "--rpc-url", "https://arb-rpc.example"]);
  assert.equal(bound.request.command, "relay.arbitrum.approval-execute");
  const h = harness(state, op);
  const first = await h.service.execute("default", op.operationId);
  assert.equal(first.state, "approval_submitted");
  assert.equal(first.approvalPhase, "submitted");
  assert.equal(first.depositPhase, "pending");
  assert.equal("rawTransaction" in first, false);
  assert.deepEqual(h.counts(), { reads: 3, signs: 1, sends: 1, confirmations: 1 });
  assert.equal((await lease(state, op))?.state, "submitted");
  assert.equal((await h.service.execute("default", op.operationId)).state, "observation_only");
  assert.deepEqual(h.counts(), { reads: 3, signs: 1, sends: 1, confirmations: 1 });
});

test("uncertain send and HTTP 429 each retain a single durable attempt", async t => {
  for (const reason of ["timeout", "HTTP 429"]) {
    const { temporary, state, op } = await setup(); t.after(temporary.cleanup);
    const h = harness(state, op, { send: async () => { throw new Error(reason); } });
    const result = await h.service.execute("default", op.operationId);
    assert.equal(result.state, "observation_only");
    assert.equal(result.approvalPhase, "unknown_finality");
    assert.equal((await h.service.execute("default", op.operationId)).state, "observation_only");
    assert.equal(h.counts().sends, 1);
    assert.equal(h.counts().signs, 1);
    assert.equal((await lease(state, op))?.state, "unknown_finality");
  }
});

test("approval already sufficient and pre-send reorg never dispatch", async t => {
  const first = await setup(); t.after(first.temporary.cleanup);
  const covered = harness(first.state, first.op, { allowances: [500_000n] });
  assert.equal((await covered.service.execute("default", first.op.operationId)).state, "approval_not_needed");
  assert.equal(covered.journal.current(), null);
  assert.equal(covered.counts().signs, 0);
  assert.equal(await lease(first.state, first.op), null);
  const second = await setup(); t.after(second.temporary.cleanup);
  const reorg = harness(second.state, second.op, { failReadAt: 2 });
  const result = await reorg.service.execute("default", second.op.operationId);
  assert.equal(result.state, "observation_only");
  assert.equal(result.approvalPhase, "sealed");
  assert.equal(reorg.counts().sends, 0);
  assert.equal((await lease(second.state, second.op))?.state, "reserved");
});

test("final policy read refuses a revoked policy before send", async t => {
  const { temporary, state, op } = await setup(); t.after(temporary.cleanup);
  const h = harness(state, op, { revokeAtPolicyRead: 3 });
  const result = await h.service.execute("default", op.operationId);
  assert.equal(result.state, "observation_only");
  assert.equal(result.reason, "active_policy_revoked_or_changed");
  assert.equal(h.counts().sends, 0);
  assert.equal(h.counts().signs, 1);
});

test("authenticated policy revocation during owner challenge blocks signing without a lock wait", async t => {
  let stored!: Awaited<ReturnType<typeof storedPolicy>>;
  const { temporary, state, op } = await setup(async root => {
    stored = await storedPolicy(root); return stored.policy;
  });
  t.after(temporary.cleanup);
  const h = harness(state, op, { storedPolicy: true, onConfirm: async () => {
    await stored.store.appendDecision("default", stored.activated.entryDigest, {
      status: "revoked", revision: stored.staged.revision,
      stagedRecordDigest: stored.staged.recordDigest,
      policyDigest: stored.staged.registry.policyDigest,
      approvalFingerprint: "b".repeat(64), decidedAt: new Date(now.getTime() + 1000).toISOString(),
    });
  } });
  await assert.rejects(h.service.execute("default", op.operationId), { code: "APN_OPERATION_BLOCKED" });
  assert.equal(h.counts().signs, 0);
  assert.equal(h.counts().sends, 0);
});

test("authenticated policy revocation waits through the one send and then completes", async t => {
  let stored!: Awaited<ReturnType<typeof storedPolicy>>;
  const { temporary, state, op } = await setup(async root => {
    stored = await storedPolicy(root); return stored.policy;
  });
  t.after(temporary.cleanup);
  let revoked = false;
  let revocation: Promise<unknown> | undefined;
  const h = harness(state, op, { storedPolicy: true, onSign: async () => {
    revocation = stored.store.appendDecision("default", stored.activated.entryDigest, {
      status: "revoked", revision: stored.staged.revision,
      stagedRecordDigest: stored.staged.recordDigest,
      policyDigest: stored.staged.registry.policyDigest,
      approvalFingerprint: "b".repeat(64), decidedAt: new Date(now.getTime() + 1000).toISOString(),
    }).then(value => { revoked = true; return value; });
    await new Promise<void>(resolve => setImmediate(resolve));
  }, send: async raw => {
    assert.equal(revoked, false);
    return (await import("viem")).keccak256(raw);
  } });
  const result = await Promise.race([
    h.service.execute("default", op.operationId),
    new Promise<never>((_, reject) => setTimeout(() => reject(new Error("execute lock deadlock")), 3000)),
  ]);
  assert.equal(result.state, "approval_submitted");
  assert.equal(h.counts().sends, 1);
  assert.ok(revocation);
  await Promise.race([revocation, new Promise<never>((_, reject) =>
    setTimeout(() => reject(new Error("revocation lock deadlock")), 3000))]);
  assert.equal(revoked, true);
  assert.equal(activeAssetPolicyFromState(await stored.store.read("default"), now), null);
});
