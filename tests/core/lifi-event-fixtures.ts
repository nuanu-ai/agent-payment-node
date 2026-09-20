import assert from "node:assert/strict";
import { decodeEventLog, encodeAbiParameters, encodeEventTopics, getAbiItem, getAddress, keccak256, type AbiParameter } from "viem";
import { BNB_COMPOSITE } from "../../src/lifi/bnb-composite.js";
import type { Address, Hex } from "../../src/model.js";
import type { BridgeChainId } from "../../src/lifi/chains.js";
import { bridgeEventsAbi, FEE_FORWARDER, FEE_RECIPIENT } from "../../src/lifi/abi.js";
import { bridgeProtocolEmitter } from "../../src/lifi/deployments.js";
import type { BridgeLog, BridgeProtocolReceipt, BridgeSourceProof, DecodedBridgeCall } from "../../src/lifi/model.js";
import { BRIDGE_DIAMOND, BRIDGE_ZERO_ADDRESS, BRIDGE_ZERO_WORD } from "../../src/lifi/validation.js";
import { BRIDGE_ASSET_REGISTRY } from "../../src/lifi/asset-registry.js";
type Json = Record<string, any>;
const HASH = `0x${"ab".repeat(32)}` as Hex;
const TX_HASH = `0x${"12".repeat(32)}` as Hex;
const RELAYER = getAddress("0x2222222222222222222222222222222222222222");
const PAYER = getAddress("0x3333333333333333333333333333333333333333");
export function makeSourceReceipt(d: DecodedBridgeCall): BridgeProtocolReceipt {
  const emitter = bridgeProtocolEmitter(d.sourceChainId, d.tool, d.sourceToken);
  const native = d.sourceToken === BRIDGE_ZERO_ADDRESS;
  const logs: BridgeLog[] = [
    eventLog(BRIDGE_DIAMOND, "LiFiTransferStarted", { bridgeData: bridgeData(d) }),
    eventLog(FEE_FORWARDER, "FeesForwarded", { token: d.sourceToken, distributions: [{ recipient: FEE_RECIPIENT, amount: BigInt(d.feeAmountAtomic) }] }),
  ];
  if (native) logs.push(eventLog(BRIDGE_ASSET_REGISTRY[d.sourceChainId].nativeCoin.wrapped.address, "Deposit", { dst: emitter, wad: BigInt(d.bridgeAmountAtomic) }));
  else logs.unshift(
    eventLog(d.sourceToken, "Transfer", { from: d.sender, to: BRIDGE_DIAMOND, value: BigInt(d.sourceAmountAtomic) }),
    eventLog(d.sourceToken, "Transfer", { from: BRIDGE_DIAMOND, to: FEE_RECIPIENT, value: BigInt(d.feeAmountAtomic) }),
    eventLog(d.sourceToken, "Transfer", { from: BRIDGE_DIAMOND, to: emitter, value: BigInt(d.bridgeAmountAtomic) }),
  );
  if (d.protocol.kind === "across") logs.push(eventLog(emitter, "FundsDeposited", {
    inputToken: d.protocol.sendingAssetId, outputToken: d.protocol.receivingAssetId, inputAmount: BigInt(d.bridgeAmountAtomic),
    outputAmount: BigInt(d.protocol.outputAmountAtomic), destinationChainId: BigInt(d.destinationChainId), depositId: BigInt(d.sourceChainId),
    quoteTimestamp: Number(d.protocol.quoteTimestamp), fillDeadline: Number(d.protocol.fillDeadline), exclusivityDeadline: 0,
    depositor: d.protocol.refundAddress, recipient: d.protocol.receiverAddress, exclusiveRelayer: d.protocol.exclusiveRelayer, message: d.protocol.message,
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
    const fill = eventLog(emitter, "FilledRelay", {
      inputToken: c.inputToken, outputToken: c.outputToken, inputAmount: BigInt(c.inputAmountAtomic), outputAmount: BigInt(c.outputAmountAtomic),
      repaymentChainId: fillType === 2 ? 0n : BigInt(d.destinationChainId), originChainId: BigInt(c.originChainId), depositId: BigInt(c.depositId),
      fillDeadline: Number(c.fillDeadline), exclusivityDeadline: Number(c.exclusivityDeadline), exclusiveRelayer: c.exclusiveRelayer,
      relayer: fillType === 2 ? BRIDGE_ZERO_WORD : addressWord(RELAYER), depositor: c.depositor, recipient: c.recipient,
      messageHash: d.composite === undefined ? BRIDGE_ZERO_WORD : keccak256(c.message),
      relayExecutionInfo: { updatedRecipient: c.recipient, updatedMessageHash: d.composite === undefined ? BRIDGE_ZERO_WORD : keccak256(c.message), updatedOutputAmount: BigInt(c.outputAmountAtomic), fillType },
    });
    if (d.destinationToken === BRIDGE_ZERO_ADDRESS) {
      if (d.composite !== undefined) {
        const amount = d.composite.expectedOutputAtomic, result = receipt(d.destinationChainId, [fill]);
        const beforeBlock = { numberAtomic: "122", hash: `0x${"bc".repeat(32)}` as Hex, timestampAtomic: "1" };
        return { ...result, nativeBalance: { recipient: d.recipient, beforeBlock,
          afterBlock: { numberAtomic: result.blockNumberAtomic, hash: result.blockHash, timestampAtomic: "2" }, beforeBalanceAtomic: "100",
          afterBalanceAtomic: (100n + BigInt(amount)).toString(), deltaAtomic: amount },
          nativeTransfer: { transactionHash: result.transactionHash, from: BNB_COMPOSITE.executor, to: d.recipient, valueAtomic: amount, traceHash: "a".repeat(64) } };
      }
      const wrapped = BRIDGE_ASSET_REGISTRY[d.destinationChainId].nativeCoin.wrapped;
      const unwrap = wrapped.events === "weth9" ? eventLog(wrapped.address, "Withdrawal", { src: emitter, wad: BigInt(c.outputAmountAtomic) })
        : eventLog(wrapped.address, "Transfer", { from: emitter, to: BRIDGE_ZERO_ADDRESS, value: BigInt(c.outputAmountAtomic) });
      const result = receipt(d.destinationChainId, [fill, unwrap]);
      if (d.destinationChainId !== 143 && d.destinationChainId !== 59144) return result;
      const beforeBlock = { numberAtomic: "122", hash: `0x${"bc".repeat(32)}` as Hex, timestampAtomic: "1" };
      const afterBlock = { numberAtomic: result.blockNumberAtomic, hash: result.blockHash, timestampAtomic: "2" };
      return { ...result, nativeBalance: { recipient: d.recipient, beforeBlock, afterBlock, beforeBalanceAtomic: "100",
        afterBalanceAtomic: (100n + BigInt(c.outputAmountAtomic)).toString(), deltaAtomic: c.outputAmountAtomic },
        nativeTransfer: { transactionHash: result.transactionHash, from: emitter, to: d.recipient, valueAtomic: c.outputAmountAtomic,
          traceHash: "a".repeat(64) } };
    }
    return receipt(d.destinationChainId, [fill,
      eventLog(d.destinationToken, "Transfer", { from: fillType === 2 ? emitter : PAYER, to: d.recipient, value: BigInt(c.outputAmountAtomic) })]);
  }
  const c = source.correlation;
  return receipt(d.destinationChainId, [
    eventLog(emitter, "OFTReceived", { guid: c.guid, srcEid: c.sourceEid, toAddress: c.recipient, amountReceivedLD: BigInt(c.amountReceivedAtomic) }),
    eventLog(d.destinationToken, "Transfer", { from: emitter, to: d.recipient, value: BigInt(c.amountReceivedAtomic) }),
  ]);
}

function receipt(chainId: BridgeChainId, logs: readonly BridgeLog[]): BridgeProtocolReceipt {
  return { chainId, transactionHash: TX_HASH, blockNumberAtomic: "123", blockHash: HASH, logs };
}

function bridgeData(d: DecodedBridgeCall): Json {
  return { transactionId: d.transactionId, bridge: d.bridgeName, integrator: d.integrator, referrer: d.referrer, sendingAssetId: d.sourceToken,
    receiver: d.recipient, minAmount: BigInt(d.bridgeAmountAtomic), destinationChainId: BigInt(d.destinationChainId), hasSourceSwaps: true, hasDestinationCall: d.composite !== undefined };
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
