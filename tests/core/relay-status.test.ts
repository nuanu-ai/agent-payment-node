import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";
import { hashObject } from "../../src/canonical.js";
import { bindArgv } from "../../src/command-binder.js";
import { freezeRelayUnsignedOperation, RelayRetirementRepository, RelayUnsignedOperationRepository } from "../../src/relay-unsigned-operation.js";
import { relayStatusLocator, validateRelayQuote } from "../../src/relay/quote.js";
import { RelayKeylessStatusService } from "../../src/relay/status.js";
import { StateStore } from "../../src/state.js";
import { temporaryState } from "./helpers.js";

const payer = "0x0B4Dd0C3dA001Fa146EEd3f80B01860BEF6B8a14".toLowerCase();
const recipient = "0x823A3a5BaB1186141b32fC65F8E25Ca24c679Ce7".toLowerCase();
const operationId = "2".repeat(64);
const hash = `0x${"a".repeat(64)}`;

async function savedOperation(withLocator = true) {
  const fixture = JSON.parse(await readFile("tests/core/relay-fixtures/ethereum-usdc-bnb-quote-20260925.json", "utf8"));
  const quoted = await validateRelayQuote(fixture, { payer, recipient, amountAtomic: "2500000",
    minimumOutputWei: "3000000000000000", nowSeconds: 1790800000 });
  const { quoteDigest: _, ...projection } = quoted;
  const { statusLocator: _locator, ...noLocator } = projection;
  const locator = relayStatusLocator(hash);
  const withStatus = { ...noLocator, statusLocator: locator };
  const quote = withLocator ? { ...withStatus, quoteDigest: hashObject(withStatus) } :
    { ...noLocator, quoteDigest: hashObject(noLocator) };
  return freezeRelayUnsignedOperation({ schemaVersion: "apn.relay-unsigned-operation.v1", kind: "relay_unsigned",
    state: "prepared", terminal: false, profileHash: "1".repeat(64), operationId,
    idempotencyHash: "3".repeat(64), requestHash: "4".repeat(64), sourceChainId: 1,
    destinationChainId: 56, sourceAccount: payer, recipient, quoteDigest: quote.quoteDigest, quote,
    ...(withLocator ? { statusLocator: locator } : {}),
    policyDigest: "5".repeat(64), policyRevision: 1,
    approvalNetworkFeeCeilingWei: quote.approval.maximumNetworkFeeWei,
    depositNetworkFeeCeilingWei: quote.deposit.maximumNetworkFeeWei,
    amountAtomic: "2500000", minOutputAtomic: quote.minimumOutputWei,
    createdAt: "2026-09-30T00:00:00.000Z", deadline: new Date(quote.deadline * 1000).toISOString() });
}

const payload = (status: string, changes: Record<string, unknown> = {}) => ({ status, originChainId: 1,
  destinationChainId: 56, inTxHashes: [hash], txHashes: [hash], ...changes });
const response = (body: unknown) => new Response(JSON.stringify(body), { status: 200,
  headers: { "content-type": "application/json" } });

test("Relay status binds CLI and spends exactly one keyless GET without modifying saved state", async t => {
  const temp = await temporaryState(); t.after(temp.cleanup);
  const op = await savedOperation();
  await new RelayUnsignedOperationRepository(temp.root).persistLocked(op);
  const path = join(temp.root, "relay-unsigned-operations", op.profileHash, `${operationId}.json`);
  const before = await readFile(path);
  let calls = 0;
  const fetcher: typeof fetch = async (url, init) => {
    calls++;
    assert.equal(url, op.statusLocator!.endpoint);
    assert.deepEqual(Object.keys(init ?? {}).sort(), ["method", "redirect", "signal"]);
    assert.equal(init?.method, "GET"); assert.equal(init?.redirect, "error");
    assert.ok(init?.signal instanceof AbortSignal);
    return response(payload("success"));
  };
  assert.deepEqual(bindArgv(["relay", "status", "--operation", operationId]).request,
    { command: "relay.status", operationId });
  const result = await new RelayKeylessStatusService(new StateStore(temp.root), fetcher).status(operationId);
  assert.equal(calls, 1);
  assert.equal(result.status, "success"); assert.equal(result.proofClass, "provider_assertion");
  assert.equal(result.independentOnchainProof, false); assert.equal(result.paidAcceptance, false);
  assert.deepEqual(result.inTxHashes, [hash]); assert.deepEqual(result.txHashes, [hash]);
  assert.deepEqual(await readFile(path), before);
});

test("old quote without locator and hostile saved locator fail before network", async t => {
  const temp = await temporaryState(); t.after(temp.cleanup);
  const op = await savedOperation(false);
  const repo = new RelayUnsignedOperationRepository(temp.root);
  await repo.persistLocked(op);
  let calls = 0;
  const fetcher: typeof fetch = async () => { calls++; return response(payload("success")); };
  const service = new RelayKeylessStatusService(new StateStore(temp.root), fetcher);
  await assert.rejects(service.status(operationId), { code: "APN_OPERATION_BLOCKED" });
  assert.equal(calls, 0);
  const path = join(temp.root, "relay-unsigned-operations", op.profileHash, `${operationId}.json`);
  const forged = { ...op, statusLocator: { requestId: hash, endpoint: "https://evil.example/intents/status/v3?requestId=" + hash } };
  const { integrityHash: _, ...body } = forged;
  await writeFile(path, JSON.stringify({ ...body, integrityHash: hashObject(body) }));
  await assert.rejects(service.status(operationId), { code: "APN_STATE_CORRUPT" });
  assert.equal(calls, 0);
});

test("retired quote and malformed retirement marker fail before any Relay request", async t => {
  const temp = await temporaryState(); t.after(temp.cleanup);
  const op = await savedOperation(false);
  await new RelayUnsignedOperationRepository(temp.root).persistLocked(op);
  const retirements = new RelayRetirementRepository(temp.root);
  await retirements.persistLocked(op, "2026-09-30T00:01:00.000Z");
  const markerPath = join(temp.root, "relay-retirements", op.profileHash, `${operationId}.json`);
  const before = await readFile(markerPath);
  let calls = 0;
  const service = new RelayKeylessStatusService(new StateStore(temp.root), async () => {
    calls++; return response(payload("success"));
  });
  await assert.rejects(service.status(operationId), { code: "APN_OPERATION_BLOCKED",
    details: { reason: "relay_operation_retired" } });
  assert.equal(calls, 0);
  assert.deepEqual(await readFile(markerPath), before);
  const malformed = JSON.parse(before.toString()) as Record<string, unknown>;
  malformed.preparedIntegrityHash = "f".repeat(64);
  await writeFile(markerPath, JSON.stringify(malformed));
  await assert.rejects(service.status(operationId), { code: "APN_STATE_CORRUPT" });
  assert.equal(calls, 0);
});

test("Relay status rejects redirects, chain mismatch, malformed hashes and oversized bodies", async t => {
  const temp = await temporaryState(); t.after(temp.cleanup);
  const op = await savedOperation();
  await new RelayUnsignedOperationRepository(temp.root).persistLocked(op);
  for (const providerResponse of [Response.redirect("https://evil.example/", 302),
    response(payload("success", { destinationChainId: 8453 })),
    response(payload("success", { txHashes: ["0x1234"] })),
    response(payload("success", { extra: "x".repeat(65_536) }))]) {
    let calls = 0;
    const service = new RelayKeylessStatusService(new StateStore(temp.root), async () => { calls++; return providerResponse; });
    await assert.rejects(service.status(operationId), { code: "APN_PROVIDER_PROTOCOL" });
    assert.equal(calls, 1);
  }
});

test("Relay delayed, refund and failure are provider assertions with sanitized reasons", async t => {
  const temp = await temporaryState(); t.after(temp.cleanup);
  const op = await savedOperation();
  await new RelayUnsignedOperationRepository(temp.root).persistLocked(op);
  for (const [status, changes, expectedReason] of [
    ["delayed", {}, "relay_reported_delayed"],
    ["refund", { refundFailReason: "MANUAL_REFUND_REQUIRED" }, "MANUAL_REFUND_REQUIRED"],
    ["failure", { failReason: "SLIPPAGE", details: "untrusted secret" }, "SLIPPAGE"],
  ] as const) {
    const service = new RelayKeylessStatusService(new StateStore(temp.root), async () => response(payload(status, changes)));
    const result = await service.status(operationId);
    assert.equal(result.reason, expectedReason);
    assert.equal(JSON.stringify(result).includes("untrusted secret"), false);
  }
});
