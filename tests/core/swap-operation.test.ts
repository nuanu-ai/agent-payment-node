import assert from "node:assert/strict";
import { chmod, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";
import {
  AssetUsageLedger, GuardedSwapService, SWAP_MECHANISM_PIN_SCHEMA, SwapOperationRepository,
  compileAllowlistPolicyOverlay, compileSwapProtocolRegistry, loadAllowlistInventory, sealAssetPolicyRegistry, type AllowlistPolicyOverlayInput,
  type SwapMechanismPin, type SwapQuoteInput,
} from "../../src/core.js";
import { temporaryState } from "./helpers.js";

const ACCOUNT = "0x1a642f0E3c3aF545E7AcBD38b07251B3990914F1", RECIPIENT = "0x2222222222222222222222222222222222222222";
const USDC = "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48", H = (letter: string) => letter.repeat(64);
const inventory = loadAllowlistInventory();
const pin: SwapMechanismPin = { schemaVersion: SWAP_MECHANISM_PIN_SCHEMA, protocolFamily: "uniswap_ethereum", networkFamily: "evm",
  chain: "eip155:1", protocolVersion: "2.2.0", constructorKind: "sdk", constructorIdentity: "owner.sdk", constructorVersion: "1.0.0",
  routerProgramIdentity: "0x1111111111111111111111111111111111111111", auxiliaryContractProgramIdentities: ["0x2222222222222222222222222222222222222222"], quoteSchemaVersion: "1.0.0",
  transactionSchemaVersion: "1.0.0", validationPolicyIdentity: "owner.validation", validationPolicyVersion: "1.0.0" };
const overlay: AllowlistPolicyOverlayInput = { overlayVersion: "swap-owner.1", profile: "swap-op", account: ACCOUNT,
  datasetVersion: inventory.dataset.version, datasetSha256: inventory.dataset.sha256, inventorySha256: inventory.inventorySha256,
  effectiveAt: "2026-09-18T00:00:00.000Z", expiresAt: "2026-09-19T00:00:00.000Z", admissions: [{ chain: "eip155:1",
    kind: "native", rail: "swap", maximumPerTransferAtomic: "100", dailyLimitAtomic: "100", mechanism: pin }, { chain: "eip155:1",
    kind: "token", identifier: USDC, rail: "swap", maximumPerTransferAtomic: "100", dailyLimitAtomic: "100", mechanism: pin }] };
const quote: SwapQuoteInput = { profile: "swap-op", account: ACCOUNT, recipient: RECIPIENT,
  sourceAsset: { chain: "eip155:1", kind: "native", identifier: null }, destinationAsset: { chain: "eip155:1", kind: "token", identifier: USDC },
  inputAmountAtomic: "100", expectedOutputAtomic: "100", minimumOutputAtomic: "99", slippageBps: 100,
  effectiveAt: "2026-09-18T00:00:00.000Z", expiresAt: "2026-09-18T00:05:00.000Z", providerResponseHash: H("a"),
  routeHash: H("b"), unsignedTransactionPayloadHash: H("c"), simulation: { requestHash: H("d"), resultHash: H("e"), success: true,
    blockNumber: "100", blockHash: `0x${H("1")}`, headBlockNumber: "101", maxHeadDrift: 2, gasEstimate: "100000" } };

async function fixture(root: string) {
  const operations = new SwapOperationRepository(root), usage = new AssetUsageLedger(root), service = new GuardedSwapService(operations, usage);
  const compiled = compileAllowlistPolicyOverlay(overlay).registry;
  const policy = sealAssetPolicyRegistry({ schemaVersion: compiled.schemaVersion, registryVersion: compiled.registryVersion,
    publishedAt: compiled.publishedAt, effectiveDate: compiled.effectiveDate,
    ...(compiled.effectiveAt === undefined ? {} : { effectiveAt: compiled.effectiveAt }),
    ...(compiled.expiresAt === undefined ? {} : { expiresAt: compiled.expiresAt }),
    chains: compiled.chains.map((chain) => ({ ...chain, assets: chain.assets.map((asset) =>
      ({ ...asset, rails: { ...asset.rails, direct: true } })) })) });
  const protocols = compileSwapProtocolRegistry({ registryVersion: "owner.1", pins: [pin] });
  const op = await service.prepare({ quote, assetPolicy: policy, protocolRegistry: protocols, idempotencyKey: "swap-operation-0001",
    approvalCapAtomic: "100", now: new Date("2026-09-18T00:01:00.000Z") });
  return { operations, usage, service, policy, protocols, op };
}

test("prepare validates policy/mechanism/simulation and approval is exact-bounded", async (t) => {
  const temporary = await temporaryState(); t.after(temporary.cleanup); const { service, policy, protocols, op } = await fixture(temporary.root);
  assert.equal(op.state, "awaiting_approval"); assert.equal(op.quote.simulation.success, true); assert.equal(op.approvalCapAtomic, "100");
  const replay = await service.prepare({ quote, assetPolicy: policy, protocolRegistry: protocols, idempotencyKey: "swap-operation-0001",
    approvalCapAtomic: "100", now: new Date("2026-09-18T00:01:30.000Z") });
  assert.equal(replay.integrityHash, op.integrityHash);
  await assert.rejects(service.prepare({ quote, assetPolicy: policy, protocolRegistry: protocols, idempotencyKey: "swap-overflow-0001",
    approvalCapAtomic: "101", now: new Date("2026-09-18T00:01:00.000Z") }), { code: "APN_INVALID_INPUT" });
  await assert.rejects(service.prepare({ quote, assetPolicy: policy, protocolRegistry: protocols, idempotencyKey: "swap-unlimited-0001",
    approvalCapAtomic: ((1n << 256n) - 1n).toString(), now: new Date("2026-09-18T00:01:00.000Z") }), { code: "APN_INVALID_INPUT" });
  await assert.rejects(service.prepare({ quote, assetPolicy: policy, protocolRegistry: compileSwapProtocolRegistry({ registryVersion: "empty.1", pins: [] }),
    idempotencyKey: "swap-pin-substitute", approvalCapAtomic: "100", now: new Date("2026-09-18T00:01:00.000Z") }), { code: "APN_OPERATION_BLOCKED" });
  await assert.rejects(service.prepare({ quote, assetPolicy: policy, protocolRegistry: protocols, idempotencyKey: "swap-expired-00001",
    approvalCapAtomic: "100", now: new Date("2026-09-18T00:05:00.000Z") }), { code: "APN_INVALID_INPUT" });
});

test("shared ledger aggregates swap with other rails and releases only proven pre-effect failure", async (t) => {
  const temporary = await temporaryState(); t.after(temporary.cleanup); const { service, usage, policy, op } = await fixture(temporary.root);
  const reserved = await service.reserve(op, policy, new Date("2026-09-18T00:01:01.000Z")); assert.equal(reserved.state, "reserved");
  await assert.rejects(usage.reserve({ account: ACCOUNT, chain: "eip155:1", asset: { kind: "native", identifier: null }, registry: policy,
    rail: "direct", amountAtomic: "1", idempotencyKey: "cross-rail-after-swap", now: new Date("2026-09-18T00:01:02.000Z") }),
  { code: "APN_OPERATION_BLOCKED" });
  const failed = await service.failBeforeEffect(reserved, new Date("2026-09-18T00:01:03.000Z"), H("f"));
  assert.equal(failed.state, "failed_before_effect"); assert.equal(failed.usageLease?.state, "failed_before_effect");
  assert.equal((await usage.reserve({ account: ACCOUNT, chain: "eip155:1", asset: { kind: "native", identifier: null }, registry: policy,
    rail: "direct", amountAtomic: "100", idempotencyKey: "cross-rail-after-release", now: new Date("2026-09-18T00:01:04.000Z") })).amountAtomic, "100");
});

test("runtime validation rejects operation, policy and expiry substitution before a ledger effect", async (t) => {
  const temporary = await temporaryState(); t.after(temporary.cleanup); const { service, usage, policy, op } = await fixture(temporary.root);
  const forged: any = structuredClone(op); forged.quote.routeHash = H("f");
  await assert.rejects(service.reserve(forged, policy, new Date("2026-09-18T00:01:01.000Z")), { code: "APN_STATE_CORRUPT" });
  const substituted = sealAssetPolicyRegistry({ schemaVersion: policy.schemaVersion, registryVersion: "swap-owner.2",
    publishedAt: policy.publishedAt, effectiveDate: policy.effectiveDate,
    ...(policy.effectiveAt === undefined ? {} : { effectiveAt: policy.effectiveAt }),
    ...(policy.expiresAt === undefined ? {} : { expiresAt: policy.expiresAt }),
    chains: policy.chains });
  await assert.rejects(service.reserve(op, substituted, new Date("2026-09-18T00:01:01.000Z")), { code: "APN_OPERATION_BLOCKED" });
  assert.equal((await usage.usage({ account: ACCOUNT, chain: "eip155:1", asset: { kind: "native", identifier: null } },
    new Date("2026-09-18T00:01:02.000Z"))).amountAtomic, "0");
  await assert.rejects(service.reserve(op, policy, new Date("2026-09-18T00:05:00.000Z")), { code: "APN_OPERATION_BLOCKED" });
});

test("submission marker is durable before send and restart/lost response is observation-only with no release or resend", async (t) => {
  const temporary = await temporaryState(); t.after(temporary.cleanup); const { service, operations, policy, op } = await fixture(temporary.root);
  const reserved = await service.reserve(op, policy, new Date("2026-09-18T00:01:01.000Z"));
  const submitting = await service.markSubmitting(reserved, new Date("2026-09-18T00:01:02.000Z"));
  assert.equal(service.resumeDirective(submitting), "observe_only");
  const restarted = new SwapOperationRepository(temporary.root), loaded = await restarted.load(submitting.ownerProfileHash, submitting.operationId);
  assert.equal(loaded?.submissionMarker?.markerHash, submitting.submissionMarker?.markerHash);
  await assert.rejects(service.recordPossibleSend(submitting, "unknown_finality", new Date("2026-09-18T00:01:03.000Z"),
    { receiptHash: H("7"), transactionHash: "invalid", observedAt: "2026-09-18T00:01:03.000Z", finalized: false }),
  { code: "APN_INVALID_INPUT" });
  assert.equal((await service.usage.load({ account: ACCOUNT, chain: "eip155:1", asset: { kind: "native", identifier: null } },
    submitting.usageLease!.reservationId))?.state, "reserved");
  await assert.rejects(service.failBeforeEffect(submitting, new Date("2026-09-18T00:01:03.000Z"), H("f")), { code: "APN_OPERATION_BLOCKED" });
  const unknown = await service.recordPossibleSend(submitting, "unknown_finality", new Date("2026-09-18T00:01:04.000Z"));
  assert.equal(unknown.state, "unknown_finality"); assert.equal(service.resumeDirective(unknown), "observe_only");
  await assert.rejects(service.markSubmitting(unknown, new Date("2026-09-18T00:01:05.000Z")), { code: "APN_OPERATION_BLOCKED" });
  const receipt = { receiptHash: H("9"), transactionHash: `0x${H("8")}`, observedAt: "2026-09-18T00:02:00.000Z", finalized: true } as const;
  const final = await service.finalize(unknown, new Date("2026-09-18T00:02:00.000Z"), receipt); assert.equal(final.state, "finalized");
  assert.equal(service.resumeDirective(final), "terminal");
  assert.equal((await operations.load(final.ownerProfileHash, final.operationId))?.integrityHash, final.integrityHash);
});

test("operation ownership, concurrency and durable tamper checks fail closed", async (t) => {
  const temporary = await temporaryState(); t.after(temporary.cleanup); const { operations, service, policy, op } = await fixture(temporary.root);
  const raced = await Promise.allSettled([
    service.reserve(op, policy, new Date("2026-09-18T00:01:01.000Z")),
    service.reserve(op, policy, new Date("2026-09-18T00:01:01.000Z")),
  ]);
  assert.equal(raced.filter((result) => result.status === "fulfilled").length, 1);
  assert.equal((raced.find((result) => result.status === "rejected") as PromiseRejectedResult).reason.code, "APN_OPERATION_BLOCKED");
  const current = await operations.load(op.ownerProfileHash, op.operationId); assert.equal(current?.state, "reserved");
  const path = join(temporary.root, "swap-operations", op.ownerProfileHash, `${op.operationId}.json`);
  const stored = JSON.parse(await readFile(path, "utf8")); stored.quote.routeHash = H("f");
  await writeFile(path, `${JSON.stringify(stored)}\n`); await chmod(path, 0o600);
  await assert.rejects(operations.load(op.ownerProfileHash, op.operationId), { code: "APN_STATE_CORRUPT" });
});
