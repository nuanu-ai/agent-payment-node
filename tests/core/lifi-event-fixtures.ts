import assert from "node:assert/strict";
import { decodeEventLog, encodeAbiParameters, encodeEventTopics, getAbiItem, getAddress, type AbiParameter } from "viem";
import type { Address, Hex } from "../../src/model.js";
import { bridgeEventsAbi, FEE_FORWARDER, FEE_RECIPIENT } from "../../src/lifi/abi.js";
import { bridgeProtocolEmitter } from "../../src/lifi/deployments.js";
import type { BridgeLog, BridgeProtocolReceipt, BridgeSourceProof, DecodedBridgeCall } from "../../src/lifi/model.js";
import { BRIDGE_DIAMOND, BRIDGE_ZERO_WORD } from "../../src/lifi/validation.js";
type Json = Record<string, any>;
const HASH = `0x${"ab".repeat(32)}` as Hex;
const TX_HASH = `0x${"12".repeat(32)}` as Hex;
const RELAYER = getAddress("0x2222222222222222222222222222222222222222");
const PAYER = getAddress("0x3333333333333333333333333333333333333333");
export function makeSourceReceipt(d: DecodedBridgeCall): BridgeProtocolReceipt {
  const emitter = bridgeProtocolEmitter(d.sourceChainId, d.tool, d.sourceToken);
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

export function makeDestinationReceipt(d: DecodedBridgeCall, source: BridgeSourceProof, fillType: 0 | 1 | 2 = 0): BridgeProtocolReceipt {
  const emitter = bridgeProtocolEmitter(d.destinationChainId, d.tool, d.destinationToken);
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

export function eventLog(address: Address, eventName: string, args: Json): BridgeLog {
  const item = getAbiItem({ abi: bridgeEventsAbi as any, name: eventName as any }) as any;
  assert.equal(item.type, "event");
  const inputs = item.inputs as readonly (AbiParameter & { indexed?: boolean })[];
  const topics = encodeEventTopics({ abi: [item] as any, eventName: eventName as never, args: args as never } as never) as readonly Hex[];
  const plain = inputs.filter((x) => !x.indexed) as readonly AbiParameter[];
  const values = inputs.filter((x) => !x.indexed).map((x) => args[x.name!]);
  return { address, topics, data: encodeAbiParameters(plain, values as never) };
}

export function mutateEvent(log: BridgeLog, eventName: string, changes: Json): BridgeLog {
  return eventLog(log.address, eventName, { ...eventArgs(log, eventName), ...changes });
}

export function eventArgs(log: BridgeLog, eventName: string): Json {
  const decoded = decodeEventLog({ abi: bridgeEventsAbi, eventName: eventName as never, data: log.data, topics: log.topics as [Hex, ...Hex[]], strict: true }) as unknown as { args: Json };
  return decoded.args;
}


export function addressWord(address: Address): Hex { return `0x${"0".repeat(24)}${address.slice(2).toLowerCase()}` as Hex; }
function guid(chainId: number): Hex { return `0x${BigInt(chainId).toString(16).padStart(64, "0")}` as Hex; }
