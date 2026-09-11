import { decodeEventLog } from "viem";
import { canonicalJson, sha256 } from "../canonical.js";
import type { Address, Hex } from "../model.js";
import { bridgeEventsAbi, EVENT_TOPICS, FEE_FORWARDER, FEE_RECIPIENT } from "./abi.js";
import { decodeBridgeCall } from "./decode.js";
import { bridgeEndpointId, bridgeProtocolEmitter } from "./deployments.js";
import type { AcrossCorrelation, BridgeDestinationProof, BridgeLog, BridgeMaterialization, BridgeProtocolReceipt, BridgeSourceProof, DecodedBridgeCall, StargateCorrelation } from "./model.js";
import { BRIDGE_DIAMOND, BRIDGE_USDC, BRIDGE_ZERO_ADDRESS, BRIDGE_ZERO_WORD, bridgeAddress, bridgeFailure, bridgeHash, bridgeHex, bridgeSame, bridgeUint } from "./validation.js";

type BridgeEventData = Readonly<{
  transactionId: Hex; bridge: string; integrator: string; referrer: Address; sendingAssetId: Address;
  receiver: Address; minAmount: bigint; destinationChainId: bigint; hasSourceSwaps: boolean; hasDestinationCall: boolean;
}>;
type FundsDeposited = Readonly<{
  inputToken: Hex; outputToken: Hex; inputAmount: bigint; outputAmount: bigint; destinationChainId: bigint; depositId: bigint;
  quoteTimestamp: number; fillDeadline: number; exclusivityDeadline: number; depositor: Hex; recipient: Hex; exclusiveRelayer: Hex; message: Hex;
}>;
type FilledRelay = Readonly<{
  inputToken: Hex; outputToken: Hex; inputAmount: bigint; outputAmount: bigint; repaymentChainId: bigint; originChainId: bigint;
  depositId: bigint; fillDeadline: number; exclusivityDeadline: number; exclusiveRelayer: Hex; relayer: Hex; depositor: Hex;
  recipient: Hex; messageHash: Hex; relayExecutionInfo: Readonly<{ updatedRecipient: Hex; updatedMessageHash: Hex; updatedOutputAmount: bigint; fillType: number }>;
}>;
type OFTSent = Readonly<{ guid: Hex; dstEid: number; fromAddress: Address; amountSentLD: bigint; amountReceivedLD: bigint }>;
type OFTReceived = Readonly<{ guid: Hex; srcEid: number; toAddress: Address; amountReceivedLD: bigint }>;
type Transfer = Readonly<{ from: Address; to: Address; value: bigint }>;

export function bridgeSourceProof(materialization: BridgeMaterialization, decoded: DecodedBridgeCall, receipt: BridgeProtocolReceipt): BridgeSourceProof {
  const canonical = decodeBridgeCall(materialization);
  if (!bridgeSame(canonical, decoded) || receipt.chainId !== decoded.sourceChainId) fail("source_binding");
  validateReceipt(receipt);
  validateCommonSourceEvents(decoded, receipt);
  validateSourceTransfers(decoded, receipt);
  const correlation = decoded.tool === "across" ? acrossSource(decoded, receipt) : stargateSource(decoded, receipt);
  return {
    tool: decoded.tool, chainId: receipt.chainId, transactionHash: receipt.transactionHash,
    blockNumberAtomic: receipt.blockNumberAtomic, blockHash: receipt.blockHash,
    sourceAmountAtomic: decoded.sourceAmountAtomic, bridgeAmountAtomic: decoded.bridgeAmountAtomic,
    feeForwardedAtomic: decoded.feeAmountAtomic, logsHash: logsHash(receipt.logs), correlation,
  };
}

export function bridgeDestinationProof(source: BridgeSourceProof, materialization: BridgeMaterialization, decoded: DecodedBridgeCall, receipt: BridgeProtocolReceipt): BridgeDestinationProof {
  const canonical = decodeBridgeCall(materialization);
  if (!bridgeSame(canonical, decoded) || source.tool !== decoded.tool || source.chainId !== decoded.sourceChainId ||
    source.sourceAmountAtomic !== decoded.sourceAmountAtomic || source.bridgeAmountAtomic !== decoded.bridgeAmountAtomic ||
    source.feeForwardedAtomic !== decoded.feeAmountAtomic || receipt.chainId !== decoded.destinationChainId) fail("destination_binding");
  validateStoredSource(source, decoded); validateReceipt(receipt);
  if (decoded.tool === "across") return acrossDestination(source, decoded, receipt);
  return stargateDestination(source, decoded, receipt);
}

function validateStoredSource(source: BridgeSourceProof, decoded: DecodedBridgeCall): void {
  if (bridgeHex(source.transactionHash, 32, 32, "APN_STATE_CORRUPT") === BRIDGE_ZERO_WORD ||
    bridgeHex(source.blockHash, 32, 32, "APN_STATE_CORRUPT") === BRIDGE_ZERO_WORD) fail("stored_source_identity");
  bridgeUint(source.blockNumberAtomic, true, "APN_STATE_CORRUPT"); bridgeHash(source.logsHash);
  if (source.correlation.kind === "across" && decoded.protocol.kind === "across") {
    const c = source.correlation, p = decoded.protocol;
    bridgeUint(c.depositId, false, "APN_STATE_CORRUPT");
    const inputToken = bridgeHex(c.inputToken, 32, 32, "APN_STATE_CORRUPT");
    const outputToken = bridgeHex(c.outputToken, 32, 32, "APN_STATE_CORRUPT");
    const depositor = bridgeHex(c.depositor, 32, 32, "APN_STATE_CORRUPT");
    const recipient = bridgeHex(c.recipient, 32, 32, "APN_STATE_CORRUPT");
    const exclusiveRelayer = bridgeHex(c.exclusiveRelayer, 32, 32, "APN_STATE_CORRUPT");
    bridgeUint(c.inputAmountAtomic, true, "APN_STATE_CORRUPT"); bridgeUint(c.outputAmountAtomic, true, "APN_STATE_CORRUPT");
    bridgeUint(c.quoteTimestamp, true, "APN_STATE_CORRUPT"); bridgeUint(c.fillDeadline, true, "APN_STATE_CORRUPT");
    bridgeUint(c.exclusivityDeadline, false, "APN_STATE_CORRUPT");
    if (c.originChainId !== decoded.sourceChainId || c.destinationChainId !== decoded.destinationChainId ||
      inputToken !== p.sendingAssetId || outputToken !== p.receivingAssetId || c.inputAmountAtomic !== decoded.bridgeAmountAtomic || c.outputAmountAtomic !== p.outputAmountAtomic ||
      depositor !== p.refundAddress || recipient !== p.receiverAddress || exclusiveRelayer !== p.exclusiveRelayer ||
      c.quoteTimestamp !== p.quoteTimestamp || c.fillDeadline !== p.fillDeadline || c.exclusivityDeadline !== "0" || c.message !== "0x") fail("stored_across_correlation");
    return;
  }
  if (source.correlation.kind === "stargateV2" && decoded.protocol.kind === "stargateV2") {
    const c = source.correlation;
    const guid = bridgeHex(c.guid, 32, 32, "APN_STATE_CORRUPT");
    const sender = bridgeAddress(c.sender, "APN_STATE_CORRUPT");
    const recipient = bridgeAddress(c.recipient, "APN_STATE_CORRUPT");
    bridgeUint(c.amountSentAtomic, true, "APN_STATE_CORRUPT");
    const received = bridgeUint(c.amountReceivedAtomic, true, "APN_STATE_CORRUPT");
    if (guid === BRIDGE_ZERO_WORD || c.sourceEid !== bridgeEndpointId(decoded.sourceChainId) || c.destinationEid !== decoded.protocol.dstEid ||
      sender !== decoded.sender || recipient !== decoded.recipient || c.amountSentAtomic !== decoded.bridgeAmountAtomic ||
      received < BigInt(decoded.minimumOutputAtomic)) fail("stored_stargate_correlation");
    return;
  }
  fail("stored_correlation_kind");
}

export function destinationEventFilter(source: BridgeSourceProof): { address: Address; topics: readonly (Hex | null)[] } {
  if (source.correlation.kind === "across") {
    const c = source.correlation;
    return { address: bridgeProtocolEmitter(c.destinationChainId, "across"), topics: [EVENT_TOPICS.filledRelay, uintWord(c.originChainId), uintWord(c.depositId)] };
  }
  const c = source.correlation;
  const destination = chainForEid(c.destinationEid);
  return { address: bridgeProtocolEmitter(destination, "stargateV2"), topics: [EVENT_TOPICS.oftReceived, bridgeHex(c.guid, 32, 32), addressWord(c.recipient)] };
}

function validateCommonSourceEvents(decoded: DecodedBridgeCall, receipt: BridgeProtocolReceipt): void {
  const lifi = oneEvent(receipt, BRIDGE_DIAMOND, EVENT_TOPICS.lifiTransferStarted, "LiFiTransferStarted") as { bridgeData: BridgeEventData };
  const b = lifi.bridgeData;
  if (b.transactionId.toLowerCase() !== decoded.transactionId || b.bridge !== decoded.bridgeName || b.integrator !== decoded.integrator ||
    b.referrer !== decoded.referrer || b.sendingAssetId !== decoded.sourceToken || b.receiver !== decoded.recipient ||
    b.minAmount.toString() !== decoded.bridgeAmountAtomic || b.destinationChainId !== BigInt(decoded.destinationChainId) ||
    !b.hasSourceSwaps || b.hasDestinationCall) fail("LiFiTransferStarted");
  const fees = oneEvent(receipt, FEE_FORWARDER, EVENT_TOPICS.feesForwarded, "FeesForwarded") as { token: Address; distributions: readonly { recipient: Address; amount: bigint }[] };
  if (fees.token !== decoded.sourceToken || fees.distributions.length !== 1 || fees.distributions[0]!.recipient !== FEE_RECIPIENT ||
    fees.distributions[0]!.amount.toString() !== decoded.feeAmountAtomic) fail("FeesForwarded");
}

function validateSourceTransfers(decoded: DecodedBridgeCall, receipt: BridgeProtocolReceipt): void {
  const transfers = events(receipt, decoded.sourceToken, EVENT_TOPICS.transfer, "Transfer") as readonly Transfer[];
  const fromSender = transfers.filter((x) => x.from === decoded.sender);
  const fromDiamond = transfers.filter((x) => x.from === BRIDGE_DIAMOND);
  const emitter = bridgeProtocolEmitter(decoded.sourceChainId, decoded.tool);
  if (transfers.length !== 3 || fromSender.length !== 1 || fromSender[0]!.to !== BRIDGE_DIAMOND || fromSender[0]!.value.toString() !== decoded.sourceAmountAtomic ||
    fromDiamond.length !== 2 || !fromDiamond.some((x) => x.to === FEE_RECIPIENT && x.value.toString() === decoded.feeAmountAtomic) ||
    !fromDiamond.some((x) => x.to === emitter && x.value.toString() === decoded.bridgeAmountAtomic)) fail("source_token_movements");
}

function acrossSource(decoded: DecodedBridgeCall, receipt: BridgeProtocolReceipt): AcrossCorrelation {
  if (decoded.protocol.kind !== "across") return fail("across_shape");
  const p = decoded.protocol;
  const emitter = bridgeProtocolEmitter(decoded.sourceChainId, "across");
  const e = oneEvent(receipt, emitter, EVENT_TOPICS.fundsDeposited, "FundsDeposited") as FundsDeposited;
  if (e.inputToken.toLowerCase() !== p.sendingAssetId || e.outputToken.toLowerCase() !== p.receivingAssetId ||
    e.inputAmount.toString() !== decoded.bridgeAmountAtomic || e.outputAmount.toString() !== p.outputAmountAtomic ||
    e.destinationChainId !== BigInt(decoded.destinationChainId) || e.quoteTimestamp.toString() !== p.quoteTimestamp ||
    e.fillDeadline.toString() !== p.fillDeadline || e.exclusivityDeadline !== 0 || e.depositor.toLowerCase() !== p.refundAddress ||
    e.recipient.toLowerCase() !== p.receiverAddress || e.exclusiveRelayer.toLowerCase() !== p.exclusiveRelayer || e.message !== "0x") fail("FundsDeposited");
  return {
    kind: "across", depositId: e.depositId.toString(), originChainId: decoded.sourceChainId, destinationChainId: decoded.destinationChainId,
    inputToken: bridgeHex(e.inputToken, 32, 32), outputToken: bridgeHex(e.outputToken, 32, 32), inputAmountAtomic: e.inputAmount.toString(),
    outputAmountAtomic: e.outputAmount.toString(), depositor: bridgeHex(e.depositor, 32, 32), recipient: bridgeHex(e.recipient, 32, 32),
    exclusiveRelayer: bridgeHex(e.exclusiveRelayer, 32, 32), quoteTimestamp: String(e.quoteTimestamp), fillDeadline: String(e.fillDeadline),
    exclusivityDeadline: String(e.exclusivityDeadline), message: "0x",
  };
}

function stargateSource(decoded: DecodedBridgeCall, receipt: BridgeProtocolReceipt): StargateCorrelation {
  if (decoded.protocol.kind !== "stargateV2") return fail("stargate_shape");
  const emitter = bridgeProtocolEmitter(decoded.sourceChainId, "stargateV2");
  const e = oneEvent(receipt, emitter, EVENT_TOPICS.oftSent, "OFTSent") as OFTSent;
  if (e.guid.toLowerCase() === BRIDGE_ZERO_WORD || e.dstEid !== decoded.protocol.dstEid || e.fromAddress !== BRIDGE_DIAMOND ||
    e.amountSentLD.toString() !== decoded.bridgeAmountAtomic || e.amountReceivedLD < BigInt(decoded.minimumOutputAtomic)) fail("OFTSent");
  return {
    kind: "stargateV2", guid: bridgeHex(e.guid, 32, 32), sourceEid: bridgeEndpointId(decoded.sourceChainId),
    destinationEid: decoded.protocol.dstEid, sender: decoded.sender, recipient: decoded.recipient,
    amountSentAtomic: e.amountSentLD.toString(), amountReceivedAtomic: e.amountReceivedLD.toString(),
  };
}

function acrossDestination(source: BridgeSourceProof, decoded: DecodedBridgeCall, receipt: BridgeProtocolReceipt): BridgeDestinationProof {
  if (source.correlation.kind !== "across") return fail("across_correlation");
  const c = source.correlation;
  const emitter = bridgeProtocolEmitter(decoded.destinationChainId, "across");
  const e = oneEvent(receipt, emitter, EVENT_TOPICS.filledRelay, "FilledRelay") as FilledRelay;
  const info = e.relayExecutionInfo;
  if (e.originChainId !== BigInt(c.originChainId) || e.depositId.toString() !== c.depositId || e.inputToken.toLowerCase() !== c.inputToken ||
    e.outputToken.toLowerCase() !== c.outputToken || e.inputAmount.toString() !== c.inputAmountAtomic || e.outputAmount.toString() !== c.outputAmountAtomic ||
    e.fillDeadline.toString() !== c.fillDeadline || e.exclusivityDeadline.toString() !== c.exclusivityDeadline ||
    e.exclusiveRelayer.toLowerCase() !== c.exclusiveRelayer || e.depositor.toLowerCase() !== c.depositor || e.recipient.toLowerCase() !== c.recipient ||
    e.messageHash.toLowerCase() !== BRIDGE_ZERO_WORD || info.updatedRecipient.toLowerCase() !== c.recipient ||
    info.updatedMessageHash.toLowerCase() !== BRIDGE_ZERO_WORD || info.updatedOutputAmount.toString() !== c.outputAmountAtomic ||
    !Number.isInteger(info.fillType) || info.fillType < 0 || info.fillType > 2) fail("FilledRelay");
  const relayerCredit = bridgeHex(e.relayer, 32, 32, "APN_RPC_PROTOCOL");
  const repaymentChainIdAtomic = bridgeUint(e.repaymentChainId.toString()).toString();
  if (info.fillType === 2 && (relayerCredit !== BRIDGE_ZERO_WORD || repaymentChainIdAtomic !== "0")) fail("slow_fill_credit");
  const transfers = events(receipt, decoded.destinationToken, EVENT_TOPICS.transfer, "Transfer") as readonly Transfer[];
  const delivered = transfers.filter((x) => x.to === decoded.recipient);
  if (delivered.length !== 1 || bridgeAddress(delivered[0]!.from) !== delivered[0]!.from || delivered[0]!.from === BRIDGE_ZERO_ADDRESS ||
    delivered[0]!.value.toString() !== c.outputAmountAtomic || (info.fillType === 2 && delivered[0]!.from !== emitter)) fail("destination_token_movement");
  return destinationResult(source, decoded, receipt, info.updatedOutputAmount.toString(), info.fillType as 0 | 1 | 2, relayerCredit, repaymentChainIdAtomic);
}

function stargateDestination(source: BridgeSourceProof, decoded: DecodedBridgeCall, receipt: BridgeProtocolReceipt): BridgeDestinationProof {
  if (source.correlation.kind !== "stargateV2") return fail("stargate_correlation");
  const c = source.correlation;
  const emitter = bridgeProtocolEmitter(decoded.destinationChainId, "stargateV2");
  const received = oneEvent(receipt, emitter, EVENT_TOPICS.oftReceived, "OFTReceived") as OFTReceived;
  const cached = events(receipt, emitter, EVENT_TOPICS.unreceivedTokenCached, "UnreceivedTokenCached") as readonly { guid: Hex }[];
  if (cached.some((x) => x.guid.toLowerCase() === c.guid) || received.guid.toLowerCase() !== c.guid || received.srcEid !== c.sourceEid ||
    received.toAddress !== c.recipient || received.amountReceivedLD.toString() !== c.amountReceivedAtomic ||
    received.amountReceivedLD < BigInt(decoded.minimumOutputAtomic)) fail("OFTReceived");
  const transfers = events(receipt, decoded.destinationToken, EVENT_TOPICS.transfer, "Transfer") as readonly Transfer[];
  const delivered = transfers.filter((x) => x.to === decoded.recipient);
  if (delivered.length !== 1 || delivered[0]!.from !== emitter || delivered[0]!.value !== received.amountReceivedLD) fail("destination_token_movement");
  return destinationResult(source, decoded, receipt, received.amountReceivedLD.toString(), null, null, null);
}

function destinationResult(source: BridgeSourceProof, decoded: DecodedBridgeCall, receipt: BridgeProtocolReceipt, amountAtomic: string, fillType: 0 | 1 | 2 | null, relayerCredit: Hex | null, repaymentChainIdAtomic: string | null): BridgeDestinationProof {
  return {
    tool: decoded.tool, chainId: receipt.chainId, transactionHash: receipt.transactionHash, blockNumberAtomic: receipt.blockNumberAtomic,
    blockHash: receipt.blockHash, recipient: decoded.recipient, token: decoded.destinationToken, amountAtomic,
    correlationHash: sha256(canonicalJson(source.correlation)), logsHash: logsHash(receipt.logs), fillType, relayerCredit, repaymentChainIdAtomic,
  };
}

function validateReceipt(receipt: BridgeProtocolReceipt): void {
  bridgeUint(receipt.blockNumberAtomic, true, "APN_RPC_PROTOCOL");
  if (bridgeHex(receipt.transactionHash, 32, 32, "APN_RPC_PROTOCOL") === BRIDGE_ZERO_WORD ||
    bridgeHex(receipt.blockHash, 32, 32, "APN_RPC_PROTOCOL") === BRIDGE_ZERO_WORD) fail("receipt_identity");
  if (receipt.logs.length > 512) fail("log_count");
  for (const log of receipt.logs) {
    if (bridgeAddress(log.address, "APN_RPC_PROTOCOL") !== log.address || log.topics.length > 4) fail("log_shape");
    for (const topic of log.topics) bridgeHex(topic, 32, 32, "APN_RPC_PROTOCOL");
    bridgeHex(log.data, 12 * 1024, undefined, "APN_RPC_PROTOCOL");
  }
}

function oneEvent(receipt: BridgeProtocolReceipt, address: Address, topic: Hex, eventName: string): unknown {
  const matches = events(receipt, address, topic, eventName);
  if (matches.length !== 1) fail(`${eventName}_count`);
  return matches[0]!;
}

function events(receipt: BridgeProtocolReceipt, address: Address, topic: Hex, eventName: string): readonly unknown[] {
  const output: unknown[] = [];
  for (const log of receipt.logs) {
    if (log.address !== address || log.topics[0]?.toLowerCase() !== topic) continue;
    try {
      const decoded = decodeEventLog({ abi: bridgeEventsAbi, eventName: eventName as never, data: log.data, topics: log.topics as [Hex, ...Hex[]], strict: true }) as unknown as { eventName: string; args: unknown };
      if (decoded.eventName !== eventName) fail(`${eventName}_decode`);
      output.push(decoded.args);
    } catch { fail(`${eventName}_decode`); }
  }
  return output;
}

function logsHash(logs: readonly BridgeLog[]): string { return sha256(canonicalJson(logs)); }
function uintWord(value: string | number): Hex { return `0x${BigInt(value).toString(16).padStart(64, "0")}` as Hex; }
function addressWord(address: Address): Hex { return `0x${"0".repeat(24)}${address.slice(2).toLowerCase()}` as Hex; }
function chainForEid(eid: number): 1 | 8453 | 42161 { if (eid === 30101) return 1; if (eid === 30184) return 8453; if (eid === 30110) return 42161; return fail("endpoint_identity"); }
function fail(reason: string): never { return bridgeFailure("APN_RPC_PROTOCOL", reason); }
