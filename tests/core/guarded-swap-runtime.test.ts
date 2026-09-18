import assert from "node:assert/strict";
import test from "node:test";
import { AssetUsageLedger } from "../../src/asset-usage-ledger.js";
import { compileAllowlistPolicyOverlay, type AllowlistPolicyOverlayInput } from "../../src/allowlist-policy-overlay.js";
import { loadAllowlistInventory } from "../../src/allowlist-inventory.js";
import { StateStore } from "../../src/state.js";
import { createSwapQuote, type SwapQuoteInput } from "../../src/swap/quote.js";
import { SwapOperationRepository } from "../../src/swap/repository.js";
import { compileSwapProtocolRegistry } from "../../src/swap/protocol-registry.js";
import { SWAP_MECHANISM_PIN_SCHEMA, type SwapMechanismPin } from "../../src/swap/pin.js";
import { GuardedSwapApprovalRepository, GuardedSwapRuntime, sealGuardedSwapApproval,
  validateGuardedSwapApprovalArtifact, type GuardedSwapExecutionDriver } from "../../src/swap/runtime.js";
import { temporaryState } from "./helpers.js";

const ACCOUNT = "0x1a642f0E3c3aF545E7AcBD38b07251B3990914F1";
const RECIPIENT = "0x2222222222222222222222222222222222222222";
const USDC = "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48";
const H = (c: string) => c.repeat(64);
const NOW = new Date("2026-09-18T00:01:00.000Z");
const pin: SwapMechanismPin = { schemaVersion: SWAP_MECHANISM_PIN_SCHEMA, protocolFamily: "uniswap_ethereum", networkFamily: "evm",
  chain: "eip155:1", protocolVersion: "2.2.0", constructorKind: "sdk", constructorIdentity: "owner.sdk", constructorVersion: "1.0.0",
  routerProgramIdentity: "0x1111111111111111111111111111111111111111", auxiliaryContractProgramIdentities: [], quoteSchemaVersion: "1.0.0",
  transactionSchemaVersion: "1.0.0", validationPolicyIdentity: "owner.validation", validationPolicyVersion: "1.0.0" };
const quoteInput: SwapQuoteInput = { profile: "runtime-swap", account: ACCOUNT, recipient: RECIPIENT,
  sourceAsset: { chain: "eip155:1", kind: "native", identifier: null }, destinationAsset: { chain: "eip155:1", kind: "token", identifier: USDC },
  inputAmountAtomic: "100", expectedOutputAtomic: "100", minimumOutputAtomic: "99", slippageBps: 100,
  effectiveAt: "2026-09-18T00:00:00.000Z", expiresAt: "2026-09-18T00:05:00.000Z", providerResponseHash: H("a"),
  routeHash: H("b"), unsignedTransactionPayloadHash: H("c"), simulation: { requestHash: H("d"), resultHash: H("e"), success: true,
    blockNumber: "100", blockHash: `0x${H("1")}`, headBlockNumber: "101", maxHeadDrift: 2, gasEstimate: "100000" } };

async function fixture(root: string, options: { readonly admitted?: boolean; readonly typingMs?: number } = {}) {
  const inventory = loadAllowlistInventory(), overlay: AllowlistPolicyOverlayInput = { overlayVersion: "runtime-swap.1", profile: "runtime-swap",
    account: ACCOUNT, datasetVersion: inventory.dataset.version, datasetSha256: inventory.dataset.sha256, inventorySha256: inventory.inventorySha256,
    effectiveAt: "2026-09-18T00:00:00.000Z", expiresAt: "2026-09-18T00:05:00.000Z", admissions: [
      { chain: "eip155:1", kind: "native", rail: "swap", maximumPerTransferAtomic: "100", dailyLimitAtomic: "100", mechanism: pin },
      { chain: "eip155:1", kind: "token", identifier: USDC, rail: "swap", maximumPerTransferAtomic: "100", dailyLimitAtomic: "100", mechanism: pin },
    ] };
  const policy = compileAllowlistPolicyOverlay(overlay).registry;
  const protocols = compileSwapProtocolRegistry({ registryVersion: "runtime-swap.1", pins: [pin] });
  const operations = new SwapOperationRepository(root), usage = new AssetUsageLedger(root), approvals = new GuardedSwapApprovalRepository(root);
  const quote = createSwapQuote(quoteInput), material = { quote, approvalCapAtomic: "0",
    gasOrEnergy: { gasLimit: "100000", maxFeePerGas: "2", maxPriorityFeePerGas: "1", executionHead: "101" }, execution: { unsigned: true } };
  let runtime!: GuardedSwapRuntime<any>, sends = 0, observes = 0, admissionCalls = 0, clockMs = NOW.getTime();
  const clock = { now: () => new Date(clockMs) };
  const execution: GuardedSwapExecutionDriver = {
    async execute(input) { sends++; let op = await runtime.service.markSubmitting(input.operation, input.now);
      return await runtime.service.recordPossibleSend(op, "unknown_finality", input.now); },
    async observe(input) { observes++; return input.operation; },
  };
  runtime = new GuardedSwapRuntime({ chain: "eip155:1", builder: { async quote() { return material; }, async load(hash) { return hash === quote.quoteHash ? material : null; } },
    policy: async (profile) => options.admitted === false || profile !== "runtime-swap" ? null : policy, clock,
    protocolRegistry: protocols, usage, operations, approvals,
    ownerAdmission: { async assert() { admissionCalls++; } },
    foregroundApproval: { async approve(intent) { clockMs += options.typingMs ?? 0; return sealGuardedSwapApproval(intent, clock.now(), H("f")); } }, execution,
    rpc: {}, effectStore: {}, signer: {}, sender: {}, observer: {}, caps: { gasLimit: "100000", maxFeePerGas: "2" } });
  return { runtime, quote, approvals, operations, counters: () => ({ sends, observes, admissionCalls }),
    setClock: (value: Date) => { clockMs = value.getTime(); } };
}

test("explicit runtime prepares, separately approves, and only execute crosses the durable marker", async (t) => {
  const temporary = await temporaryState(); t.after(temporary.cleanup); const f = await fixture(temporary.root);
  const prepared = await f.runtime.prepare({ profile: "runtime-swap", quoteHash: f.quote.quoteHash, idempotencyKey: "runtime-swap-0001" }, NOW);
  assert.equal(prepared.state, "awaiting_approval"); assert.deepEqual(f.counters(), { sends: 0, observes: 0, admissionCalls: 0 });
  const approved = await f.runtime.approve(prepared.operationId, NOW);
  assert.equal(approved.state, "reserved"); assert.equal(approved.submissionMarker, null);
  assert.deepEqual(f.counters(), { sends: 0, observes: 0, admissionCalls: 1 });
  const executed = await f.runtime.execute(prepared.operationId, NOW);
  assert.equal(executed.state, "unknown_finality"); assert.notEqual(executed.submissionMarker, null);
  assert.deepEqual(f.counters(), { sends: 1, observes: 0, admissionCalls: 2 });
  const resumed = await f.runtime.execute(prepared.operationId, NOW);
  assert.equal(resumed.integrityHash, executed.integrityHash); assert.deepEqual(f.counters(), { sends: 1, observes: 1, admissionCalls: 2 });
});

test("approval artifacts bind every displayed field and expire before execution", async (t) => {
  const temporary = await temporaryState(); t.after(temporary.cleanup); const f = await fixture(temporary.root);
  const op = await f.runtime.prepare({ profile: "runtime-swap", quoteHash: f.quote.quoteHash, idempotencyKey: "runtime-swap-0002" }, NOW);
  const intent = { operationId: op.operationId, profile: op.quote.profile, account: op.quote.account, recipient: op.quote.recipient,
    inputAmountAtomic: op.quote.inputAmountAtomic, expectedOutputAtomic: op.quote.expectedOutputAtomic,
    minimumOutputAtomic: op.quote.minimumOutputAtomic, slippageBps: op.quote.slippageBps,
    gasOrEnergy: { gasLimit: "100000" }, deadline: op.quote.expiresAt, quoteHash: op.quote.quoteHash,
    policyDigest: op.policyDigest, mechanismDigest: op.mechanismDigest, protocolRegistryDigest: op.protocolRegistryDigest };
  const artifact = sealGuardedSwapApproval(intent, NOW, H("f"));
  assert.equal(validateGuardedSwapApprovalArtifact(artifact, op, intent, NOW).artifactHash, artifact.artifactHash);
  assert.throws(() => validateGuardedSwapApprovalArtifact({ ...artifact, minimumOutputAtomic: "98" }, op, undefined, NOW), { code: "APN_OPERATION_BLOCKED" });
  assert.throws(() => validateGuardedSwapApprovalArtifact(artifact, op, intent, new Date(op.quote.expiresAt)), { code: "APN_OPERATION_BLOCKED" });
});

test("runtime construction requires all effectful dependencies and uses no network default", async (t) => {
  const temporary = await temporaryState(); t.after(temporary.cleanup); const f = await fixture(temporary.root);
  const dependencies: any = f.runtime.dependencies;
  assert.throws(() => new GuardedSwapRuntime({ ...dependencies, rpc: undefined }), { code: "APN_INVALID_INPUT" });
  const state = new StateStore(temporary.root); await state.initialize();
  assert.equal((await f.operations.loadAny(H("0"))), null);
});

test("a human who types for 45 seconds is not refused: consent and reservation use the post-prompt clock", async (t) => {
  const temporary = await temporaryState(); t.after(temporary.cleanup); const f = await fixture(temporary.root, { typingMs: 45_000 });
  const prepared = await f.runtime.prepare({ profile: "runtime-swap", quoteHash: f.quote.quoteHash, idempotencyKey: "runtime-swap-0003" }, NOW);
  const executed = await f.runtime.approveAndExecute(prepared.operationId, NOW);
  assert.equal(executed.state, "unknown_finality"); assert.equal(f.counters().sends, 1);
  assert.equal(executed.usageLease?.reservedAt, new Date(NOW.getTime() + 45_000).toISOString());
});

test("no active owner admission refuses preparation with a stable classification", async (t) => {
  const temporary = await temporaryState(); t.after(temporary.cleanup); const f = await fixture(temporary.root, { admitted: false });
  await assert.rejects(f.runtime.prepare({ profile: "runtime-swap", quoteHash: f.quote.quoteHash, idempotencyKey: "runtime-swap-0004" }, NOW),
    (error: any) => error.code === "APN_OPERATION_BLOCKED" && error.details?.reason === "swap_owner_admission_required");
  assert.equal(f.counters().sends, 0);
});

test("an approved reservation that outlives its deadline or loses its consent is released unsigned", async (t) => {
  const temporary = await temporaryState(); t.after(temporary.cleanup); const f = await fixture(temporary.root);
  const prepared = await f.runtime.prepare({ profile: "runtime-swap", quoteHash: f.quote.quoteHash, idempotencyKey: "runtime-swap-0005" }, NOW);
  await f.runtime.approve(prepared.operationId, NOW);
  f.setClock(new Date(prepared.quote.expiresAt));
  const released = await f.runtime.execute(prepared.operationId, new Date(prepared.quote.expiresAt));
  assert.equal(released.state, "failed_before_effect"); assert.equal(released.usageLease?.state, "failed_before_effect");
  assert.equal(released.submissionMarker, null); assert.equal(f.counters().sends, 0);
});
