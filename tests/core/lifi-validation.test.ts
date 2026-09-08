import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";
import { hashObject } from "../../src/canonical.js";
import { OperationService } from "../../src/operation-service.js";
import { bridgeIntentBinding } from "../../src/lifi/operation-model.js";
import { validateBridgeOperation } from "../../src/lifi/operation-validation.js";
import { publicBridgeOperation } from "../../src/lifi/receipt.js";
import { materializeBridgeRoute, parseBridgeRoutes, validateRouteEconomics } from "../../src/lifi/routes.js";
import { TtyBridgeApproval } from "../../src/lifi/tty.js";
import { bridgeDecimal, bridgeUint } from "../../src/lifi/validation.js";
import { temporaryState } from "./helpers.js";
import { LIFI_RECIPIENT, LIFI_SYNTHETIC_KEY, LIFI_SYNTHETIC_SENDER, lifiFixture, lifiRoute } from "./lifi-helpers.js";

test("LI.FI integer parsing preserves exact USDC and wei boundaries without coercion or rounding", () => {
  assert.equal(bridgeDecimal("0.000001", true), "1"); assert.equal(bridgeDecimal("10.123456", true), "10123456"); assert.equal(bridgeDecimal("0"), "0");
  const maximum = (1n << 256n) - 1n; assert.equal(bridgeUint(maximum.toString()), maximum);
  for (const value of ["", "00", "-1", "+1", "1e6", " 1", "1 ", "0.0000001", 1, null]) assert.throws(() => bridgeDecimal(value, true), { code: "APN_INVALID_INPUT" });
  assert.throws(() => bridgeDecimal("0", true), { code: "APN_INVALID_INPUT" });
  for (const value of [maximum + 1n, -(1n)]) assert.throws(() => bridgeUint(value.toString()), { code: "APN_PROVIDER_PROTOCOL" });
});

test("LI.FI stable materialization identities and every alternate execution extension are rejected before preparing an operation", async (t) => {
  const temporary = await temporaryState(); t.after(temporary.cleanup); const s = await lifiFixture(temporary.root), original = s.provider.steps[0]!;
  const selected = parseBridgeRoutes({ status: 200, body: JSON.stringify({ routes: [lifiRoute(original)] }) }, s.request, LIFI_SYNTHETIC_SENDER)[0]!;
  const materialize = (step: any) => materializeBridgeRoute(selected, { status: 200, body: JSON.stringify(step) }, s.request, LIFI_SYNTHETIC_SENDER);
  const edits: Array<(r: any) => void> = [
    (r) => { r.id += "x"; }, (r) => { r.tool = "stargateV2"; }, (r) => { r.integrator = "another"; },
    (r) => { r.action.fromAddress = LIFI_RECIPIENT; }, (r) => { r.action.toAddress = LIFI_SYNTHETIC_SENDER; },
    (r) => { r.action.fromChainId = 42161; }, (r) => { r.action.toChainId = 42161; },
    (r) => { r.action.fromToken.decimals = 18; }, (r) => { r.action.toToken.address = LIFI_RECIPIENT; },
    (r) => { r.action.fromAmount = "9999999"; }, (r) => { r.action.slippage = 0.5; },
    (r) => { r.transactionRequest.to = LIFI_RECIPIENT; }, (r) => { r.transactionRequest.from = LIFI_RECIPIENT; },
    (r) => { r.transactionRequest.authorizationList = []; }, (r) => { r.transactionRequest.type = "0x4"; },
    (r) => { r.transactionRequest.maxFeePerGas = "0x1"; }, (r) => { r.transactionRequest.gasLimit = "5000001"; },
    (r) => { r.estimate.approvalAddress = LIFI_RECIPIENT; }, (r) => { r.estimate.approvalReset = true; },
    (r) => { r.estimate.skipApproval = true; }, (r) => { r.transactionId = `0x${"56".repeat(32)}`; },
    (r) => { r.includedSteps[0].includedSteps = [structuredClone(r.includedSteps[1])]; },
    ...["typedData", "permit", "permit2", "authorization", "destinationCall", "destinationCalls", "contractCalls", "userOperation"].map((key) => (r: any) => { r[key] = {}; }),
  ];
  for (const edit of edits) { const step = structuredClone(original); edit(step); assert.throws(() => materialize(step)); }
  const refreshed = structuredClone(original); refreshed.transactionRequest.gasPrice = "0x1"; refreshed.transactionRequest.gasLimit = "0x7a120";
  refreshed.estimate.gasCosts[0].amount = "2"; const updated = materialize(refreshed), previous = materialize(original);
  assert.notEqual(updated.materialization.transactionDigest, previous.materialization.transactionDigest);
  assert.notEqual(updated.materialization.responseHash, previous.materialization.responseHash);
  assert.equal(updated.materialization.routeHash, previous.materialization.routeHash);
  for (const length of [21, 129]) {
    assert.throws(() => parseBridgeRoutes({ status: 200, body: JSON.stringify({ routes: Array.from({ length }, () => lifiRoute(original)) }) }, s.request, LIFI_SYNTHETIC_SENDER), { code: "APN_PROVIDER_PROTOCOL" });
  }
  assert.throws(() => parseBridgeRoutes({ status: 200, body: "x".repeat(512 * 1024 + 1) }, s.request, LIFI_SYNTHETIC_SENDER), { code: "APN_PROVIDER_PROTOCOL" });
  for (const key of ["feeCosts", "gasCosts"] as const) { const changed = structuredClone(original); changed.estimate[key] = Array.from({ length: key === "feeCosts" ? 17 : 9 }, () => changed.estimate[key][0]); assert.throws(() => materialize(changed)); }
  const quote = await s.core.execute({ command: "bridge.routes", profile: s.profile, request: s.request });
  s.provider.mutateMaterialization = (r) => { r.action.fromAmount = "1"; };
  const failed = await s.core.execute({ command: "bridge.prepare", profile: s.profile, quote: (quote.data as any).quote_hash,
    route: "route-across", idempotencyKey: "invalid-step-0001" });
  assert.equal(failed.error?.code, "APN_PROVIDER_PROTOCOL"); assert.equal((await s.core.bridges.records.listAllOperations()).length, 0);
  assert.equal(s.wrapping.loads, 0); assert.equal(s.source.submissions.length, 0);
});

test("LI.FI route fee, minimum output and native messaging accounting enforce exact boundaries", async (t) => {
  const temporary = await temporaryState(); t.after(temporary.cleanup); const s = await lifiFixture(temporary.root);
  for (const step of s.provider.steps) {
    const selected = parseBridgeRoutes({ status: 200, body: JSON.stringify({ routes: [lifiRoute(step)] }) }, s.request, LIFI_SYNTHETIC_SENDER)[0]!;
    const m = materializeBridgeRoute(selected, { status: 200, body: JSON.stringify(step) }, s.request, LIFI_SYNTHETIC_SENDER).materialization;
    const exact = BigInt(m.request.amountAtomic) - BigInt(m.minimumOutputAtomic);
    assert.doesNotThrow(() => validateRouteEconomics({ ...m, request: { ...m.request, maxRouteFeeAtomic: exact.toString() } }));
    assert.throws(() => validateRouteEconomics({ ...m, request: { ...m.request, maxRouteFeeAtomic: (exact - 1n).toString() } }), { code: "APN_FEE_BUDGET_EXCEEDED" });
    assert.throws(() => validateRouteEconomics({ ...m, request: { ...m.request, minOutputAtomic: (BigInt(m.minimumOutputAtomic) + 1n).toString() } }), { code: "APN_FEE_BUDGET_EXCEEDED" });
    assert.throws(() => validateRouteEconomics({ ...m, transaction: { ...m.transaction, valueAtomic: (BigInt(m.transaction.valueAtomic) + 1n).toString() } }), { code: "APN_PROVIDER_PROTOCOL" });
    assert.throws(() => validateRouteEconomics({ ...m, feeCosts: [...m.feeCosts, { name: "duplicate", chainId: m.request.fromChainId, asset: "native", amountAtomic: "1", included: false }] }), { code: "APN_PROVIDER_PROTOCOL" });
  }
});

for (const allowance of ["1", "10000001"]) test(`LI.FI nonzero inexact allowance ${allowance} fails without reset, signing or sending`, async (t) => {
  const temporary = await temporaryState(); t.after(temporary.cleanup); const s = await lifiFixture(temporary.root); s.source.allowance = allowance;
  await assert.rejects(s.prepare()); assert.equal(s.wrapping.loads, 0); assert.equal(s.source.submissions.length, 0);
  assert.equal((await s.core.bridges.records.listAllOperations()).length, 0);
});

test("LI.FI independent post-approval gas over the frozen ceiling stops the bridge and preserves paid approval", async (t) => {
  const temporary = await temporaryState(); t.after(temporary.cleanup); const s = await lifiFixture(temporary.root); const { id, operation } = await s.prepare();
  const maximum = operation.effects.at(-1)!.envelope.economics.gasLimitAtomic;
  const send = s.source.send.bind(s.source); s.source.send = async (raw) => { const hash = await send(raw); s.source.estimateGas = (BigInt(maximum) + 1n).toString(); return hash; };
  const result = await s.core.execute({ command: "bridge.approve", operationId: id }); assert.equal(result.ok, true, result.error?.message);
  const current = (await s.core.bridges.records.findOperation(id))!; assert.equal(current.state, "failed_after_approval");
  assert.equal(current.effects[1]!.envelope.economics.gasLimitAtomic, maximum); assert.equal(current.effects[1]!.phase, "unsealed"); assert.equal(s.source.submissions.length, 1);
});

test("LI.FI immutable intent mutations cannot survive under the original fingerprint even with a recomputed record checksum", async (t) => {
  const temporary = await temporaryState(); t.after(temporary.cleanup); const s = await lifiFixture(temporary.root); const { operation } = await s.prepare();
  const leaves = (value: any, path: string[] = []): string[][] => value !== null && typeof value === "object" ? Object.entries(value).flatMap(([key, v]) => leaves(v, [...path, key])) : [path];
  const binding = bridgeIntentBinding(operation), paths = leaves(binding).filter((p) => p[0] === "intent" || p[0] === "envelopes");
  assert.ok(paths.length > 160);
  for (const path of paths) {
    const value = structuredClone(operation) as any;
    const target = path[0] === "envelopes" ? ["effects", path[1]!, "envelope", ...path.slice(2)] : path;
    let parent = value; for (const key of target.slice(0, -1)) parent = parent[key];
    const field = target.at(-1)!; parent[field] = typeof parent[field] === "string" ? `${parent[field]}x` : typeof parent[field] === "number" ? parent[field] + 1 : !parent[field];
    const { integrityHash: _h, ...body } = value; value.integrityHash = hashObject(body);
    assert.throws(() => validateBridgeOperation(value), { code: "APN_STATE_CORRUPT" }, target.join("."));
  }
});

test("LI.FI encrypted effect is role-bound, tamper-evident and unavailable custody cannot regenerate an effect", async (t) => {
  const temporary = await temporaryState(); t.after(temporary.cleanup); const s = await lifiFixture(temporary.root); const { id, operation } = await s.prepare();
  await assert.rejects(s.custody.seal(operation, "approval", operation.intent.owner), { code: "APN_PROVIDER_EFFECT_UNAVAILABLE" }); assert.equal(s.wrapping.loads, 0);
  assert.equal((await s.core.execute({ command: "bridge.approve", operationId: id })).ok, true);
  const current = (await s.core.bridges.records.findOperation(id))!, directory = join(temporary.root, "bridge-effects", current.profileHash);
  const approvalPath = join(directory, `${id}-approval.json`), bridgePath = join(directory, `${id}-bridge.json`), original = await readFile(bridgePath, "utf8");
  const approval = await readFile(approvalPath, "utf8"); assert.ok(!original.includes(LIFI_SYNTHETIC_KEY)); assert.ok(!original.includes(current.effects[1]!.envelope.data));
  await writeFile(bridgePath, approval, { mode: 0o600 }); await assert.rejects(s.custody.load(current, "bridge"), { code: "APN_STATE_CORRUPT" });
  const tampered = JSON.parse(original), bytes = Buffer.from(tampered.cipher.ciphertext, "base64"); bytes[0] = bytes[0]! ^ 1; tampered.cipher.ciphertext = bytes.toString("base64");
  await writeFile(bridgePath, JSON.stringify(tampered), { mode: 0o600 }); await assert.rejects(s.custody.load(current, "bridge"), { code: "APN_PROVIDER_EFFECT_UNAVAILABLE" });
  await writeFile(bridgePath, original, { mode: 0o600 }); s.wrapping.available = false;
  await assert.rejects(s.custody.load(current, "bridge"), { code: "APN_PROVIDER_EFFECT_UNAVAILABLE" });
  await assert.rejects(s.custody.seal(current, "bridge", current.intent.owner), { code: "APN_PROVIDER_EFFECT_UNAVAILABLE" }); assert.equal(s.wrapping.creates, 0);
  assert.equal(s.source.submissions.length, 2);
});

test("LI.FI concurrent preparation has one materialization and blocks every other money kind and foreign-profile reuse", async (t) => {
  const temporary = await temporaryState(); t.after(temporary.cleanup); const s = await lifiFixture(temporary.root);
  const quote = await s.core.execute({ command: "bridge.routes", profile: s.profile, request: s.request });
  const input = { command: "bridge.prepare", profile: s.profile, quote: (quote.data as any).quote_hash, route: "route-across", idempotencyKey: "race-bridge-0001" } as const;
  const results = await Promise.all([s.core.execute(input), s.core.execute(input)]); assert.ok(results.every((r) => r.ok));
  assert.deepEqual(results[0]!.operation, results[1]!.operation); assert.equal(s.provider.materializeCalls, 1);
  const [op] = await s.core.bridges.records.listAllOperations(); assert.ok(op);
  const service = new OperationService(s.state);
  for (const kind of ["direct_transfer", "rail_transfer", "x402_fetch"] as const) await assert.rejects(service.resolvePrepare({ kind, profileHash: op.profileHash,
    operationId: op.operationId, idempotencyHash: op.idempotencyHash, requestHash: op.requestHash }), { code: "APN_IDEMPOTENCY_CONFLICT" });
  await assert.rejects(service.assertProfileAvailable(op.profileHash), { code: "APN_OPERATION_BLOCKED" });
  const foreign = await s.core.execute({ ...input, profile: "another" }); assert.equal(foreign.error?.code, "APN_IDEMPOTENCY_CONFLICT");
  assert.equal(s.provider.materializeCalls, 1); assert.equal(s.source.submissions.length, 0);
});

test("LI.FI external profile selection cannot fall back to a local key or launch an execution provider", async (t) => {
  const temporary = await temporaryState(); t.after(temporary.cleanup); const s = await lifiFixture(temporary.root);
  let localReads = 0; s.state.loadWallet = async () => { localReads++; throw new Error("local fallback forbidden"); };
  for (const provider_id of ["metamask-smart-account", "metamask-agent-wallet", "coinbase-awal"]) {
    s.state.loadProviderProfile = async () => ({ provider_id } as any);
    const result = await s.core.execute({ command: "bridge.routes", profile: s.profile, request: s.request }); assert.equal(result.error?.code, "APN_PROVIDER_CAPABILITY_UNAVAILABLE");
  }
  assert.equal(localReads, 0); assert.equal(s.provider.routeCalls, 0); assert.equal(s.wrapping.loads, 0);
});

test("LI.FI TTY requires the exact complete fingerprint and shows both chain economics and original deadline", async (t) => {
  const temporary = await temporaryState(); t.after(temporary.cleanup); const s = await lifiFixture(temporary.root, "eth-base", { now: new Date() });
  const { id, operation } = await s.prepare(); const summary = publicBridgeOperation(operation), phrase = `APPROVE BRIDGE ${operation.fingerprint}`;
  let printed = "", closed = 0, supplied = phrase;
  const tty = new TtyBridgeApproval({ isTerminal: () => true, openTerminal: async () => ({ fd: 123,
    write: async (text) => { printed += text; }, read: async function* () { yield Buffer.from(`${supplied}\n`); }, close: async () => { closed++; } }) });
  const input = { operationId: id, fingerprint: operation.fingerprint, exactPhrase: phrase, summary };
  assert.equal(await tty.confirm(input), true); assert.equal(closed, 1);
  for (const value of [phrase, operation.intent.expiresAt, "eip155:1", "eip155:8453", "10000000 USDC atomic", "approval:", "bridge:", "separate included approval costs gas", "no transaction-level on-chain cap", summary.rpc_origins.destination]) assert.ok(printed.includes(value), value);
  assert.ok(!printed.includes(operation.effects[1]!.envelope.data)); supplied = `APPROVE BRIDGE ${operation.fingerprint.slice(-16)}`;
  assert.equal(await tty.confirm(input), false); assert.equal(closed, 2);
  assert.equal(s.source.submissions.length, 0); assert.equal(s.wrapping.loads, 0);
});
