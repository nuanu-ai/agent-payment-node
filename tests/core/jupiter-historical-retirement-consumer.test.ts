import test, { mock } from "node:test";
import assert from "node:assert/strict";
import { link, mkdir, open, readFile, readdir, unlink, writeFile } from "node:fs/promises";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { canonicalJson, domainHash, hashObject, sha256 } from "../../src/canonical.js";
import { sealAssetPolicyRegistry } from "../../src/asset-policy-registry.js";
import { AssetUsageLedger } from "../../src/asset-usage-ledger.js";
import type { ActiveAssetPolicy } from "../../src/allowlist-active-policy.js";
import { SecureStateStore } from "../../src/secure-state-store.js";
import { StateStore } from "../../src/state.js";
import { createSwapQuote } from "../../src/swap/quote.js";
import { newSwapOperation } from "../../src/swap/model.js";
import { transitionSwapOperation } from "../../src/swap/transitions.js";
import { SwapOperationRepository } from "../../src/swap/repository.js";
import { swapMechanismDigest } from "../../src/swap/pin.js";
import { HISTORICAL_JUPITER_IDS, HISTORICAL_JUPITER_OWNER_PROFILE,
  HISTORICAL_JUPITER_ACCOUNT_BINDING, HISTORICAL_JUPITER_PAYER } from "../../src/swap/jupiter-solana/historical-pins.js";
import { SOLANA_MAINNET_GENESIS, SOLANA_USDC_MINT } from "../../src/swap/jupiter-solana/catalog.js";
import { JUPITER_V1_OLD_ROUTE } from "../../src/swap/jupiter-solana/v1-route-config.js";
import { calculateHistoricalRetirementPolicy } from "../../src/swap/jupiter-solana/historical-retirement-policy.js";
import { HISTORICAL_RETIREMENT_IDENTITY as identity, HISTORICAL_RETIREMENT_NAMESPACE as recordNamespace,
  HISTORICAL_RETIREMENT_SCHEMA, historicalRetirementBucketHash, sealHistoricalRetirementRecord,
  type HistoricalRetirementRecord } from "../../src/swap/jupiter-solana/historical-retirement-record.js";
import { historicalRetirementRootSnapshot, JupiterHistoricalRetirementReader } from "../../src/swap/jupiter-solana/historical-retirement-reader.js";
import { temporaryState } from "./helpers.js";
import { verifyJupiterCanonicalFutureInvalidity as realCanonicalVerifier,
  type JupiterFutureInvalidityInput, type JupiterFutureInvalidityReadPort } from "../../src/swap/jupiter-solana/canonical-future-invalidity.js";
import { checkedJupiterV1QuoteRpcLifetime as realCheckedLifetime } from "../../src/swap/jupiter-solana/v1-material.js";
import { parseLifetime as realParseLifetime } from "../../src/swap/jupiter-solana/canonical-future-invalidity-parsing.js";

// These explicit module mocks exercise C2's storage/recovery boundaries only. They do not mint a
// production owner token, prove genuine C1 private-origin authority, or call live RPC.
let currentToken: object | undefined;
let currentContext: any;
let currentActive: ActiveAssetPolicy | undefined;
let currentWitness: any;
let canonicalCalls = 0;
let exerciseRealCanonical = false;
let realReadCalls = 0;
let realVerifierInput: JupiterFutureInvalidityInput | undefined;
let policyDecodeCalls = 0;
let policyDecodeHook: (() => void) | undefined;
const ownerMock = {
  async claimOwnedJupiterRetirementScope(token: unknown, context: unknown): Promise<void> {
    if (token !== currentToken || context !== currentContext) throw new Error("test scope mismatch");
  },
  async assertOwnedJupiterRetirementScope(token: unknown, context: unknown): Promise<void> {
    if (token !== currentToken || context !== currentContext) throw new Error("test scope mismatch");
  },
};
mock.module("../../src/swap/jupiter-solana/historical-retirement-owner.js", { namedExports: ownerMock });
mock.module("../../src/swap/jupiter-solana/canonical-future-invalidity.js", { namedExports: {
  adaptJupiterFutureInvalidityReadPort: (rpc: { readonly originHash: string }) => ({ originHash: rpc.originHash,
    async read(method: string): Promise<unknown> {
      if (!exerciseRealCanonical) return null;
      realReadCalls += 1;
      if (method === "getGenesisHash") return SOLANA_MAINNET_GENESIS;
      if (method === "getBlocks") return [];
      assert.fail("Unexpected frozen canonical read");
    } }),
  async verifyJupiterCanonicalFutureInvalidity(_input: unknown, providers: readonly { readonly originHash: string }[]): Promise<unknown> {
    canonicalCalls += 1;
    assert.equal(providers.length, 2);
    assert.notEqual(providers[0]!.originHash, providers[1]!.originHash);
    if (exerciseRealCanonical) {
      realVerifierInput = _input as JupiterFutureInvalidityInput;
      return await realCanonicalVerifier(realVerifierInput, providers as readonly JupiterFutureInvalidityReadPort[]);
    }
    return currentWitness;
  },
} });
mock.module("../../src/allowlist-active-policy.js", { namedExports: {
  activeAssetPolicyFromState(): ActiveAssetPolicy {
    policyDecodeCalls += 1;
    policyDecodeHook?.();
    if (currentActive === undefined) throw new Error("test policy unavailable");
    return currentActive;
  },
} });
mock.module("../../src/swap/jupiter-solana/v1-effects.js", { namedExports: {
  validateJupiterV1ExecutionBinding: (binding: unknown) => binding,
  async verifySignedJupiterV1Transaction(): Promise<void> {},
} });
mock.module("../../src/swap/jupiter-solana/v1-material.js", { namedExports: {
  validateJupiterV1Material: (value: unknown) => value,
  validateJupiterV1PreparedMaterial: (value: unknown) => value,
} });
mock.module("../../src/swap/jupiter-solana/historical-wire.js", { namedExports: {
  assertHistoricalOrdinaryRecentBlockhash(): void {},
} });
const { consumeJupiterHistoricalRetirement, recoverCommittedJupiterHistoricalRetirement } =
  await import("../../src/swap/jupiter-solana/historical-retirement-consumer.js");

const H = (digit: string): string => digit.repeat(64);
const blockhash = "1".repeat(32);
function policy(): ActiveAssetPolicy {
  const registry = sealAssetPolicyRegistry({ schemaVersion: "apn.asset-policy-registry.v1", registryVersion: "test-retirement.1",
    publishedAt: "2026-10-09T00:00:00.000Z", effectiveDate: "2026-10-09", effectiveAt: "2026-10-09T00:00:00.000Z",
    expiresAt: "2026-10-12T00:00:00.000Z", chains: [{ chain: identity.chain, family: "solana", name: "Solana", assets: [
      { kind: "native", identifier: null, symbol: "SOL", decimals: 9,
        rails: { direct: false, gasless: false, x402: false, bridge: false, swap: true },
        caps: { maximumPerTransferAtomic: "6000000", dailyLimitAtomic: "30000000" }, mechanismPins: { swap: JUPITER_V1_OLD_ROUTE.mechanismPin } },
      { kind: "token", identifier: SOLANA_USDC_MINT, symbol: "USDC", decimals: 6,
        rails: { direct: false, gasless: false, x402: false, bridge: false, swap: true },
        caps: { maximumPerTransferAtomic: "500000", dailyLimitAtomic: "500000" }, mechanismPins: { swap: JUPITER_V1_OLD_ROUTE.mechanismPin } },
    ] }] });
  return { profile: "solana-local", registry, digest: registry.policyDigest, revision: 1,
    accounts: { solana: HISTORICAL_JUPITER_PAYER }, activationDigest: H("a"), activatedAt: "2026-10-09T00:00:00.000Z" };
}

class TestScopeState extends StateStore {
  directoryGuard(): any {
    return { root: this.root, async check(): Promise<void> {} };
  }
}

async function fixture(root: string) {
  const active = policy(), ledger = new AssetUsageLedger(root), operationId = HISTORICAL_JUPITER_IDS[0]!, idempotencyHash = H("1");
  const now = new Date();
  const q = createSwapQuote({ profile: "solana-local", account: identity.account, recipient: identity.account,
    sourceAsset: { ...identity.asset, chain: identity.chain }, destinationAsset: { chain: identity.chain, kind: "token", identifier: SOLANA_USDC_MINT },
    inputAmountAtomic: "1000000", expectedOutputAtomic: "100000", minimumOutputAtomic: "99500", slippageBps: 50,
    effectiveAt: "2026-10-09T00:00:00.000Z", expiresAt: "2026-10-10T23:59:59.000Z",
    providerResponseHash: H("b"), routeHash: H("c"), unsignedTransactionPayloadHash: H("d"),
    simulation: { requestHash: H("e"), resultHash: H("f"), success: true, blockNumber: "100",
      blockHash: `0x${H("1")}`, headBlockNumber: "100", maxHeadDrift: 0, gasEstimate: "1000" } });
  let operation = newSwapOperation({ operationId, idempotencyHash, quote: q, policyDigest: active.digest,
    policyVersion: active.registry.registryVersion, protocolRegistryDigest: JUPITER_V1_OLD_ROUTE.protocolRegistry.registryDigest,
    protocolRegistryVersion: JUPITER_V1_OLD_ROUTE.protocolRegistry.registryVersion,
    mechanismDigest: swapMechanismDigest(JUPITER_V1_OLD_ROUTE.mechanismPin), approvalCapAtomic: "0",
    now: new Date(now.getTime() - 60_000) });
  const old = new Date(now.getTime() - 50_000);
  operation = transitionSwapOperation(operation, "prepared", {}, old);
  operation = transitionSwapOperation(operation, "awaiting_approval", {}, old);
  const lease = await ledger.reserve({ ...identity, registry: active.registry, rail: "swap", amountAtomic: "1000000",
    idempotencyKey: `swap-${idempotencyHash}`, now: old });
  operation = transitionSwapOperation(operation, "reserved", { usageLease: lease }, old);
  const markerBody = { operationId, operationIntegrityHash: operation.integrityHash,
    unsignedTransactionPayloadHash: q.unsignedTransactionPayloadHash, markedAt: old.toISOString() };
  operation = transitionSwapOperation(operation, "submitting", { submissionMarker: {
    operationIntegrityHash: markerBody.operationIntegrityHash, unsignedTransactionPayloadHash: markerBody.unsignedTransactionPayloadHash,
    markedAt: markerBody.markedAt, markerHash: domainHash("apn.swap-submission-marker.v1", canonicalJson(markerBody)),
  } }, old);
  const unknown = await ledger.transition({ ...identity, reservationId: lease.reservationId, policyDigest: lease.policyDigest,
    state: "unknown_finality", now: old });
  operation = transitionSwapOperation(operation, "unknown_finality", { usageLease: unknown }, old);
  await new SwapOperationRepository(root).create(operation);
  const leasePath = join(root, "asset-usage", historicalRetirementBucketHash(), `${unknown.reservationId}.json`);
  const leaseBytes = await readFile(leasePath);
  const operationPath = join(root, "swap-operations", operation.ownerProfileHash, `${operation.operationId}.json`);
  const operationBytes = await readFile(operationPath);
  await mkdir(join(root, "receipts", operation.ownerProfileHash), { recursive: true, mode: 0o700 });
  const originalReceiptPath = join(root, "receipts", operation.ownerProfileHash, `${operation.operationId}.json`);
  const originalReceiptBytes = Buffer.from(`${canonicalJson({ schemaVersion: "test.original-receipt.v1", operationId })}\n`);
  await writeFile(originalReceiptPath, originalReceiptBytes, { mode: 0o600 });

  const authenticatedAt = new Date(Date.now() - 1_000).toISOString();
  const authenticationExpiresAt = new Date(Date.now() + 55_000).toISOString();
  const authentication = { schemaVersion: "apn.jupiter-historical-authentication.v1" as const, operationId,
    operationIntegrityHash: operation.integrityHash, rootBinding: hashObject({ root }), ownerProfileHash: operation.ownerProfileHash,
    accountBindingHash: HISTORICAL_JUPITER_ACCOUNT_BINDING, payer: identity.account, policyDigest: operation.policyDigest,
    activationDigest: H("a"), originalBindingHash: H("b"), originalMaterialDigest: H("c"), freshMaterialDigest: H("d"),
    markerHash: operation.submissionMarker!.markerHash, principalLamports: "1000000", maximumNativeExpenseLamports: "6000000",
    freshMaximumNativeExpenseLamports: "6000000", networkFeeLamports: "6400", tokenAccountRentLamports: "1488440",
    genesis: SOLANA_MAINNET_GENESIS, blockhash, lastValidBlockHeight: "300", signature: "1".repeat(88), rawPayloadHash: H("9"),
    messageHash: H("8"), freshBlockhash: blockhash, freshLastValidBlockHeight: "300",
    heightBinding: "authenticated_material_not_signed_message" as const,
    originalQuoteRpcLifetime: { source: "configured_mainnet_rpc_before_quote_freeze" as const, rpcOriginHash: H("7"),
      contextSlot: "120", minimumContextSlot: "100", blockhash, lastValidBlockHeight: "300" },
    lifetimeProvenance: "configured_mainnet_rpc_before_quote_freeze" as const,
    retainedClaimEvidence: { kind: "retained_send_claim_present" as const, claimHash: H("6"), signedMarkerSnapshotHash: H("5") },
    ordinaryRecentBlockhash: true as const, authenticatedAt, authenticationExpiresAt };
  const proofBody = { schemaVersion: "apn.jupiter-canonical-future-invalidity.v1" as const,
    scope: "blockhash_future_invalidity_only" as const, outcome: "future_invalidity_witness" as const,
    inputHash: H("4"), transactionHash: authentication.rawPayloadHash, messageHash: authentication.messageHash,
    signatureHash: sha256(authentication.signature), blockhash, quoteContextSlot: "120", searchedStartSlot: "56",
    birth: { slot: "100", blockHeight: "200", blockhash },
    finalizedAnchor: { slot: "400", blockHeight: "400", blockhash: "2".repeat(32) },
    processingAge: { documentedMaximumProcessingAge: 150 as const, requiredConservativeFinalizedHeight: "352" },
    quoteLastValidBlockHeight: "300", providers: [
      { originHash: H("2"), finalizedSlot: "400", finalizedBlockHeight: "400", isBlockhashValid: false as const,
        signatureStatusObservation: "not_reported" as const, readCount: 20 },
      { originHash: H("3"), finalizedSlot: "400", finalizedBlockHeight: "400", isBlockhashValid: false as const,
        signatureStatusObservation: "not_reported" as const, readCount: 20 },
    ] };
  const witness = { ...proofBody, resultHash: hashObject(proofBody) };
  const usage = await ledger.usage(identity, now);
  const record = sealHistoricalRetirementRecord({ schemaVersion: HISTORICAL_RETIREMENT_SCHEMA, kind: "retired_unknown", operationId,
    ownerProfileHash: operation.ownerProfileHash, rootSnapshotHash: await historicalRetirementRootSnapshot(root),
    bucketHash: historicalRetirementBucketHash(), originalOperation: operation, originalReservationRawHash: sha256(leaseBytes),
    authentication, canonicalProof: witness, currentPolicy: { registry: active.registry, activationDigest: active.activationDigest,
      revision: active.revision, activatedAt: active.activatedAt },
    policyAdmission: calculateHistoricalRetirementPolicy(active, operationId, usage.amountAtomic, "0", q.minimumOutputAtomic, now),
    accountingAt: now.toISOString(), conservativeTotalAtomic: "6000000", additionalAdmissionAtomic: "5000000",
    historicalOutcome: "unknown", transactionMayHaveBeenSubmitted: true, actualNativeFeeAtomic: null, effectAt: null });
  const state = new TestScopeState(root);
  await state.initialize();
  const token = Object.freeze({ testOnly: true });
  const material = { execution: { quoteRpcLifetime: authentication.originalQuoteRpcLifetime } };
  const fresh = { materialDigest: authentication.freshMaterialDigest, lifetime: { blockhash }, compiledAccounts: [], rawInstructions: [] };
  const binding = { operationId, markerHash: operation.submissionMarker!.markerHash,
    messageHash: authentication.messageHash, freshMaterialDigest: fresh.materialDigest };
  const effect = { operationId, transactionId: authentication.signature, rawPayloadHash: authentication.rawPayloadHash,
    rawPayload: "test-only-signed-payload", fingerprint: "test-only" };
  const context = Object.freeze({ state, operation, material, fresh, binding, effect, projection: authentication,
    activePolicy: active, deadline: authenticationExpiresAt });
  return { active, context, effect, leaseBytes, leasePath, operationBytes, operationPath, originalReceiptBytes,
    originalReceiptPath, record, state, token, witness };
}

function activate(f: Awaited<ReturnType<typeof fixture>>): void {
  currentToken = f.token;
  currentContext = f.context;
  currentActive = f.active;
  currentWitness = f.witness;
}

async function stageExactAccountingTemp(f: Awaited<ReturnType<typeof fixture>>, publishLink: boolean): Promise<{
  target: string; temporary: string;
}> {
  const operationId = f.context.operation.operationId;
  const directory = join(f.context.state.root, recordNamespace);
  await mkdir(directory, { mode: 0o700 });
  const target = join(directory, `${operationId}.json`);
  const temporary = join(directory, `.${sha256(target).slice(0, 12)}.${"a".repeat(24)}.tmp`);
  await writeFile(temporary, `${canonicalJson(f.record)}\n`, { mode: 0o600, flag: "wx" });
  if (publishLink) await link(temporary, target);
  return { target, temporary };
}

async function stageExactProjectionTemp(f: Awaited<ReturnType<typeof fixture>>, namespace: string,
  linkTarget: boolean): Promise<{ target: string; temporary: string; expectedBytes: Buffer }> {
  const operationId = f.context.operation.operationId;
  const target = join(f.context.state.root, namespace, `${operationId}.json`);
  const expectedBytes = await readFile(target);
  const temporary = join(f.context.state.root, namespace, `.${sha256(target).slice(0, 12)}.${"b".repeat(24)}.tmp`);
  if (linkTarget) await link(target, temporary);
  else {
    await unlink(target);
    await writeFile(temporary, expectedBytes, { mode: 0o600, flag: "wx" });
  }
  return { target, temporary, expectedBytes };
}

async function runConsumer(f: Awaited<ReturnType<typeof fixture>>) {
  activate(f);
  return await consumeJupiterHistoricalRetirement(f.token as never, f.context as never);
}

async function assertOriginalBytes(f: Awaited<ReturnType<typeof fixture>>): Promise<void> {
  assert.deepEqual(await readFile(f.leasePath), f.leaseBytes);
  assert.deepEqual(await readFile(f.operationPath), f.operationBytes);
  assert.deepEqual(await readFile(f.originalReceiptPath), f.originalReceiptBytes);
}

test("TEST-MOCKED C2 writer commits one UNKNOWN record then separate journal/typed receipt without touching originals", async t => {
  const tmp = await temporaryState(); t.after(tmp.cleanup);
  const f = await fixture(tmp.root); activate(f);
  const policyReadsBefore = policyDecodeCalls, rpcCallsBefore = canonicalCalls;
  const result = await runConsumer(f);
  assert.equal(result.status, "retired_unknown");
  assert.equal(result.conservativeNativeAmount, "6000000");
  assert.equal(result.additionalAdmissionNativeAmount, "5000000");
  assert.equal(result.actualNativeFee, null);
  assert.equal(result.effectAt, null);
  assert.equal(result.transactionOutcome, "unknown");
  assert.equal(result.transactionMayHaveBeenSubmitted, true);
  assert.equal(result.idempotentRecovered, false);
  assert.equal(policyDecodeCalls, policyReadsBefore + 2, "the create-only publication seam rechecks live policy");
  assert.equal(canonicalCalls, rpcCallsBefore + 1);
  assert.deepEqual(await readdir(join(tmp.root, recordNamespace)), [`${result.operationId}.json`]);
  assert.deepEqual(await readdir(join(tmp.root, "jupiter-historical-retirement-journals")), [`${result.operationId}.json`]);
  assert.deepEqual(await readdir(join(tmp.root, "jupiter-historical-retirement-receipts")), [`${result.operationId}.json`]);
  await assertOriginalBytes(f);
  const recovered = await recoverCommittedJupiterHistoricalRetirement(result.operationId, f.state as never);
  assert.equal(recovered?.retirementRecordHash, result.retirementRecordHash);
  assert.equal(recovered?.idempotentRecovered, true);
  await assertOriginalBytes(f);
});

test("TEST-MOCKED C2 rejects a projection bound to another root before canonical reads", async t => {
  const tmp = await temporaryState(); t.after(tmp.cleanup);
  const f = await fixture(tmp.root);
  const projection = { ...f.context.projection, rootBinding: H("f") };
  const context = Object.freeze({ ...f.context, projection });
  const token = Object.freeze({ testOnly: true });
  currentToken = token; currentContext = context; currentActive = f.active; currentWitness = f.witness;
  const before = canonicalCalls;
  await assert.rejects(consumeJupiterHistoricalRetirement(token as never, context as never));
  assert.equal(canonicalCalls, before, "root mismatch is rejected before canonical RPC work");
  await assertOriginalBytes(f);
});

for (const failAt of ["jupiter-historical-retirement-journals", "jupiter-historical-retirement-receipts"]) {
  test(`TEST-MOCKED record-first recovery repairs crash before ${failAt.split("-").at(-1)}`, async t => {
    const tmp = await temporaryState(); t.after(tmp.cleanup);
    const f = await fixture(tmp.root); activate(f);
    const path = `${failAt}/${f.context.operation.operationId}.json`;
    const prototype = SecureStateStore.prototype as any, original = prototype.writeJson;
    prototype.writeJson = async function(relativePath: string, value: unknown, createOnly?: boolean): Promise<void> {
      if (relativePath === path) throw new Error("injected crash boundary");
      return await original.call(this, relativePath, value, createOnly);
    };
    try { await assert.rejects(runConsumer(f), /injected crash boundary/u); }
    finally { prototype.writeJson = original; }
    assert.deepEqual(await readdir(join(tmp.root, recordNamespace)), [`${f.context.operation.operationId}.json`]);
    const beforePolicy = policyDecodeCalls, beforeRpc = canonicalCalls;
    const recovered = await recoverCommittedJupiterHistoricalRetirement(f.context.operation.operationId, f.state as never);
    assert.equal(recovered?.idempotentRecovered, true);
    assert.equal(policyDecodeCalls, beforePolicy, "recovery never rereads current policy");
    assert.equal(canonicalCalls, beforeRpc, "recovery never performs RPC reads");
    assert.equal((await readdir(join(tmp.root, "jupiter-historical-retirement-journals"))).length, 1);
    assert.equal((await readdir(join(tmp.root, "jupiter-historical-retirement-receipts"))).length, 1);
    await assertOriginalBytes(f);
  });
}

test("TEST-MOCKED recovery refuses a conflicting existing journal without overwriting the record or originals", async t => {
  const tmp = await temporaryState(); t.after(tmp.cleanup);
  const f = await fixture(tmp.root); const result = await runConsumer(f);
  const journalPath = join(tmp.root, "jupiter-historical-retirement-journals", `${result.operationId}.json`);
  const originalRecord = await readFile(join(tmp.root, recordNamespace, `${result.operationId}.json`));
  await writeFile(journalPath, `${canonicalJson({ schemaVersion: "apn.jupiter-historical-retirement-journal.v1", operationId: result.operationId,
    recordHash: H("f"), accountingAt: result.accountingAt, journalHash: H("e") })}\n`, { mode: 0o600 });
  await assert.rejects(recoverCommittedJupiterHistoricalRetirement(result.operationId, f.state as never));
  assert.deepEqual(await readFile(join(tmp.root, recordNamespace, `${result.operationId}.json`)), originalRecord);
  await assertOriginalBytes(f);
});

test("TEST-MOCKED orphan typed receipt blocks before the accounting record is created", async t => {
  const tmp = await temporaryState(); t.after(tmp.cleanup);
  const f = await fixture(tmp.root); activate(f);
  const dir = join(tmp.root, "jupiter-historical-retirement-receipts");
  await mkdir(dir, { mode: 0o700 });
  await writeFile(join(dir, `${f.context.operation.operationId}.json`), `${canonicalJson({ orphan: true })}\n`, { mode: 0o600 });
  await assert.rejects(runConsumer(f));
  await assert.rejects(readFile(join(tmp.root, recordNamespace, `${f.context.operation.operationId}.json`)), { code: "ENOENT" });
  await assertOriginalBytes(f);
});

test("TEST-MOCKED authority expiry after tempfile fsync blocks the final publication link", async t => {
  const tmp = await temporaryState(); t.after(tmp.cleanup);
  const f = await fixture(tmp.root); activate(f);
  const probe = await open(f.leasePath, "r");
  const handlePrototype = Object.getPrototypeOf(probe) as { sync: (...args: unknown[]) => Promise<unknown> };
  await probe.close();
  const originalSync = handlePrototype.sync, originalNow = Date.now;
  let advanced = false;
  handlePrototype.sync = async function(...args: unknown[]): Promise<unknown> {
    const value = await originalSync.apply(this, args);
    if (!advanced) {
      advanced = true;
      Date.now = () => Date.parse(f.context.deadline) + 1;
    }
    return value;
  };
  try {
    await assert.rejects(runConsumer(f), (error: unknown) => error instanceof Error && "code" in error &&
      (error as { code?: unknown }).code === "APN_OPERATION_BLOCKED");
  } finally {
    handlePrototype.sync = originalSync;
    Date.now = originalNow;
  }
  assert.equal(advanced, true, "the clock changed only after the create-only tempfile fsync");
  await assert.rejects(readFile(join(tmp.root, recordNamespace, `${f.context.operation.operationId}.json`)), { code: "ENOENT" });
  await assertOriginalBytes(f);
});

test("TEST-MOCKED raw lease bytes changed during final policy decode block record publication", async t => {
  const tmp = await temporaryState(); t.after(tmp.cleanup);
  const f = await fixture(tmp.root); activate(f);
  const before = policyDecodeCalls;
  policyDecodeHook = () => {
    if (policyDecodeCalls === before + 2) {
      // Same decoded value, but the persisted row has lost its canonical trailing newline.
      writeFileSync(f.leasePath, canonicalJson(f.context.operation.usageLease), { mode: 0o600 });
    }
  };
  try {
    await assert.rejects(runConsumer(f), (error: unknown) => error instanceof Error && "code" in error &&
      (error as { code?: unknown }).code === "APN_STATE_CORRUPT");
  } finally {
    policyDecodeHook = undefined;
  }
  assert.deepEqual(await readFile(f.leasePath), Buffer.from(canonicalJson(f.context.operation.usageLease)));
  await assert.rejects(readFile(join(tmp.root, recordNamespace, `${f.context.operation.operationId}.json`)), { code: "ENOENT" });
  assert.deepEqual(await readFile(f.operationPath), f.operationBytes);
  assert.deepEqual(await readFile(f.originalReceiptPath), f.originalReceiptBytes);
});

test("TEST-MOCKED recovery reconciles an exact record-plus-temp hardlink and returns one committed record", async t => {
  const tmp = await temporaryState(); t.after(tmp.cleanup);
  const f = await fixture(tmp.root);
  const { target, temporary } = await stageExactAccountingTemp(f, true);
  const recovered = await recoverCommittedJupiterHistoricalRetirement(f.context.operation.operationId, f.state as never);
  assert.equal(recovered?.idempotentRecovered, true);
  assert.deepEqual(await readdir(join(tmp.root, recordNamespace)), [`${f.context.operation.operationId}.json`]);
  await assert.rejects(readFile(temporary), { code: "ENOENT" });
  assert.equal((await readFile(target)).toString("utf8"), `${canonicalJson(f.record)}\n`);
  await assertOriginalBytes(f);
});

test("TEST-MOCKED recovery removes an exact temp-only record before fresh authorization retries", async t => {
  const tmp = await temporaryState(); t.after(tmp.cleanup);
  const f = await fixture(tmp.root);
  const { target, temporary } = await stageExactAccountingTemp(f, false);
  assert.equal(await recoverCommittedJupiterHistoricalRetirement(f.context.operation.operationId, f.state as never), null);
  await assert.rejects(readFile(temporary), { code: "ENOENT" });
  await assert.rejects(readFile(target), { code: "ENOENT" });
  const result = await runConsumer(f);
  assert.equal(result.status, "retired_unknown");
  assert.equal(result.idempotentRecovered, false);
  assert.deepEqual(await readdir(join(tmp.root, recordNamespace)), [`${f.context.operation.operationId}.json`]);
  await assertOriginalBytes(f);
});

for (const namespace of ["jupiter-historical-retirement-journals", "jupiter-historical-retirement-receipts"]) {
  test(`TEST-MOCKED recovery reconciles the exact ${namespace.split("-").at(-1)} target-plus-temp hardlink`, async t => {
    const tmp = await temporaryState(); t.after(tmp.cleanup);
    const f = await fixture(tmp.root); const result = await runConsumer(f);
    const { target, temporary, expectedBytes } = await stageExactProjectionTemp(f, namespace, true);
    const recovered = await recoverCommittedJupiterHistoricalRetirement(result.operationId, f.state as never);
    assert.equal(recovered?.idempotentRecovered, true);
    assert.deepEqual(await readdir(join(tmp.root, namespace)), [`${result.operationId}.json`]);
    await assert.rejects(readFile(temporary), { code: "ENOENT" });
    assert.deepEqual(await readFile(target), expectedBytes);
    await assertOriginalBytes(f);
  });

  test(`TEST-MOCKED recovery cleans the exact ${namespace.split("-").at(-1)} temp-only prefix before create`, async t => {
    const tmp = await temporaryState(); t.after(tmp.cleanup);
    const f = await fixture(tmp.root); const result = await runConsumer(f);
    const { target, temporary, expectedBytes } = await stageExactProjectionTemp(f, namespace, false);
    const recovered = await recoverCommittedJupiterHistoricalRetirement(result.operationId, f.state as never);
    assert.equal(recovered?.idempotentRecovered, true);
    assert.deepEqual(await readdir(join(tmp.root, namespace)), [`${result.operationId}.json`]);
    await assert.rejects(readFile(temporary), { code: "ENOENT" });
    assert.deepEqual(await readFile(target), expectedBytes);
    await assertOriginalBytes(f);
  });
}

test("TEST-MOCKED recovery refuses a same-bytes projection tempfile on a different inode", async t => {
  const tmp = await temporaryState(); t.after(tmp.cleanup);
  const f = await fixture(tmp.root); const result = await runConsumer(f);
  const namespace = "jupiter-historical-retirement-journals";
  const { target, temporary, expectedBytes } = await stageExactProjectionTemp(f, namespace, false);
  // Recreate the existing target so target and temp contain matching bytes but are separate inodes.
  await writeFile(target, expectedBytes, { mode: 0o600, flag: "wx" });
  await assert.rejects(recoverCommittedJupiterHistoricalRetirement(result.operationId, f.state as never));
  assert.deepEqual(await readFile(target), expectedBytes);
  assert.deepEqual(await readFile(temporary), expectedBytes);
  await assertOriginalBytes(f);
});

test("TEST-MOCKED recovery refuses an unknown projection namespace entry", async t => {
  const tmp = await temporaryState(); t.after(tmp.cleanup);
  const f = await fixture(tmp.root); const result = await runConsumer(f);
  const namespace = "jupiter-historical-retirement-receipts";
  const foreign = join(tmp.root, namespace, ".unrecognized-projection.tmp");
  const existing = await readFile(join(tmp.root, namespace, `${result.operationId}.json`));
  await writeFile(foreign, existing, { mode: 0o600, flag: "wx" });
  await assert.rejects(recoverCommittedJupiterHistoricalRetirement(result.operationId, f.state as never));
  assert.deepEqual(await readFile(foreign), existing);
  await assertOriginalBytes(f);
});

test("TEST-MOCKED reader confirms the consumer never uses the standard receipt slot", async t => {
  const tmp = await temporaryState(); t.after(tmp.cleanup);
  const f = await fixture(tmp.root); const result = await runConsumer(f);
  assert.equal(result.operationId, f.context.operation.operationId);
  assert.deepEqual(await readFile(f.originalReceiptPath), f.originalReceiptBytes);
  const rows = [f.context.operation.usageLease!];
  assert.equal((await new JupiterHistoricalRetirementReader(tmp.root).forBucket(identity, rows)).length, 1);
});


async function persistentSnapshot(root: string, prefix = ""): Promise<Record<string, string>> {
  const hashes: Record<string, string> = {};
  for (const entry of await readdir(join(root, prefix), { withFileTypes: true })) {
    if (prefix === "" && entry.name === "locks") continue;
    const path = join(prefix, entry.name);
    if (entry.isDirectory()) Object.assign(hashes, await persistentSnapshot(root, path));
    else hashes[path] = sha256(await readFile(join(root, path)));
  }
  return hashes;
}

// This case deliberately keeps the declared C2 owner/material/signature boundary doubles.
// It proves the actual caller projection seam and real canonical parser, never owner/writer positivity.
test("C2 projects validated production six-field lifetime into the real canonical verifier before empty-history refusal", async t => {
  const temp = await temporaryState(); t.after(temp.cleanup);
  const f = await fixture(temp.root); activate(f);
  const lifetime = f.context.material.execution.quoteRpcLifetime;
  assert.equal(realCheckedLifetime(lifetime), lifetime);
  assert.throws(() => realParseLifetime(lifetime), (error: unknown) =>
    error instanceof Error && "reason" in error && error.reason === "invalid_input");
  const message = Buffer.concat([Buffer.from([128, 1, 0, 1, 2]), Buffer.alloc(32, 1),
    Buffer.alloc(32, 2), Buffer.alloc(32), Buffer.from([1, 1, 0, 1, 0, 0])]);
  // Nonzero TEST signature follows routine wire-parser fixtures; no genuine cryptographic claim.
  f.effect.rawPayload = Buffer.concat([Buffer.from([1]), Buffer.alloc(64, 7), message]).toString("base64");
  const before = await persistentSnapshot(temp.root);
  exerciseRealCanonical = true; realReadCalls = 0; realVerifierInput = undefined;
  try {
    await assert.rejects(consumeJupiterHistoricalRetirement(f.token as never, f.context as never), { code: "APN_OPERATION_BLOCKED" });
    assert.equal(realReadCalls, 4);
    assert.deepEqual((realVerifierInput as JupiterFutureInvalidityInput | undefined)?.originalQuoteRpcLifetime, {
      contextSlot: lifetime.contextSlot, blockhash: lifetime.blockhash, lastValidBlockHeight: lifetime.lastValidBlockHeight,
    });
    assert.deepEqual(Object.keys(lifetime), ["source", "rpcOriginHash", "contextSlot", "minimumContextSlot", "blockhash", "lastValidBlockHeight"]);
    assert.equal(realCheckedLifetime(lifetime), lifetime);
    assert.deepEqual(await persistentSnapshot(temp.root), before);
  } finally { exerciseRealCanonical = false; }
});

test("production lifetime provenance/minimum-context checks and canonical unknown-key refusal remain strict", () => {
  const valid = { source: "configured_mainnet_rpc_before_quote_freeze", rpcOriginHash: H("7"),
    contextSlot: "120", minimumContextSlot: "100", blockhash, lastValidBlockHeight: "300" };
  assert.equal(realCheckedLifetime(valid), valid);
  for (const changed of [{ ...valid, source: "provider_raw_build" }, { ...valid, rpcOriginHash: "invalid" },
    { ...valid, minimumContextSlot: "121" }, { ...valid, contextSlot: "0" },
    { ...valid, lastValidBlockHeight: "0" }]) {
    assert.throws(() => realCheckedLifetime(changed), { code: "APN_STATE_CORRUPT" });
  }
  assert.throws(() => realCheckedLifetime({ ...valid, blockhash: "invalid" }));
  const projected = { contextSlot: valid.contextSlot, blockhash: valid.blockhash, lastValidBlockHeight: valid.lastValidBlockHeight };
  assert.deepEqual(realParseLifetime(projected), { contextSlot: 120n, blockhash, lastValidBlockHeight: 300n });
  for (const extra of ["source", "rpcOriginHash", "minimumContextSlot"]) {
    assert.throws(() => realParseLifetime({ ...projected, [extra]: valid[extra as keyof typeof valid] }),
      (error: unknown) => error instanceof Error && "reason" in error && error.reason === "invalid_input");
  }
});
