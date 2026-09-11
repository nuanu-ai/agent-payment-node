import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import test from "node:test";
import { decodeEventLog, decodeFunctionData, encodeAbiParameters, encodeEventTopics, encodeFunctionData, getAbiItem, getAddress } from "viem";
import type { AbiParameter } from "viem";
import { canonicalJson, sha256 } from "../../src/canonical.js";
import type { Address, Hex } from "../../src/model.js";
import { ACROSS_SELECTOR, acrossBridgeAbi, bridgeEventsAbi, EVENT_TOPICS, FEE_FORWARDER, FEE_RECIPIENT, feeForwarderAbi, stargateBridgeAbi } from "../../src/lifi/abi.js";
import { decodeBridgeCall } from "../../src/lifi/decode.js";
import { bridgeDeployment, bridgeEndpointId, bridgeProtocolEmitter } from "../../src/lifi/deployments.js";
import type { BridgeLog, BridgeMaterialization, BridgeProtocolReceipt, BridgeSourceProof, DecodedBridgeCall } from "../../src/lifi/model.js";
import { bridgeDestinationProof, bridgeSourceProof, destinationEventFilter } from "../../src/lifi/protocol-evidence.js";
import { BRIDGE_DIAMOND, BRIDGE_USDC, BRIDGE_ZERO_ADDRESS, BRIDGE_ZERO_WORD } from "../../src/lifi/validation.js";

type Json = Record<string, any>;
const HASH = `0x${"ab".repeat(32)}` as Hex;
const TX_HASH = `0x${"12".repeat(32)}` as Hex;
const RELAYER = getAddress("0x2222222222222222222222222222222222222222");
const PAYER = getAddress("0x3333333333333333333333333333333333333333");

async function fixtures(): Promise<BridgeMaterialization[]> {
  const names = ["lifi-across-step-transactions-20260908.json", "lifi-stargate-taxi-step-transactions-20260908.json"];
  const output: BridgeMaterialization[] = [];
  for (const name of names) {
    const parsed = JSON.parse(await readFile(resolve("tests/core/lifi-fixtures", name), "utf8")) as Json;
    for (const row of Object.values(parsed.rows as Json) as Json[]) output.push(materialization(row));
  }
  return output;
}

function materialization(row: Json): BridgeMaterialization {
  const step = row.step as Json, action = step.action as Json, estimate = step.estimate as Json, tx = step.transactionRequest as Json;
  return {
    routeId: row.routeId as string, stepId: step.id as string, tool: step.tool,
    request: {
      fromChainId: action.fromChainId, toChainId: action.toChainId, fromToken: action.fromToken.address,
      toToken: action.toToken.address, amountAtomic: action.fromAmount, recipient: action.toAddress,
      minOutputAtomic: estimate.toAmountMin, maxNativeDebitWei: "999999999999999999", maxRouteFeeAtomic: "1000000", slippageBps: 50,
    },
    sender: action.fromAddress, approvalAddress: estimate.approvalAddress, quotedOutputAtomic: estimate.toAmount,
    minimumOutputAtomic: estimate.toAmountMin,
    feeCosts: (estimate.feeCosts as Json[]).map((fee) => ({
      name: fee.name, chainId: fee.token.chainId,
      asset: fee.token.address === BRIDGE_ZERO_ADDRESS ? "native" : fee.token.address,
      amountAtomic: fee.amount, included: fee.included,
    })),
    includedStepIdentities: [],
    transaction: { chainId: tx.chainId, from: tx.from, to: tx.to, valueAtomic: BigInt(tx.value).toString(), data: tx.data, gasLimitAtomic: BigInt(tx.gasLimit).toString() },
    requestHash: "0".repeat(64), responseHash: "1".repeat(64), routeHash: "2".repeat(64), stepHash: "3".repeat(64),
    materializedStepHash: "4".repeat(64), transactionDigest: "5".repeat(64),
  } as BridgeMaterialization;
}

function mutateData(m: BridgeMaterialization, edit: (args: any[]) => void): BridgeMaterialization {
  const abi = m.tool === "across" ? acrossBridgeAbi : stargateBridgeAbi;
  const decoded = decodeFunctionData({ abi, data: m.transaction.data });
  const args = structuredClone(decoded.args) as unknown as any[];
  edit(args);
  const data = encodeFunctionData({ abi, functionName: decoded.functionName, args: args as never });
  return { ...m, transaction: { ...m.transaction, data } };
}

function rejected(m: BridgeMaterialization): void {
  assert.throws(() => decodeBridgeCall(m), { code: "APN_PROVIDER_PROTOCOL" });
}

test("decodes all six captured Across and Stargate Taxi materializations byte-canonically", async () => {
  const rows = await fixtures();
  assert.equal(rows.length, 6);
  for (const m of rows) {
    const decoded = decodeBridgeCall(m);
    assert.equal(decoded.tool, m.tool);
    assert.equal(decoded.sourceAmountAtomic, "10000000");
    assert.equal(decoded.bridgeAmountAtomic, "9975000");
    assert.equal(decoded.feeAmountAtomic, "25000");
    assert.equal(decoded.minimumOutputAtomic, m.minimumOutputAtomic);
    assert.equal(decoded.dataHash, sha256(Buffer.from(m.transaction.data.slice(2), "hex")));
    assert.equal(decoded.protocol.kind, m.tool);
  }
});

test("common envelope, fee wrapper, and ABI malleability mutations fail closed", async () => {
  const m = (await fixtures())[0]!;
  rejected({ ...m, transaction: { ...m.transaction, to: FEE_FORWARDER } });
  rejected({ ...m, transaction: { ...m.transaction, valueAtomic: "1" } });
  rejected({ ...m, transaction: { ...m.transaction, data: `${m.transaction.data}00` as Hex } });
  const gapped = insertTopLevelGap(m.transaction.data);
  assert.doesNotThrow(() => decodeFunctionData({ abi: acrossBridgeAbi, data: gapped }));
  rejected({ ...m, transaction: { ...m.transaction, data: gapped } });
  rejected({ ...m, transaction: { ...m.transaction, data: `0xdeadbeef${m.transaction.data.slice(10)}` as Hex } });
  rejected({ ...m, sender: RELAYER });
  rejected({ ...m, minimumOutputAtomic: (BigInt(m.minimumOutputAtomic) + 1n).toString() });
  rejected({ ...m, request: { ...m.request, amountAtomic: "9999999" } });
  rejected({ ...m, feeCosts: m.feeCosts.map((x, i) => i === 0 ? { ...x, amountAtomic: "24999" } : x) });
  rejected(mutateData(m, (a) => { a[0].integrator = "evil"; }));
  rejected(mutateData(m, (a) => { a[0].referrer = RELAYER; }));
  rejected(mutateData(m, (a) => { a[0].hasDestinationCall = true; }));
  rejected(mutateData(m, (a) => { a[1].push(structuredClone(a[1][0])); }));
  rejected(mutateData(m, (a) => { a[1][0].requiresDeposit = false; }));
  rejected(mutateData(m, (a) => {
    const inner = decodeFunctionData({ abi: feeForwarderAbi, data: a[1][0].callData });
    const innerArgs = structuredClone(inner.args) as unknown as any[];
    innerArgs[1][0].recipient = RELAYER;
    a[1][0].callData = encodeFunctionData({ abi: feeForwarderAbi, functionName: inner.functionName, args: innerArgs as never });
  }));
});

test("Across binds every protocol field and exact output mathematics", async () => {
  const m = (await fixtures())[0]!;
  const cases: ((a: any[]) => void)[] = [
    (a) => { a[0].bridge = "stargateV2"; }, (a) => { a[2].receiverAddress = addressWord(RELAYER); },
    (a) => { a[2].refundAddress = addressWord(RELAYER); }, (a) => { a[2].sendingAssetId = BRIDGE_ZERO_WORD; },
    (a) => { a[2].receivingAssetId = BRIDGE_ZERO_WORD; }, (a) => { a[2].outputAmount += 1n; },
    (a) => { a[2].outputAmountMultiplier = 0n; }, (a) => { a[2].exclusiveRelayer = addressWord(RELAYER); },
    (a) => { a[2].exclusivityParameter = 1; }, (a) => { a[2].message = "0x01"; },
    (a) => { a[2].quoteTimestamp = a[2].fillDeadline; },
  ];
  for (const edit of cases) rejected(mutateData(m, edit));
});

test("Stargate binds Taxi, endpoint, receiver, amounts, refund, and native fee", async () => {
  const m = (await fixtures())[3]!;
  const cases: ((a: any[]) => void)[] = [
    (a) => { a[2].assetId = 2; }, (a) => { a[2].sendParams.dstEid += 1; },
    (a) => { a[2].sendParams.to = addressWord(RELAYER); }, (a) => { a[2].sendParams.amountLD -= 1n; },
    (a) => { a[2].sendParams.minAmountLD -= 1n; }, (a) => { a[2].sendParams.extraOptions = "0x01"; },
    (a) => { a[2].sendParams.composeMsg = "0x01"; }, (a) => { a[2].sendParams.oftCmd = "0x01"; },
    (a) => { a[2].fee.nativeFee += 1n; }, (a) => { a[2].fee.lzTokenFee = 1n; },
    (a) => { a[2].refundAddress = RELAYER; },
  ];
  for (const edit of cases) rejected(mutateData(m, edit));
  rejected({ ...m, feeCosts: m.feeCosts.filter((x) => x.included) });
  rejected({ ...m, request: { ...m.request, maxNativeDebitWei: (BigInt(m.transaction.valueAtomic) - 1n).toString() } });
});

test("deployment contracts pin code, legacy proxies, protocol configuration, and Stargate peers", () => {
  for (const [source, destination] of [[1, 8453], [1, 42161], [8453, 1], [8453, 42161], [42161, 1], [42161, 8453]] as const) {
    for (const tool of ["across", "stargateV2"] as const) {
      const d = bridgeDeployment(source, destination, tool);
      assert.equal(d.chainId, source); assert.equal(d.peerChainId, destination); assert.equal(d.tool, tool);
      assert.equal(d.diamond, BRIDGE_DIAMOND); assert.equal(d.feeForwarder, FEE_FORWARDER); assert.equal(d.token, BRIDGE_USDC[source]);
      assert.ok(d.code.length >= 7); assert.ok(d.code.every((x) => /^0x[0-9a-f]{64}$/.test(x.codeHash)));
      assert.ok(d.reads.some((x) => x.kind === "storage" && x.data.startsWith("0x7050c9")));
      assert.ok(d.reads.some((x) => x.kind === "storage" && x.data.startsWith("0x10d6a5")));
      assert.ok(d.reads.every((x) => /^0x(?:[0-9a-f]{2})+$/.test(x.data) && /^0x(?:[0-9a-f]{2})+$/.test(x.expected)));
      if (tool === "stargateV2") {
        assert.equal(d.endpointId, bridgeEndpointId(source));
        assert.ok(d.reads.some((x) => x.data.startsWith("0xbb0b6a53")));
        assert.ok(d.reads.some((x) => x.data.startsWith("0x")));
      } else assert.deepEqual([d.quoteTimeBufferAtomic, d.fillDeadlineBufferAtomic], ["3600", "21600"]);
    }
  }
  for (const chainId of [1, 8453, 42161] as const) {
    assert.throws(() => bridgeDeployment(chainId, chainId, "across"), { code: "APN_PROVIDER_CAPABILITY_UNAVAILABLE" });
    assert.throws(() => bridgeDeployment(chainId, chainId, "stargateV2"), { code: "APN_PROVIDER_CAPABILITY_UNAVAILABLE" });
  }
});

test("source and destination proofs correlate both tools across all three directions", async () => {
  for (const m of await fixtures()) {
    const decoded = decodeBridgeCall(m);
    const sourceReceipt = makeSourceReceipt(decoded);
    const source = bridgeSourceProof(m, decoded, sourceReceipt);
    const destinationReceipt = makeDestinationReceipt(decoded, source);
    const destination = bridgeDestinationProof(source, m, decoded, destinationReceipt);
    assert.equal(destination.amountAtomic, source.correlation.kind === "across" ? source.correlation.outputAmountAtomic : source.correlation.amountReceivedAtomic);
    assert.equal(destination.correlationHash, sha256(canonicalJson(source.correlation)));
    const filter = destinationEventFilter(source);
    assert.equal(filter.address, bridgeProtocolEmitter(decoded.destinationChainId, decoded.tool));
    assert.equal(filter.topics.length, 3);
  }
});

test("source proof rejects missing, duplicate, contradictory protocol and token evidence", async () => {
  for (const m of [(await fixtures())[0]!, (await fixtures())[3]!]) {
    const d = decodeBridgeCall(m), good = makeSourceReceipt(d);
    assert.throws(() => bridgeSourceProof(m, d, { ...good, logs: good.logs.slice(1) }), { code: "APN_RPC_PROTOCOL" });
    assert.throws(() => bridgeSourceProof(m, d, { ...good, logs: [...good.logs, good.logs.at(-1)!] }), { code: "APN_RPC_PROTOCOL" });
    assert.throws(() => bridgeSourceProof(m, d, { ...good, logs: [...good.logs, eventLog(d.sourceToken, "Transfer", { from: RELAYER, to: d.sender, value: 1n })] }), { code: "APN_RPC_PROTOCOL" });
    const changed = good.logs.map((x) => x.topics[0] === EVENT_TOPICS.transfer && x.topics[1] === addressWord(BRIDGE_DIAMOND)
      ? eventLog(d.sourceToken, "Transfer", { from: BRIDGE_DIAMOND, to: FEE_RECIPIENT, value: 1n }) : x);
    assert.throws(() => bridgeSourceProof(m, d, { ...good, logs: changed }), { code: "APN_RPC_PROTOCOL" });
    const principal = [...good.logs];
    principal[0] = mutateEvent(principal[0]!, "Transfer", { value: BigInt(d.sourceAmountAtomic) - 1n });
    assert.throws(() => bridgeSourceProof(m, d, { ...good, logs: principal }), { code: "APN_RPC_PROTOCOL" });
    const lifiArgs = eventArgs(good.logs[3]!, "LiFiTransferStarted");
    const lifi = [...good.logs];
    lifi[3] = eventLog(BRIDGE_DIAMOND, "LiFiTransferStarted", { bridgeData: { ...lifiArgs.bridgeData, minAmount: 1n } });
    assert.throws(() => bridgeSourceProof(m, d, { ...good, logs: lifi }), { code: "APN_RPC_PROTOCOL" });
    const fee = [...good.logs];
    fee[4] = mutateEvent(fee[4]!, "FeesForwarded", { distributions: [{ recipient: RELAYER, amount: BigInt(d.feeAmountAtomic) }] });
    assert.throws(() => bridgeSourceProof(m, d, { ...good, logs: fee }), { code: "APN_RPC_PROTOCOL" });
    const protocol = [...good.logs];
    protocol[5] = d.tool === "across"
      ? mutateEvent(protocol[5]!, "FundsDeposited", { outputAmount: 1n })
      : mutateEvent(protocol[5]!, "OFTSent", { amountReceivedLD: 1n });
    assert.throws(() => bridgeSourceProof(m, d, { ...good, logs: protocol }), { code: "APN_RPC_PROTOCOL" });
  }
});

test("Across destination requires the full tuple while accepting an independent relayer credit and all valid fill types", async () => {
  const m = (await fixtures())[0]!, d = decodeBridgeCall(m), source = bridgeSourceProof(m, d, makeSourceReceipt(d));
  for (const fillType of [0, 1, 2] as const) {
    const receipt = makeDestinationReceipt(d, source, fillType);
    const proof = bridgeDestinationProof(source, m, d, receipt);
    assert.equal(proof.fillType, fillType); assert.equal(proof.relayerCredit, fillType === 2 ? BRIDGE_ZERO_WORD : addressWord(RELAYER));
    assert.equal(proof.repaymentChainIdAtomic, fillType === 2 ? "0" : String(d.destinationChainId));
    const transfer = eventArgs(receipt.logs[1]!, "Transfer");
    assert.equal(transfer.from, fillType === 2 ? bridgeProtocolEmitter(d.destinationChainId, "across") : PAYER);
    assert.notEqual(addressWord(transfer.from), proof.relayerCredit);
  }
  const good = makeDestinationReceipt(d, source);
  assert.throws(() => bridgeDestinationProof(source, m, d, { ...good, logs: [good.logs[0]!] }), { code: "APN_RPC_PROTOCOL" });
  for (const change of [
    { depositId: 999n }, { inputToken: HASH }, { outputToken: HASH }, { inputAmount: 1n }, { outputAmount: 1n },
    { fillDeadline: 1 }, { exclusivityDeadline: 1 }, { exclusiveRelayer: addressWord(RELAYER) },
    { depositor: addressWord(RELAYER) }, { recipient: addressWord(RELAYER) }, { messageHash: HASH },
    { relayExecutionInfo: { updatedRecipient: addressWord(RELAYER), updatedMessageHash: BRIDGE_ZERO_WORD, updatedOutputAmount: BigInt(d.minimumOutputAtomic), fillType: 0 } },
    { relayExecutionInfo: { updatedRecipient: addressWord(d.recipient), updatedMessageHash: BRIDGE_ZERO_WORD, updatedOutputAmount: BigInt(d.minimumOutputAtomic) + 1n, fillType: 0 } },
    { relayExecutionInfo: { updatedRecipient: addressWord(d.recipient), updatedMessageHash: BRIDGE_ZERO_WORD, updatedOutputAmount: BigInt(d.minimumOutputAtomic) - 1n, fillType: 0 } },
    { relayExecutionInfo: { updatedRecipient: addressWord(d.recipient), updatedMessageHash: BRIDGE_ZERO_WORD, updatedOutputAmount: BigInt(d.minimumOutputAtomic), fillType: 3 } },
  ]) {
    const log = mutateEvent(good.logs[0]!, "FilledRelay", change);
    assert.throws(() => bridgeDestinationProof(source, m, d, { ...good, logs: [log, good.logs[1]!] }), { code: "APN_RPC_PROTOCOL" });
  }
  for (const [token, change] of [
    [d.destinationToken, { to: RELAYER }], [d.sourceToken, {}], [d.destinationToken, { value: 1n }],
    [d.destinationToken, { from: BRIDGE_ZERO_ADDRESS }],
  ] as const) {
    const transfer = eventLog(token, "Transfer", Object.assign({ from: PAYER, to: d.recipient, value: BigInt(d.minimumOutputAtomic) }, change));
    assert.throws(() => bridgeDestinationProof(source, m, d, { ...good, logs: [good.logs[0]!, transfer] }), { code: "APN_RPC_PROTOCOL" });
  }
  assert.throws(() => bridgeDestinationProof(source, m, d, { ...good, logs: [...good.logs, good.logs[1]!] }), { code: "APN_RPC_PROTOCOL" });
});

test("Across repayment credit preserves bytes32 identity and slow-fill reserve semantics", async () => {
  const m = (await fixtures())[0]!, d = decodeBridgeCall(m), source = bridgeSourceProof(m, d, makeSourceReceipt(d));
  const fast = makeDestinationReceipt(d, source);
  for (const credit of [BRIDGE_ZERO_WORD, HASH]) {
    const log = mutateEvent(fast.logs[0]!, "FilledRelay", { relayer: credit, repaymentChainId: 34268394551451n });
    const proof = bridgeDestinationProof(source, m, d, { ...fast, logs: [log, fast.logs[1]!] });
    assert.equal(proof.relayerCredit, credit); assert.equal(proof.repaymentChainIdAtomic, "34268394551451");
  }
  const slow = makeDestinationReceipt(d, source, 2);
  assert.equal(bridgeDestinationProof(source, m, d, slow).fillType, 2);
  for (const change of [{ relayer: addressWord(RELAYER) }, { repaymentChainId: 1n }]) {
    const log = mutateEvent(slow.logs[0]!, "FilledRelay", change);
    assert.throws(() => bridgeDestinationProof(source, m, d, { ...slow, logs: [log, slow.logs[1]!] }), { code: "APN_RPC_PROTOCOL" });
  }
  const wrongPayer = mutateEvent(slow.logs[1]!, "Transfer", { from: PAYER });
  assert.throws(() => bridgeDestinationProof(source, m, d, { ...slow, logs: [slow.logs[0]!, wrongPayer] }), { code: "APN_RPC_PROTOCOL" });
});

test("Stargate destination requires GUID, source EID, receiver, amount, and exact USDC Transfer", async () => {
  const m = (await fixtures())[3]!, d = decodeBridgeCall(m), source = bridgeSourceProof(m, d, makeSourceReceipt(d));
  const good = makeDestinationReceipt(d, source);
  assert.throws(() => bridgeDestinationProof(source, m, d, { ...good, logs: [good.logs[0]!] }), { code: "APN_RPC_PROTOCOL" });
  for (const change of [{ guid: HASH }, { srcEid: 999 }, { toAddress: RELAYER }, { amountReceivedLD: 1n }]) {
    const log = mutateEvent(good.logs[0]!, "OFTReceived", change);
    assert.throws(() => bridgeDestinationProof(source, m, d, { ...good, logs: [log, good.logs[1]!] }), { code: "APN_RPC_PROTOCOL" });
  }
  const duplicate = { ...good, logs: [...good.logs, good.logs[0]!] };
  assert.throws(() => bridgeDestinationProof(source, m, d, duplicate), { code: "APN_RPC_PROTOCOL" });
  for (const change of [{ from: RELAYER }, { to: RELAYER }, { value: 1n }]) {
    const transfer = mutateEvent(good.logs[1]!, "Transfer", change);
    assert.throws(() => bridgeDestinationProof(source, m, d, { ...good, logs: [good.logs[0]!, transfer] }), { code: "APN_RPC_PROTOCOL" });
  }
  const c = source.correlation;
  assert.equal(c.kind, "stargateV2");
  const cached = eventLog(bridgeProtocolEmitter(d.destinationChainId, d.tool), "UnreceivedTokenCached", {
    guid: c.guid, index: 0, srcEid: c.sourceEid, receiver: d.recipient, amountLD: BigInt(c.amountReceivedAtomic), composeMsg: "0x",
  });
  assert.throws(() => bridgeDestinationProof(source, m, d, { ...good, logs: [...good.logs, cached] }), { code: "APN_RPC_PROTOCOL" });
});

test("destination proof rejects forged stored source correlations and wrong receipt chains", async () => {
  for (const m of [(await fixtures())[0]!, (await fixtures())[3]!]) {
    const d = decodeBridgeCall(m), source = bridgeSourceProof(m, d, makeSourceReceipt(d));
    const receipt = makeDestinationReceipt(d, source);
    const correlation = source.correlation.kind === "across"
      ? { ...source.correlation, depositId: (BigInt(source.correlation.depositId) + 1n).toString() }
      : { ...source.correlation, destinationEid: source.correlation.destinationEid + 1 };
    assert.throws(() => bridgeDestinationProof({ ...source, correlation }, m, d, receipt), { code: "APN_RPC_PROTOCOL" });
    assert.throws(() => bridgeDestinationProof(source, m, d, { ...receipt, chainId: d.sourceChainId }), { code: "APN_RPC_PROTOCOL" });
  }
});

function makeSourceReceipt(d: DecodedBridgeCall): BridgeProtocolReceipt {
  const emitter = bridgeProtocolEmitter(d.sourceChainId, d.tool);
  const logs: BridgeLog[] = [
    eventLog(d.sourceToken, "Transfer", { from: d.sender, to: BRIDGE_DIAMOND, value: BigInt(d.sourceAmountAtomic) }),
    eventLog(d.sourceToken, "Transfer", { from: BRIDGE_DIAMOND, to: FEE_RECIPIENT, value: BigInt(d.feeAmountAtomic) }),
    eventLog(d.sourceToken, "Transfer", { from: BRIDGE_DIAMOND, to: emitter, value: BigInt(d.bridgeAmountAtomic) }),
    eventLog(BRIDGE_DIAMOND, "LiFiTransferStarted", { bridgeData: bridgeData(d) }),
    eventLog(FEE_FORWARDER, "FeesForwarded", { token: d.sourceToken, distributions: [{ recipient: FEE_RECIPIENT, amount: BigInt(d.feeAmountAtomic) }] }),
  ];
  if (d.protocol.kind === "across") logs.push(eventLog(emitter, "FundsDeposited", {
    inputToken: d.protocol.sendingAssetId, outputToken: d.protocol.receivingAssetId, inputAmount: BigInt(d.bridgeAmountAtomic),
    outputAmount: BigInt(d.protocol.outputAmountAtomic), destinationChainId: BigInt(d.destinationChainId), depositId: BigInt(d.sourceChainId),
    quoteTimestamp: Number(d.protocol.quoteTimestamp), fillDeadline: Number(d.protocol.fillDeadline), exclusivityDeadline: 0,
    depositor: d.protocol.refundAddress, recipient: d.protocol.receiverAddress, exclusiveRelayer: d.protocol.exclusiveRelayer, message: "0x",
  }));
  else logs.push(eventLog(emitter, "OFTSent", {
    guid: guid(d.sourceChainId), dstEid: d.protocol.dstEid, fromAddress: BRIDGE_DIAMOND,
    amountSentLD: BigInt(d.bridgeAmountAtomic), amountReceivedLD: BigInt(d.minimumOutputAtomic),
  }));
  return receipt(d.sourceChainId, logs);
}

function makeDestinationReceipt(d: DecodedBridgeCall, source: BridgeSourceProof, fillType: 0 | 1 | 2 = 0): BridgeProtocolReceipt {
  const emitter = bridgeProtocolEmitter(d.destinationChainId, d.tool);
  if (source.correlation.kind === "across") {
    const c = source.correlation;
    return receipt(d.destinationChainId, [eventLog(emitter, "FilledRelay", {
      inputToken: c.inputToken, outputToken: c.outputToken, inputAmount: BigInt(c.inputAmountAtomic), outputAmount: BigInt(c.outputAmountAtomic),
      repaymentChainId: fillType === 2 ? 0n : BigInt(d.destinationChainId), originChainId: BigInt(c.originChainId), depositId: BigInt(c.depositId),
      fillDeadline: Number(c.fillDeadline), exclusivityDeadline: Number(c.exclusivityDeadline), exclusiveRelayer: c.exclusiveRelayer,
      relayer: fillType === 2 ? BRIDGE_ZERO_WORD : addressWord(RELAYER), depositor: c.depositor, recipient: c.recipient, messageHash: BRIDGE_ZERO_WORD,
      relayExecutionInfo: { updatedRecipient: c.recipient, updatedMessageHash: BRIDGE_ZERO_WORD, updatedOutputAmount: BigInt(c.outputAmountAtomic), fillType },
    }), eventLog(d.destinationToken, "Transfer", { from: fillType === 2 ? emitter : PAYER, to: d.recipient, value: BigInt(c.outputAmountAtomic) })]);
  }
  const c = source.correlation;
  return receipt(d.destinationChainId, [
    eventLog(emitter, "OFTReceived", { guid: c.guid, srcEid: c.sourceEid, toAddress: c.recipient, amountReceivedLD: BigInt(c.amountReceivedAtomic) }),
    eventLog(d.destinationToken, "Transfer", { from: emitter, to: d.recipient, value: BigInt(c.amountReceivedAtomic) }),
  ]);
}

function receipt(chainId: 1 | 8453 | 42161, logs: readonly BridgeLog[]): BridgeProtocolReceipt {
  return { chainId, transactionHash: TX_HASH, blockNumberAtomic: "123", blockHash: HASH, logs };
}

function bridgeData(d: DecodedBridgeCall): Json {
  return { transactionId: d.transactionId, bridge: d.bridgeName, integrator: d.integrator, referrer: d.referrer, sendingAssetId: d.sourceToken,
    receiver: d.recipient, minAmount: BigInt(d.bridgeAmountAtomic), destinationChainId: BigInt(d.destinationChainId), hasSourceSwaps: true, hasDestinationCall: false };
}

function eventLog(address: Address, eventName: string, args: Json): BridgeLog {
  const item = getAbiItem({ abi: bridgeEventsAbi as any, name: eventName as any }) as any;
  assert.equal(item.type, "event");
  const inputs = item.inputs as readonly (AbiParameter & { indexed?: boolean })[];
  const topics = encodeEventTopics({ abi: [item] as any, eventName: eventName as never, args: args as never } as never) as readonly Hex[];
  const plain = inputs.filter((x) => !x.indexed) as readonly AbiParameter[];
  const values = inputs.filter((x) => !x.indexed).map((x) => args[x.name!]);
  return { address, topics, data: encodeAbiParameters(plain, values as never) };
}

function mutateEvent(log: BridgeLog, eventName: string, changes: Json): BridgeLog {
  return eventLog(log.address, eventName, { ...eventArgs(log, eventName), ...changes });
}

function eventArgs(log: BridgeLog, eventName: string): Json {
  const decoded = decodeEventLog({ abi: bridgeEventsAbi, eventName: eventName as never, data: log.data, topics: log.topics as [Hex, ...Hex[]], strict: true }) as unknown as { args: Json };
  return decoded.args;
}

function insertTopLevelGap(data: Hex): Hex {
  const head = data.slice(10, 10 + 3 * 64);
  const shifted = [0, 1, 2].map((index) => (BigInt(`0x${head.slice(index * 64, (index + 1) * 64)}`) + 32n).toString(16).padStart(64, "0")).join("");
  return `${data.slice(0, 10)}${shifted}${"0".repeat(64)}${data.slice(10 + 3 * 64)}` as Hex;
}

function addressWord(address: Address): Hex { return `0x${"0".repeat(24)}${address.slice(2).toLowerCase()}` as Hex; }
function guid(chainId: number): Hex { return `0x${BigInt(chainId).toString(16).padStart(64, "0")}` as Hex; }
