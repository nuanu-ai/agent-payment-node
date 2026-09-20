import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";
import { decodeAbiParameters, encodeFunctionData, encodeFunctionResult, parseAbi, parseAbiParameters } from "viem";
import type { Address, Hex } from "../../src/model.js";
import { BNB_COMPOSITE, decodeBnbCompositeMessage, decodeFlyProgram, verifyBnbCompositeTrace, verifyBnbPoolConfiguration, verifyFlyHeaderSignature } from "../../src/lifi/bnb-composite.js";
import { materializeBridgeRoute, parseBridgeRoutes } from "../../src/lifi/routes.js";
import type { BridgeRouteRequest } from "../../src/lifi/model.js";
import { decodeBridgeCall } from "../../src/lifi/decode.js";
import { bridgeDestinationProof, bridgeSourceProof } from "../../src/lifi/protocol-evidence.js";
import { eventLog, makeDestinationReceipt, makeSourceReceipt } from "./lifi-event-fixtures.js";
import { lifiFixture } from "./lifi-helpers.js";
import { temporaryState } from "./helpers.js";
import { ApnCore } from "../../src/core.js";
import { AssetUsageLedger } from "../../src/asset-usage-ledger.js";

const fixture = JSON.parse(readFileSync(resolve("tests/core/lifi-fixtures/bnb-composite-fly-20260921.json"), "utf8")) as {
  routeResponse: { routes: Record<string, unknown>[] }; materializationRequest: Record<string, unknown>; materializationResponse: unknown;
  decoded: { bridgeData: { transactionId: Hex; receiver: Address }; acrossData: { message: Hex };
    destination: { swaps: readonly [{ fromAmount: string; callData: Hex }] }; flyPackedPayloadKeccak256: Hex; destinationMessageKeccak256: Hex };
};
const request: BridgeRouteRequest = { fromChainId: 1, toChainId: 56,
  fromToken: "0x0000000000000000000000000000000000000000", toToken: "0x0000000000000000000000000000000000000000",
  amountAtomic: "200000000000000", recipient: "0x823A3a5BaB1186141b32fC65F8E25Ca24c679Ce7",
  minOutputAtomic: "626451146422467", maxNativeDebitWei: "300000000000000", maxRouteFeeAtomic: "30000000000000", slippageBps: 50 };

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

test("fresh captured route and materialization enter the exact executable composite lane", () => {
  const out = capturedMaterialization();
  assert.equal(out.materialization.tool, "across");
});

test("canonical source message and destination trace prove BNB success while recovered WETH is terminally distinct", () => {
  const m = capturedMaterialization().materialization, decoded = decodeBridgeCall(m);
  const source = bridgeSourceProof(m, decoded, makeSourceReceipt(decoded));
  const receipt = makeDestinationReceipt(decoded, source), proof = bridgeDestinationProof(source, m, decoded, receipt);
  assert.equal(proof.amountAtomic, decoded.composite!.expectedOutputAtomic);
  assert.equal(proof.compositeTrace!.outcome, "completed_native");
  const recovered = { ...receipt, logs: [...receipt.logs, eventLog(BNB_COMPOSITE.weth, "Transfer", {
    from: BNB_COMPOSITE.receiver, to: decoded.recipient, value: BigInt(decoded.composite!.inputAmountAtomic),
  })], nativeBalance: { ...receipt.nativeBalance!, afterBalanceAtomic: receipt.nativeBalance!.beforeBalanceAtomic, deltaAtomic: "0" },
    compositeTrace: { ...receipt.compositeTrace!, outcome: "recovered_weth" as const, vaultOutputAtomic: null,
      deliveredAmountAtomic: "0", retainedAmountAtomic: "0" } };
  assert.equal(bridgeDestinationProof(source, m, decoded, recovered).compositeTrace?.outcome, "recovered_weth");
  assert.throws(() => bridgeDestinationProof(source, m, decoded, { ...receipt, compositeTrace: null }), /bnb_destination_trace/u);
});

test("complete callTracer subtree binds every required call, amount and return dependency", () => {
  const call = decodeBnbCompositeMessage(fixture.decoded.acrossData.message, fixture.decoded.bridgeData.transactionId, fixture.decoded.bridgeData.receiver);
  const trace = canonicalTrace(call), tx = `0x${"12".repeat(32)}` as Hex;
  const proof = verifyBnbCompositeTrace(trace, tx, fixture.decoded.acrossData.message, call);
  assert.deepEqual({ outcome: proof.outcome, vault: proof.vaultOutputAtomic, delivered: proof.deliveredAmountAtomic,
    retained: proof.retainedAmountAtomic, hash: proof.traceHash.length },
  { outcome: "completed_native", vault: call.expectedOutputAtomic, delivered: call.expectedOutputAtomic, retained: "0", hash: 64 });
  const paths: readonly (readonly (string | number)[])[] = [
    ["calls", 1, "to"], ["calls", 1, "input"], ["calls", 1, "calls", 0, "input"],
    ["calls", 1, "calls", 1, "to"], ["calls", 1, "calls", 1, "input"],
    ["calls", 1, "calls", 1, "calls", 0, "input"], ["calls", 1, "calls", 1, "calls", 1, "input"],
    ["calls", 1, "calls", 1, "calls", 2, "to"], ["calls", 1, "calls", 1, "calls", 2, "input"],
    ["calls", 1, "calls", 1, "calls", 2, "calls", 0, "input"],
    ["calls", 1, "calls", 1, "calls", 2, "calls", 1, "to"],
    ["calls", 1, "calls", 1, "calls", 2, "calls", 1, "calls", 0, "input"],
    ["calls", 1, "calls", 1, "calls", 2, "calls", 1, "calls", 1, "input"],
    ["calls", 1, "calls", 1, "calls", 2, "calls", 1, "calls", 1, "output"],
    ["calls", 1, "calls", 1, "calls", 2, "calls", 1, "calls", 1, "calls", 0, "input"],
    ["calls", 1, "calls", 1, "calls", 2, "calls", 1, "calls", 1, "calls", 1, "input"],
    ["calls", 1, "calls", 1, "calls", 2, "calls", 1, "calls", 1, "calls", 2, "input"],
    ["calls", 1, "calls", 1, "calls", 2, "calls", 1, "calls", 2, "input"],
    ["calls", 1, "calls", 1, "calls", 2, "calls", 1, "calls", 3, "value"],
    ["calls", 1, "calls", 1, "calls", 2, "calls", 2, "value"],
    ["calls", 1, "calls", 1, "calls", 3, "value"],
  ];
  for (const path of paths) {
    const changed = structuredClone(trace) as any; let owner = changed;
    for (const key of path.slice(0, -1)) owner = owner[key as any];
    const key = path.at(-1)!; owner[key as any] = key === "value" ? "0x1" : key === "to"
      ? "0x1111111111111111111111111111111111111111" : key === "output" ? `0x${"00".repeat(32)}` : "0xdeadbeef";
    assert.equal(verifyBnbCompositeTrace(changed, tx, fixture.decoded.acrossData.message, call).outcome, "protocol_mismatch", path.join("."));
  }
  const extra = structuredClone(trace) as any;
  extra.calls[1].calls[1].calls.push(frame(BNB_COMPOSITE.executor, BNB_COMPOSITE.weth, "0x095ea7b3", 0n));
  assert.equal(verifyBnbCompositeTrace(extra, tx, fixture.decoded.acrossData.message, call).outcome, "protocol_mismatch");
  const reordered = structuredClone(trace) as any;
  reordered.calls[1].calls[1].calls.reverse();
  assert.equal(verifyBnbCompositeTrace(reordered, tx, fixture.decoded.acrossData.message, call).outcome, "protocol_mismatch");
  const framePaths = [["calls", 0], ["calls", 1], ["calls", 1, "calls", 0], ["calls", 1, "calls", 1],
    ["calls", 1, "calls", 1, "calls", 2], ["calls", 1, "calls", 1, "calls", 2, "calls", 1],
    ["calls", 1, "calls", 1, "calls", 2, "calls", 1, "calls", 1],
    ["calls", 1, "calls", 1, "calls", 2, "calls", 1, "calls", 1, "calls", 0],
    ["calls", 1, "calls", 1, "calls", 2, "calls", 1, "calls", 1, "calls", 1],
    ["calls", 1, "calls", 1, "calls", 2, "calls", 1, "calls", 1, "calls", 2],
    ["calls", 1, "calls", 1, "calls", 2, "calls", 1, "calls", 2],
    ["calls", 1, "calls", 1, "calls", 2, "calls", 1, "calls", 3],
    ["calls", 1, "calls", 1, "calls", 2, "calls", 2], ["calls", 1, "calls", 1, "calls", 3]] as const;
  for (const path of framePaths) {
    const failed = structuredClone(trace) as any; let node = failed;
    for (const key of path) node = node[key as any]; node.error = "execution reverted";
    assert.equal(verifyBnbCompositeTrace(failed, tx, fixture.decoded.acrossData.message, call).outcome, "protocol_mismatch", `error:${path.join(".")}`);
  }
});

test("caught Fly execution proves recovered WETH without any Executor native delivery", () => {
  const call = decodeBnbCompositeMessage(fixture.decoded.acrossData.message, fixture.decoded.bridgeData.transactionId, fixture.decoded.bridgeData.receiver);
  const trace = canonicalTrace(call) as any, receiver = trace.calls[1], executor = receiver.calls[1];
  executor.error = "execution reverted"; executor.output = "0x"; executor.calls = [];
  receiver.calls = [receiver.calls[0], executor,
    tokenFrame(BNB_COMPOSITE.receiver, BNB_COMPOSITE.weth, "transfer", [call.finalReceiver, BigInt(call.inputAmountAtomic)]), receiver.calls[2]];
  const proof = verifyBnbCompositeTrace(trace, `0x${"34".repeat(32)}` as Hex, fixture.decoded.acrossData.message, call);
  assert.equal(proof.outcome, "recovered_weth"); assert.equal(proof.deliveredAmountAtomic, "0");
  const leaked = structuredClone(trace) as any;
  leaked.calls[1].calls[1].calls = [frame(BNB_COMPOSITE.executor, call.finalReceiver, "0x", 1n)];
  assert.equal(verifyBnbCompositeTrace(leaked, `0x${"34".repeat(32)}` as Hex, fixture.decoded.acrossData.message, call).outcome, "protocol_mismatch");
});

test("BNB destination outcomes survive restart, finalize spent usage and never resend", async (t) => {
  for (const outcome of ["recovered_weth", "below_floor", "protocol_mismatch"] as const) {
    const temporary = await temporaryState(); t.after(temporary.cleanup);
    const s = await lifiFixture(temporary.root, "eth-bnb");
    s.provider.statusValue = "completed_observed"; s.destination.destinationCompositeOutcome = outcome;
    const prepared = await s.prepare("across", `bnb-${outcome}-001`);
    const result = await s.core.execute({ command: "bridge.approve", operationId: prepared.id });
    assert.equal(result.ok, true, `${outcome}: ${result.error?.message}`);
    const record = (await s.core.bridges.records.findOperation(prepared.id))!;
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

test("BNB destination RPC absence remains evidence_unavailable and observe-only across restart", async (t) => {
  const temporary = await temporaryState(); t.after(temporary.cleanup);
  const s = await lifiFixture(temporary.root, "eth-bnb");
  s.provider.statusValue = "completed_observed"; s.destination.failObserve = true;
  const prepared = await s.prepare("across", "bnb-evidence-unavailable-001");
  await s.core.execute({ command: "bridge.approve", operationId: prepared.id });
  let record = (await s.core.bridges.records.findOperation(prepared.id))!;
  assert.equal(record.state, "unknown_finality"); assert.equal(record.failure?.reason, "evidence_unavailable");
  const restarted = new ApnCore({ state: s.state, bridge: s.dependencies, clock: { now: () => new Date(s.now) } });
  await restarted.execute({ command: "operation.resume", operationId: prepared.id });
  record = (await restarted.bridges.records.findOperation(prepared.id))!;
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

test("Vault pool configuration pins registration and the complete token order", () => {
  const abi = parseAbi(["function getPool(bytes32) view returns (address,uint8)", "function getPoolTokens(bytes32) view returns (address[],uint256[],uint256)"]);
  const pool = BNB_COMPOSITE.poolId.slice(0, 42) as Address;
  const registration = (address = pool, specialization = 1) => encodeFunctionResult({ abi, functionName: "getPool", result: [address, specialization] });
  const tokens = (rows: readonly Address[]) => encodeFunctionResult({ abi, functionName: "getPoolTokens", result: [rows, rows.map(() => 1n), 123n] });
  assert.deepEqual(verifyBnbPoolConfiguration(registration(), tokens(BNB_COMPOSITE.poolTokens)).tokens, BNB_COMPOSITE.poolTokens);
  assert.throws(() => verifyBnbPoolConfiguration(registration("0x1111111111111111111111111111111111111111"), tokens(BNB_COMPOSITE.poolTokens)));
  assert.throws(() => verifyBnbPoolConfiguration(registration(pool, 0), tokens(BNB_COMPOSITE.poolTokens)));
  assert.throws(() => verifyBnbPoolConfiguration(registration(), tokens([...BNB_COMPOSITE.poolTokens].reverse())));
  assert.throws(() => verifyBnbPoolConfiguration(registration(), tokens([...BNB_COMPOSITE.poolTokens, pool])));
  assert.throws(() => verifyBnbPoolConfiguration("0x1234", "0x5678"));
});

test("strict BNB composite decoder rejects every security-bound payload region", () => {
  const call = fixture.decoded.destination.swaps[0].callData;
  const mutations = [
    [0, 0xff], [4 + 32, 0xff], // selector / ABI length
    [4 + 64 + 0, 0xff], [4 + 64 + 2, 0xff], [4 + 64 + 4, 0xff], [4 + 64 + 24, 0xff], [4 + 64 + 44, 0xff],
    [4 + 64 + 64, 0xff], [4 + 64 + 96, 0xff], [4 + 64 + 99, 0xff], [4 + 64 + 102, 0xff], [4 + 64 + 137, 0xff],
    [4 + 64 + 140, 1], [4 + 64 + 206, 1], [4 + 64 + 229, 0xff], [4 + 64 + 249, 0xff],
    [4 + 64 + 271, 0xff], [4 + 64 + 289, 0xff], [4 + 64 + 297, 0xff], [4 + 64 + 329, 0xff],
    [4 + 64 + 412, 0xff], [4 + 64 + 421, 0xff], [4 + 64 + 430, 0xff], [4 + 64 + 439, 0xff], [4 + 64 + 448, 0xff],
  ] as const;
  for (const [at, value] of mutations) assert.throws(() => decodeFlyProgram(mutate(call, at, value), fixture.decoded.bridgeData.receiver,
    BigInt(fixture.decoded.destination.swaps[0].fromAmount)), { name: "ApnError" }, `mutation at ${at}`);
});

test("every non-quote Fly VM byte is frozen against mutation", () => {
  const call = fixture.decoded.destination.swaps[0].callData;
  const dynamic = [[64, 96], [105, 137], [141, 206], [208, 212], [213, 220], [221, 228], [229, 231], [272, 278]];
  for (let payloadByte = 0; payloadByte < 457; payloadByte++) {
    if (dynamic.some(([start, end]) => payloadByte >= start! && payloadByte < end!)) continue;
    const absolute = 68 + payloadByte, current = Buffer.from(call.slice(2), "hex")[absolute]!;
    assert.throws(() => decodeFlyProgram(mutate(call, absolute, current ^ 1), fixture.decoded.bridgeData.receiver,
      BigInt(fixture.decoded.destination.swaps[0].fromAmount)), { name: "ApnError" }, `payload byte ${payloadByte}`);
  }
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

const traceAbi = parseAbi([
  "function handleV3AcrossMessage(address,uint256,address,bytes)",
  "function swapAndCompleteBridgeTokens(bytes32,(address callTo,address approveTo,address sendingAssetId,address receivingAssetId,uint256 fromAmount,bytes callData,bool requiresDeposit)[],address,address)",
  "function approve(address,uint256)", "function transfer(address,uint256)", "function transferFrom(address,address,uint256)",
  "function withdraw(uint256)",
  "function swap((bytes32 poolId,uint8 kind,address assetIn,address assetOut,uint256 amount,bytes userData),(address sender,bool fromInternalBalance,address recipient,bool toInternalBalance),uint256,uint256) returns (uint256)",
  "function onSwap((uint8 kind,address tokenIn,address tokenOut,uint256 amount,bytes32 poolId,uint256 lastChangeBlock,address from,address to,bytes userData),uint256,uint256) view returns (uint256)",
]);
function canonicalTrace(call: ReturnType<typeof decodeBnbCompositeMessage>): Record<string, any> {
  const [, swaps] = decodeAbiParameters(parseAbiParameters("bytes32,(address callTo,address approveTo,address sendingAssetId,address receivingAssetId,uint256 fromAmount,bytes callData,bool requiresDeposit)[],address"), fixture.decoded.acrossData.message);
  const amount = BigInt(call.inputAmountAtomic), output = BigInt(call.expectedOutputAtomic), relayer = "0x2222222222222222222222222222222222222222" as Address;
  const vaultData = encodeFunctionData({ abi: traceAbi, functionName: "swap", args: [
    { poolId: BNB_COMPOSITE.poolId, kind: 0, assetIn: BNB_COMPOSITE.weth, assetOut: BNB_COMPOSITE.wbnb, amount, userData: "0x" },
    { sender: BNB_COMPOSITE.core, fromInternalBalance: false, recipient: BNB_COMPOSITE.core, toInternalBalance: false }, 0n, BigInt(call.deadlineAtomic),
  ] });
  const core = frame(BNB_COMPOSITE.flyRouter, BNB_COMPOSITE.core, "0x12345678", 0n, [
    tokenFrame(BNB_COMPOSITE.core, BNB_COMPOSITE.weth, "approve", [BNB_COMPOSITE.vault, amount]),
    frame(BNB_COMPOSITE.core, BNB_COMPOSITE.vault, vaultData, 0n, [
      { ...frame(BNB_COMPOSITE.vault, BNB_COMPOSITE.pool, encodeFunctionData({ abi: traceAbi, functionName: "onSwap", args: [
        { kind: 0, tokenIn: BNB_COMPOSITE.weth, tokenOut: BNB_COMPOSITE.wbnb, amount, poolId: BNB_COMPOSITE.poolId,
          lastChangeBlock: 123n, from: BNB_COMPOSITE.core, to: BNB_COMPOSITE.core, userData: "0x" }, 1n, 1n,
      ] }), 0n, [], `0x${output.toString(16).padStart(64, "0")}`), type: "STATICCALL" },
      tokenFrame(BNB_COMPOSITE.vault, BNB_COMPOSITE.weth, "transferFrom", [BNB_COMPOSITE.core, BNB_COMPOSITE.vault, amount]),
      tokenFrame(BNB_COMPOSITE.vault, BNB_COMPOSITE.wbnb, "transfer", [BNB_COMPOSITE.core, output]),
    ], `0x${output.toString(16).padStart(64, "0")}`),
    tokenFrame(BNB_COMPOSITE.core, BNB_COMPOSITE.wbnb, "withdraw", [output]),
    frame(BNB_COMPOSITE.core, BNB_COMPOSITE.flyRouter, "0x", output),
  ]);
  const fly = frame(BNB_COMPOSITE.executor, BNB_COMPOSITE.flyRouter, call.flyCalldata, 0n, [
    tokenFrame(BNB_COMPOSITE.flyRouter, BNB_COMPOSITE.weth, "transferFrom", [BNB_COMPOSITE.executor, BNB_COMPOSITE.core, amount]),
    core, frame(BNB_COMPOSITE.flyRouter, BNB_COMPOSITE.executor, "0x", output),
  ]);
  const executorData = encodeFunctionData({ abi: traceAbi, functionName: "swapAndCompleteBridgeTokens", args: [
    call.transactionId, swaps, BNB_COMPOSITE.weth, call.finalReceiver,
  ] });
  const executor = frame(BNB_COMPOSITE.receiver, BNB_COMPOSITE.executor, executorData, 0n, [
    tokenFrame(BNB_COMPOSITE.executor, BNB_COMPOSITE.weth, "transferFrom", [BNB_COMPOSITE.receiver, BNB_COMPOSITE.executor, amount]),
    tokenFrame(BNB_COMPOSITE.executor, BNB_COMPOSITE.weth, "approve", [BNB_COMPOSITE.flyRouter, amount]),
    fly, frame(BNB_COMPOSITE.executor, call.finalReceiver, "0x", output),
  ]);
  const handler = encodeFunctionData({ abi: traceAbi, functionName: "handleV3AcrossMessage",
    args: [BNB_COMPOSITE.weth, amount, relayer, fixture.decoded.acrossData.message] });
  const receiver = frame(BNB_COMPOSITE.spokePool, BNB_COMPOSITE.receiver, handler, 0n, [
    tokenFrame(BNB_COMPOSITE.receiver, BNB_COMPOSITE.weth, "approve", [BNB_COMPOSITE.executor, amount]), executor,
    tokenFrame(BNB_COMPOSITE.receiver, BNB_COMPOSITE.weth, "approve", [BNB_COMPOSITE.executor, 0n]),
  ]);
  return frame(relayer, BNB_COMPOSITE.spokePool, "0x", 0n, [
    tokenFrame(BNB_COMPOSITE.spokePool, BNB_COMPOSITE.weth, "transfer", [BNB_COMPOSITE.receiver, amount]), receiver,
  ]);
}
function frame(from: Address, to: Address, input: Hex, value: bigint, calls: readonly unknown[] = [], output: Hex = "0x") {
  return { type: "CALL", from, to, value: `0x${value.toString(16)}`, input, output, calls };
}
function tokenFrame(from: Address, to: Address, name: "approve" | "transfer" | "transferFrom" | "withdraw", args: readonly unknown[]) {
  return frame(from, to, encodeFunctionData({ abi: traceAbi, functionName: name, args: args as never }), 0n);
}
