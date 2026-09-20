import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";
import { encodeFunctionResult, parseAbi } from "viem";
import type { Address, Hex } from "../../src/model.js";
import { BNB_COMPOSITE, decodeBnbCompositeMessage, decodeFlyProgram, verifyBnbPoolConfiguration, verifyFlyHeaderSignature } from "../../src/lifi/bnb-composite.js";
import { materializeBridgeRoute, parseBridgeRoutes } from "../../src/lifi/routes.js";
import type { BridgeRouteRequest } from "../../src/lifi/model.js";
import { decodeBridgeCall } from "../../src/lifi/decode.js";
import { bridgeDestinationProof, bridgeSourceProof } from "../../src/lifi/protocol-evidence.js";
import { eventLog, makeDestinationReceipt, makeSourceReceipt } from "./lifi-event-fixtures.js";

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
  assert.equal(proof.nativeTransfer!.from, BNB_COMPOSITE.executor);
  const recovered = { ...receipt, logs: [...receipt.logs, eventLog(BNB_COMPOSITE.weth, "Transfer", {
    from: BNB_COMPOSITE.receiver, to: decoded.recipient, value: BigInt(decoded.composite!.inputAmountAtomic),
  })] };
  assert.throws(() => bridgeDestinationProof(source, m, decoded, recovered), /bnb_recovered_weth/u);
  assert.throws(() => bridgeDestinationProof(source, m, decoded, { ...receipt, nativeTransfer: null }), /native_destination_transfer/u);
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
