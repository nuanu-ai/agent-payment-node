import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import test from "node:test";
import { decodeFunctionData, encodeFunctionData, getAddress } from "viem";
import { acrossBridgeAbi, stargateBridgeAbi } from "../../src/lifi/abi.js";
import { BRIDGE_QUOTE_DESTINATIONS, validateBridgeRequest } from "../../src/lifi/asset-registry.js";
import { bindBridgeCommand } from "../../src/lifi/command-catalog.js";
import { decodeBridgeCall } from "../../src/lifi/decode.js";
import { bridgeDeployment } from "../../src/lifi/deployments.js";
import type { BridgeRouteRequest } from "../../src/lifi/model.js";
import { inspectBridgeRouteMaterialization, materializeBridgeRoute, parseBridgeRoutes } from "../../src/lifi/routes.js";

type Json = Record<string, any>;
const SENDER = getAddress("0x1111111111111111111111111111111111111111");
const SOURCE = getAddress("0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48");
const fixture = JSON.parse(await readFile(resolve("tests/core/lifi-fixtures/lifi-ethereum-additional-destinations-quote-20260920.json"), "utf8")) as Json;

function admittedRows(): { chainId: number; tool: "across" | "stargateV2"; step: Json }[] {
  const rows: { chainId: number; tool: "across" | "stargateV2"; step: Json }[] = [];
  for (const [chain, tools] of Object.entries(fixture.rows as Json)) for (const [tool, capture] of Object.entries(tools as Json)) {
    if (capture.httpStatus === 200) rows.push({ chainId: Number(chain), tool: tool as "across" | "stargateV2", step: structuredClone(capture.body) });
  }
  return rows;
}

function request(step: Json): BridgeRouteRequest {
  return validateBridgeRequest({ fromChainId: 1, toChainId: step.action.toChainId, fromToken: SOURCE,
    toToken: step.action.toToken.address, amountAtomic: step.action.fromAmount, recipient: SENDER,
    minOutputAtomic: step.estimate.toAmountMin, maxNativeDebitWei: "999999999999999999",
    maxRouteFeeAtomic: "1000000", slippageBps: 50 });
}

function route(step: Json): Json {
  const discovery = structuredClone(step); delete discovery.transactionRequest; delete discovery.transactionId;
  return { id: `quote-${step.action.toChainId}-${step.tool}`, ...step.action, containsSwitchChain: false,
    toAmount: step.estimate.toAmount, toAmountMin: step.estimate.toAmountMin, steps: [discovery] };
}

function inspect(step: Json) {
  const r = request(step), response = { status: 200, body: JSON.stringify({ routes: [route(step)] }) };
  const selected = parseBridgeRoutes(response, r, SENDER)[0]!;
  const parsed = inspectBridgeRouteMaterialization(selected, { status: 200, body: JSON.stringify(step) }, r, SENDER);
  return { request: r, selected, parsed, decoded: decodeBridgeCall(parsed.materialization) };
}

function rejected(step: Json): void {
  assert.throws(() => inspect(step), { code: "APN_PROVIDER_PROTOCOL" });
}

test("recorded LI.FI quotes admit only the five reviewed destination decoder lanes and remain non-executable", () => {
  const rows = admittedRows();
  assert.deepEqual(rows.map(({ chainId, tool }) => `${chainId}:${tool}`).sort(),
    ["10:across", "10:stargateV2", "130:across", "137:across", "43114:stargateV2"]);
  for (const { chainId, tool, step } of rows) {
    const result = inspect(step), registry = BRIDGE_QUOTE_DESTINATIONS[chainId as keyof typeof BRIDGE_QUOTE_DESTINATIONS];
    assert.equal(result.selected.choice.preparable, false);
    assert.equal(result.selected.choice.unavailableReason, "destination_execution_unreviewed");
    assert.throws(() => materializeBridgeRoute(result.selected, { status: 200, body: JSON.stringify(step) }, result.request, SENDER),
      { code: "APN_PROVIDER_CAPABILITY_UNAVAILABLE" });
    assert.equal(result.decoded.sourceChainId, 1);
    assert.equal(result.decoded.destinationChainId, chainId);
    assert.equal(result.decoded.destinationToken, registry.token);
    assert.equal(result.decoded.tool, tool);
    assert.equal(result.decoded.feeAmountAtomic, "25000");
    assert.equal(result.decoded.bridgeAmountAtomic, "9975000");
    assert.equal(result.parsed.implicitProtocolFeeAtomic,
      (BigInt(step.action.fromAmount) - step.estimate.feeCosts.filter((fee: Json) => fee.included)
        .reduce((sum: bigint, fee: Json) => sum + BigInt(fee.amount), 0n) - BigInt(step.estimate.toAmount)).toString());
  }
});

test("additional destination admission binds exact chain, asset and protocol calldata", () => {
  for (const { step } of admittedRows()) {
    const wrongChain = structuredClone(step); wrongChain.action.toChainId = 56;
    assert.throws(() => request(wrongChain), { code: "APN_INVALID_INPUT" });
    const wrongAsset = structuredClone(step); wrongAsset.action.toToken.address = SOURCE;
    assert.throws(() => request(wrongAsset), { code: "APN_INVALID_INPUT" });
    const abi = step.tool === "across" ? acrossBridgeAbi : stargateBridgeAbi;
    const decoded = decodeFunctionData({ abi, data: step.transactionRequest.data });
    const args = structuredClone(decoded.args) as unknown as any[];
    args[0].destinationChainId = 8453n;
    const changed = structuredClone(step);
    changed.transactionRequest.data = encodeFunctionData({ abi, functionName: decoded.functionName, args: args as never });
    rejected(changed);
  }
  const op = admittedRows().find((row) => row.chainId === 10)!.step;
  const command = bindBridgeCommand("bridge routes", { "--profile": "example", "--from-chain": "eip155:1",
    "--to-chain": "eip155:10", "--from-token": SOURCE, "--to-token": op.action.toToken.address,
    "--amount": "10", "--to": SENDER, "--min-output": "9", "--max-native-debit-wei": "999999999999999999",
    "--max-route-fee": "1", "--slippage-bps": "50" });
  assert.equal(command.command, "bridge.routes");
  if (command.command === "bridge.routes") assert.equal(command.request.toChainId, 10);
  assert.throws(() => validateBridgeRequest({ ...request(op), fromChainId: 8453,
    fromToken: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913" }), { code: "APN_INVALID_INPUT" });
  assert.throws(() => bridgeDeployment(1, 10 as 8453, "across", SOURCE), { code: "APN_PROVIDER_CAPABILITY_UNAVAILABLE" });
});

test("additional destination fee accounting rejects fixed fee, included fee and native fee tampering", () => {
  for (const { step } of admittedRows()) {
    const fixed = structuredClone(step); fixed.estimate.feeCosts[0].amount = "24999"; rejected(fixed);
    const included = structuredClone(step);
    const row = included.estimate.feeCosts.find((fee: Json) => fee.included && fee.name !== "LIFI Fixed Fee");
    if (row !== undefined) { row.amount = (BigInt(row.amount) + 10_000_000n).toString(); rejected(included); }
    if (step.tool === "stargateV2") {
      const native = structuredClone(step), fee = native.estimate.feeCosts.find((entry: Json) => !entry.included)!;
      fee.amount = (BigInt(fee.amount) + 1n).toString(); rejected(native);
    }
  }
});

test("provider 404 tool pairs and Glacis, Mayan and LI.FI Intents remain refused", () => {
  const unavailable = Object.entries(fixture.rows as Json).flatMap(([chain, tools]) => Object.entries(tools as Json)
    .filter(([, capture]) => capture.httpStatus === 404).map(([tool, capture]) => `${chain}:${tool}:${capture.body.message}`));
  assert.deepEqual(unavailable.sort(), [
    "130:stargateV2:No available quotes for the requested transfer",
    "137:stargateV2:No available quotes for the requested transfer",
    "43114:across:No available quotes for the requested transfer",
  ]);
  for (const tool of ["glacis", "mayan", "near"] as const) {
    const step = structuredClone(admittedRows()[0]!.step);
    step.tool = tool; step.toolDetails.key = tool; step.estimate.tool = tool; step.includedSteps[1].tool = tool;
    const r = request(step), parsed = parseBridgeRoutes({ status: 200, body: JSON.stringify({ routes: [route(step)] }) }, r, SENDER)[0]!;
    assert.equal(parsed.choice.preparable, false);
    assert.equal(parsed.choice.unavailableReason, "finite_decoder_and_correlated_evidence_unavailable");
    assert.throws(() => inspectBridgeRouteMaterialization(parsed, { status: 200, body: JSON.stringify(step) }, r, SENDER),
      { code: "APN_PROVIDER_CAPABILITY_UNAVAILABLE" });
  }
});
