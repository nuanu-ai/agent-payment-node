import assert from "node:assert/strict";
import test from "node:test";
import type { Address, Hex } from "../../src/model.js";
import { BNB_COMPOSITE, decodeBnbCompositeMessage, decodeFlyProgram, verifyFlyHeaderSignature } from "../../src/lifi/bnb-composite.js";
import { materializeBridgeRoute, parseBridgeRoutes } from "../../src/lifi/routes.js";
import type { BridgeRouteRequest } from "../../src/lifi/model.js";
import { decodeBridgeCall } from "../../src/lifi/decode.js";
import { bridgeDestinationProof, bridgeSourceProof } from "../../src/lifi/protocol-evidence.js";
import { eventLog, makeDestinationReceipt, makeSourceReceipt } from "./lifi-event-fixtures.js";
import { lifiFixture } from "./lifi-helpers.js";
import { temporaryState } from "./helpers.js";
import { ApnCore } from "../../src/core.js";
import { AssetUsageLedger } from "../../src/asset-usage-ledger.js";
import { LifiProvider } from "../../src/lifi/provider.js";
import { findStored } from "./stored-operations.js";
import { TtyBridgeApproval } from "../../src/lifi/tty.js";
import { bridgeCompositeReturn, publicBridgeOperation } from "../../src/lifi/receipt.js";
import { approvalCode } from "../../src/approval-code.js";
import { lifiCapture } from "./lifi-capture.js";

const fixture = lifiCapture("bnb-composite-fly-20260921.json") as {
  routeResponse: { routes: Record<string, unknown>[] }; materializationRequest: Record<string, unknown>; materializationResponse: unknown;
  decoded: { bridgeData: { transactionId: Hex; receiver: Address }; acrossData: { message: Hex };
    destination: { swaps: readonly [{ fromAmount: string; callData: Hex }] }; flyPackedPayloadKeccak256: Hex; destinationMessageKeccak256: Hex };
};
const request: BridgeRouteRequest = { fromChainId: 1, toChainId: 56,
  fromToken: "0x0000000000000000000000000000000000000000", toToken: "0x0000000000000000000000000000000000000000",
  amountAtomic: "200000000000000", recipient: "0x823A3a5BaB1186141b32fC65F8E25Ca24c679Ce7",
  minOutputAtomic: "626451146422467", maxNativeDebitWei: "300000000000000", maxRouteFeeAtomic: "30000000000000", slippageBps: 50 };
// LI.FI's 2026-11-05 quote for the same lane: Fly now routes WETH -> BTCB -> WBNB -> BNB in a 704-byte program.
const live = lifiCapture("bnb-composite-fly-20261105.json").decoded as {
  bridgeData: { transactionId: Hex; receiver: Address }; acrossData: { message: Hex };
  destination: { swaps: readonly [{ fromAmount: string; callData: Hex }] }; flyPackedPayloadBytes: number;
};

test("strict BNB composite decoder accepts the frozen LI.FI Across -> Fly graph", () => {
  const out = decodeBnbCompositeMessage(fixture.decoded.acrossData.message, fixture.decoded.bridgeData.transactionId, fixture.decoded.bridgeData.receiver);
  assert.deepEqual(out, {
    kind: "across-fly-bnb", transactionId: fixture.decoded.bridgeData.transactionId, finalReceiver: fixture.decoded.bridgeData.receiver,
    inputAmountAtomic: "182201848346848", expectedOutputAtomic: "629599142133133", minimumOutputAtomic: "626451146422467",
    deadlineAtomic: "1789921639", maximumRetentionBps: 500,
    consumerId: "0x3da224c61fe6e7a9632ef750abddce55f7a3f9b3ee65968bc71a16f2f917f01d",
    signature: "0x08d456fd1d3b378ef420b23049d3ac05414a149c874485ef5dd66a8e13e0d0a44e2dee810a5233cd7cf23405ceea5748516462a17690be8aec2f83a09f7b07531b",
    flyCalldata: fixture.decoded.destination.swaps[0].callData,
    payloadHash: fixture.decoded.flyPackedPayloadKeccak256, messageHash: fixture.decoded.destinationMessageKeccak256,
  });
});

test("guarded BNB discovery requests only Across -> Fly and its returned plan passes strict decoding", async () => {
  let outbound: string | null = null;
  const provider = new LifiProvider({ async request(_endpoint, _method, body) {
    outbound = body; return { status: 200, body: JSON.stringify(fixture.routeResponse) };
  } });
  const response = await provider.routes(request, request.recipient);
  const options = JSON.parse(outbound!).options;
  assert.equal(options.allowDestinationCall, true);
  assert.deepEqual(options.bridges.allow, ["across"]);
  assert.deepEqual(options.exchanges.allow, ["fly"]);
  const route = structuredClone(fixture.routeResponse.routes[0]!) as Record<string, unknown>;
  route.steps = [fixture.materializationRequest]; route.toAmount = "629599142133133"; route.toAmountMin = "626451146422467";
  const selected = parseBridgeRoutes({ ...response, body: JSON.stringify({ routes: [route] }) }, request, request.recipient);
  const out = materializeBridgeRoute(selected[0]!, { status: 200, body: JSON.stringify(fixture.materializationResponse) }, request, request.recipient);
  assert.equal(decodeBridgeCall(out.materialization).composite?.kind, "across-fly-bnb");
});

test("canonical source message and destination trace prove BNB success while recovered WETH is terminally distinct", () => {
  const m = capturedMaterialization().materialization, decoded = decodeBridgeCall(m);
  const source = bridgeSourceProof(m, decoded, makeSourceReceipt(decoded));
  const receipt = makeDestinationReceipt(decoded, source), proof = bridgeDestinationProof(source, m, decoded, receipt);
  assert.equal(proof.amountAtomic, decoded.composite!.expectedOutputAtomic);
  assert.equal(proof.compositeTrace!.outcome, "completed_native");
  // Across fills more WETH than the Fly input; the Executor's return of the rest is proven by its Transfer log.
  const filled = (source.correlation as { outputAmountAtomic: string }).outputAmountAtomic;
  const returned = (BigInt(filled) - BigInt(decoded.composite!.inputAmountAtomic)).toString();
  assert.equal(proof.compositeTrace!.returnedWethAtomic, returned); assert.notEqual(returned, "0");
  const withoutReturn = { ...receipt, logs: receipt.logs.slice(0, -1) };
  assert.throws(() => bridgeDestinationProof(source, m, decoded, withoutReturn), /bnb_returned_weth/u);
  assert.throws(() => bridgeDestinationProof(source, m, decoded, { ...receipt, compositeTrace: { ...receipt.compositeTrace!,
    returnedWethAtomic: "0" } }), /bnb_returned_weth/u);
  const recovered = { ...withoutReturn, logs: [...withoutReturn.logs, eventLog(BNB_COMPOSITE.weth, "Transfer", {
    from: BNB_COMPOSITE.receiver, to: decoded.recipient, value: BigInt(filled),
  })], nativeBalance: { ...receipt.nativeBalance!, afterBalanceAtomic: receipt.nativeBalance!.beforeBalanceAtomic, deltaAtomic: "0" },
    compositeTrace: { ...receipt.compositeTrace!, outcome: "recovered_weth" as const, vaultOutputAtomic: null,
      deliveredAmountAtomic: "0", retainedAmountAtomic: "0", returnedWethAtomic: filled } };
  assert.equal(bridgeDestinationProof(source, m, decoded, recovered).compositeTrace?.outcome, "recovered_weth");
  // The Receiver returns the whole fill, not the smaller Fly input.
  assert.throws(() => bridgeDestinationProof(source, m, decoded, { ...recovered, logs: [...withoutReturn.logs, eventLog(BNB_COMPOSITE.weth,
    "Transfer", { from: BNB_COMPOSITE.receiver, to: decoded.recipient, value: BigInt(decoded.composite!.inputAmountAtomic) })] }), /bnb_recovery_evidence/u);
  assert.throws(() => bridgeDestinationProof(source, m, decoded, { ...receipt, compositeTrace: null }), /bnb_destination_trace/u);
  const { returnedWethAtomic: _omitted, ...older } = receipt.compositeTrace!;
  assert.throws(() => bridgeDestinationProof(source, m, decoded, { ...receipt, compositeTrace: older }), /bnb_destination_trace/u);
});

test("BNB destination outcomes survive restart, finalize spent usage and never resend", async (t) => {
  for (const outcome of ["recovered_weth", "below_floor", "protocol_mismatch"] as const) {
    const temporary = await temporaryState(); t.after(temporary.cleanup);
    const s = await lifiFixture(temporary.root, "eth-bnb");
    s.provider.statusValue = "completed_observed"; s.destination.destinationCompositeOutcome = outcome;
    const prepared = await s.prepare("across", `bnb-${outcome}-001`);
    const result = await s.core.execute({ command: "bridge.approve", operationId: prepared.id });
    assert.equal(result.ok, true, `${outcome}: ${result.error?.message}`);
    const record = (await findStored(s.core.bridges.records, prepared.id))!;
    assert.equal(record.state, "destination_failed"); assert.equal(record.failure?.reason, outcome);
    assert.equal(record.destinationProof?.compositeTrace?.outcome, outcome);
    const binding = record.intent.allowlist!, lease = await new AssetUsageLedger(temporary.root).load({
      account: binding.account, chain: binding.chain, asset: binding.asset }, record.usageLease!.reservationId);
    assert.equal(lease?.state, "finalized"); assert.equal(s.source.submissions.length, 1);
    const restarted = new ApnCore({ state: s.state, bridge: s.dependencies, clock: { now: () => new Date(s.now) } });
    const status = await restarted.execute({ command: "operation.status", operationId: prepared.id });
    assert.equal((status.operation as any).reason, outcome); assert.equal((status.operation as any).terminal, true);
    await restarted.execute({ command: "operation.resume", operationId: prepared.id });
    assert.equal(s.source.submissions.length, 1);
  }
});

test("the BNB consent names Fly's unsigned route, the native-only guarantee and the WETH returned outside it", async (t) => {
  const temporary = await temporaryState(); t.after(temporary.cleanup);
  // The captured Fly quote expired in September, so the route is prepared on the fixture clock and only the consent's own
  // wall-clock expiry is moved ahead.
  const s = await lifiFixture(temporary.root, "eth-bnb"), { id, operation } = await s.prepare("across", "bnb-consent-001");
  const weth = bridgeCompositeReturn(operation)!, protocol = operation.intent.decoded.protocol as { outputAmountAtomic: string };
  assert.deepEqual(weth, { fillWethAtomic: protocol.outputAmountAtomic, swappedWethAtomic: operation.intent.decoded.composite!.inputAmountAtomic,
    unswappedWethReturnAtomic: (BigInt(protocol.outputAmountAtomic) - BigInt(operation.intent.decoded.composite!.inputAmountAtomic)).toString() });
  let printed = "";
  const tty = new TtyBridgeApproval({ isTerminal: () => true, openTerminal: async () => ({ fd: 123, write: async (text) => { printed += text; },
    read: async function* () { yield Buffer.from("REJECT\n"); }, close: async () => {} }) });
  const input = { operationId: id, fingerprint: operation.fingerprint, exactPhrase: approvalCode("bridge", operation.fingerprint),
    summary: { ...publicBridgeOperation(operation), expires_at: new Date(Date.now() + 600_000).toISOString() }, compositeReturn: weth };
  assert.equal(await tty.confirm(input), false);
  for (const text of ["Fly Core route (unsigned, chosen by Fly for this quote)", "Guaranteed: only the minimum native destination output",
    `Across fills ${weth.fillWethAtomic} atomic, Fly swaps ${weth.swappedWethAtomic}`, `other ${weth.unswappedWethReturnAtomic} atomic is returned as WETH after the swap, without the router's protection`]) {
    assert.ok(printed.includes(text), text);
  }
  assert.ok(!printed.includes("WETH/WBNB pool"));
  await assert.rejects(tty.confirm({ ...input, compositeReturn: null }), /no WETH accounting/u);
});

test("the bridge service hands the composite's WETH accounting to the consent port", async (t) => {
  const temporary = await temporaryState(); t.after(temporary.cleanup);
  const s = await lifiFixture(temporary.root, "eth-bnb"), prepared = await s.prepare("across", "bnb-consent-002");
  const result = await s.core.execute({ command: "bridge.approve", operationId: prepared.id });
  assert.equal(result.ok, true, JSON.stringify(result.error));
  assert.deepEqual((s.approval.calls[0] as { compositeReturn: unknown }).compositeReturn, bridgeCompositeReturn(prepared.operation));
});

test("BNB destination RPC absence remains evidence_unavailable and observe-only across restart", async (t) => {
  const temporary = await temporaryState(); t.after(temporary.cleanup);
  const s = await lifiFixture(temporary.root, "eth-bnb");
  s.provider.statusValue = "completed_observed"; s.destination.failObserve = true;
  const prepared = await s.prepare("across", "bnb-evidence-unavailable-001");
  await s.core.execute({ command: "bridge.approve", operationId: prepared.id });
  let record = (await findStored(s.core.bridges.records, prepared.id))!;
  assert.equal(record.state, "unknown_finality"); assert.equal(record.failure?.reason, "evidence_unavailable");
  const restarted = new ApnCore({ state: s.state, bridge: s.dependencies, clock: { now: () => new Date(s.now) } });
  await restarted.execute({ command: "operation.resume", operationId: prepared.id });
  record = (await findStored(restarted.bridges.records, prepared.id))!;
  assert.equal(record.failure?.reason, "evidence_unavailable"); assert.equal(s.source.submissions.length, 1);
  const binding = record.intent.allowlist!, lease = await new AssetUsageLedger(temporary.root).load({
    account: binding.account, chain: binding.chain, asset: binding.asset }, record.usageLease!.reservationId);
  assert.equal(lease?.state, "unknown_finality");
});

test("Fly header signature binds chain, router, caller, assets and output bounds", async () => {
  const call = decodeBnbCompositeMessage(fixture.decoded.acrossData.message, fixture.decoded.bridgeData.transactionId, fixture.decoded.bridgeData.receiver);
  assert.deepEqual(await verifyFlyHeaderSignature(call, "0x28de4113921BD79388B0ef80A259f871977442E9"), {
    digest: "0x7a04de51e9a6d2f5532731c74be0d23c1d1bdb48e5dea09dd10e671748af526c",
    signer: "0x28de4113921BD79388B0ef80A259f871977442E9",
  });
  await assert.rejects(verifyFlyHeaderSignature(call, "0x1111111111111111111111111111111111111111"));
});

test("the Fly decoder reads the router's header and rejects every header field APN binds", () => {
  for (const [name, call, amount] of [["2026-09-21", fixture.decoded.destination.swaps[0].callData, fixture.decoded.destination.swaps[0].fromAmount],
    ["2026-11-05", live.destination.swaps[0].callData, live.destination.swaps[0].fromAmount]] as const) {
    const mutations = [
      [0, 0xff], [4 + 31, 0x40], [4 + 63, 0xff], // selector, ABI offset, ABI length
      [68 + 4, 0xff], [68 + 24, 0xff], [68 + 44, 0xff], [68 + 64, 0xff], // recipient, input, output, amount
      [68 + 96, 0x07], [68 + 99, 0x07], [68 + 102, 0x07], [68 + 137, 0x07], // compact words: shift not a whole byte
      [68 + 97, 0xff], [68 + 100, 0xff], [68 + 103, 0xff], [68 + 138, 0xff], // compact words: pointer outside the payload
      [68 + 140, 1], [68 + 206, 1], // transfer mode, fee count
    ] as const;
    for (const [at, value] of mutations) assert.throws(() => decodeFlyProgram(mutate(call, at, value), fixture.decoded.bridgeData.receiver,
      BigInt(amount)), { name: "ApnError" }, `${name}: mutation at ${at}`);
  }
});

test("the 2026-11-05 multi-hop Fly program decodes and carries Fly's own signature over its header", async () => {
  assert.equal(live.flyPackedPayloadBytes, 704);
  const call = decodeBnbCompositeMessage(live.acrossData.message, live.bridgeData.transactionId, live.bridgeData.receiver);
  assert.deepEqual({ input: call.inputAmountAtomic, min: call.minimumOutputAtomic, expected: call.expectedOutputAtomic,
    deadline: call.deadlineAtomic, retention: call.maximumRetentionBps },
  { input: "380515570688779", min: "1226879077233883", expected: "1233044298727521", deadline: "1793916262", retention: 500 });
  assert.equal((await verifyFlyHeaderSignature(call, BNB_COMPOSITE.signer)).signer, BNB_COMPOSITE.signer);
  // Prepare refuses the signature forms the router refuses; a stored record is only re-decoded, never re-verified.
  const signature = Buffer.from(call.signature.slice(2), "hex");
  const highS = Buffer.from(signature); highS.fill(0xff, 32, 64);
  const badV = Buffer.from(signature); badV[64] = 29;
  for (const form of [highS, badV, signature.subarray(0, 64)]) {
    await assert.rejects(verifyFlyHeaderSignature({ ...call, signature: `0x${form.toString("hex")}` }, BNB_COMPOSITE.signer), /fly_signature_form/u);
  }
});

test("the route after the header is opaque: Fly does not sign it and APN does not interpret it", async () => {
  // Payload bytes 207+ that no compact header word points at (they point at 208..230 here) are Fly Core's route.
  const call = live.destination.swaps[0].callData, amount = BigInt(live.destination.swaps[0].fromAmount);
  const original = decodeFlyProgram(call, live.bridgeData.receiver, amount);
  for (const payloadByte of [207, 232, 400, 600, 703]) {
    const absolute = 68 + payloadByte, current = Buffer.from(call.slice(2), "hex")[absolute]!;
    const changed = decodeFlyProgram(mutate(call, absolute, current ^ 1), live.bridgeData.receiver, amount);
    assert.deepEqual({ ...changed, payloadHash: original.payloadHash }, original, `payload byte ${payloadByte}`);
    assert.notEqual(changed.payloadHash, original.payloadHash);
    await verifyFlyHeaderSignature(changed, BNB_COMPOSITE.signer);
  }
  // The bytes a header word points at are header values: changing one changes the signed value, so the signature fails.
  const floorByte = 68 + 219, floor = Buffer.from(call.slice(2), "hex")[floorByte]!;
  const lowered = decodeFlyProgram(mutate(call, floorByte, floor ^ 1), live.bridgeData.receiver, amount);
  assert.notEqual(lowered.minimumOutputAtomic, original.minimumOutputAtomic);
  await assert.rejects(verifyFlyHeaderSignature(lowered, BNB_COMPOSITE.signer));
});

test("the Fly payload must hold the router's whole header and stay within APN's bound", () => {
  const program = (length: number) => `0x${BNB_COMPOSITE.selector.slice(2)}${(32n).toString(16).padStart(64, "0")}${BigInt(length).toString(16).padStart(64, "0")}${"00".repeat(Math.ceil(length / 32) * 32)}` as Hex;
  assert.throws(() => decodeFlyProgram(program(206), fixture.decoded.bridgeData.receiver, 1n), /fly_abi_bounds/u);
  assert.throws(() => decodeFlyProgram(program(3073), fixture.decoded.bridgeData.receiver, 1n), /bounded_hex|fly_abi_bounds/u);
});

test("strict BNB composite decoder rejects outer transaction, recipient, amount and extra-swap mutations", () => {
  const wrong = "0x1111111111111111111111111111111111111111111111111111111111111111" as Hex;
  assert.throws(() => decodeBnbCompositeMessage(fixture.decoded.acrossData.message, wrong, fixture.decoded.bridgeData.receiver));
  assert.throws(() => decodeBnbCompositeMessage(fixture.decoded.acrossData.message, fixture.decoded.bridgeData.transactionId,
    "0x1111111111111111111111111111111111111111"));
  assert.throws(() => decodeFlyProgram(fixture.decoded.destination.swaps[0].callData, fixture.decoded.bridgeData.receiver,
    BigInt(fixture.decoded.destination.swaps[0].fromAmount) + 1n));
});

function mutate(value: Hex, byte: number, replacement: number): Hex {
  const out = Buffer.from(value.slice(2), "hex"); out[byte] = replacement; return `0x${out.toString("hex")}`;
}

function capturedMaterialization() {
  const route = structuredClone(fixture.routeResponse.routes[0]!) as Record<string, unknown>;
  route.steps = [fixture.materializationRequest]; route.toAmount = "629599142133133"; route.toAmountMin = "626451146422467";
  const routes = parseBridgeRoutes({ status: 200, body: JSON.stringify({ routes: [route] }) }, request, request.recipient);
  assert.equal(routes.length, 1); assert.equal(routes[0]!.choice.preparable, true);
  return materializeBridgeRoute(routes[0]!, { status: 200, body: JSON.stringify(fixture.materializationResponse) }, request, request.recipient);
}

