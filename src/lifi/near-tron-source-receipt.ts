/** Pure, offline source deposit candidate for a previously validated NEAR Intents quote.
 * Event ABI follows lifinance/contracts@6a670100f9d011e39fbf2fe973493de0a50cf970.
 * The caller must supply a canonical, safe receipt for the exact transaction; this
 * decoder does not fetch RPC state or verify facet deployment/backend signing.
 */
import { decodeEventLog, parseAbi, toEventSelector } from "viem";
import type { Address, Hex } from "../model.js";
import { canonicalJson, sha256 } from "../canonical.js";
import { EVENT_TOPICS } from "./abi.js";
import type { BridgeLog } from "./model.js";
import { inspectNearBaseTronQuoteOffline, type NearTronOfflineBinding } from "./near-tron-offline.js";
import { BRIDGE_DIAMOND, BRIDGE_ZERO_WORD, bridgeAddress, bridgeFailure, bridgeHex, bridgeUint } from "./validation.js";

export const nearSourceEventsAbi = parseAbi([
  "event NEARIntentsBridgeStarted(bytes32 indexed transactionId,bytes32 indexed quoteId,address indexed depositAddress,address sendingAssetId,uint256 amount,uint256 deadline,uint256 minAmountOut)",
  "event BridgeToNonEVMChainBytes32(bytes32 indexed transactionId,uint256 indexed destinationChainId,bytes32 receiver)",
  "event LiFiTransferStarted((bytes32 transactionId,string bridge,string integrator,address referrer,address sendingAssetId,address receiver,uint256 minAmount,uint256 destinationChainId,bool hasSourceSwaps,bool hasDestinationCall) bridgeData)",
  "event Transfer(address indexed from,address indexed to,uint256 value)",
]);
const topics = {
  near: toEventSelector(nearSourceEventsAbi[0]!), nonEvm: toEventSelector(nearSourceEventsAbi[1]!),
  lifi: EVENT_TOPICS.lifiTransferStarted, transfer: EVENT_TOPICS.transfer,
};
export interface NearSourceTransaction {
  readonly chainId: 8453; readonly hash: Hex; readonly from: Address; readonly to: Address;
  readonly input: Hex; readonly valueAtomic: string;
}
/** Membership and finality must be verified by the caller's RPC adapter. */
export interface NearSafeSourceReceipt {
  readonly chainId: 8453; readonly transactionHash: Hex; readonly status: "success";
  readonly blockNumberAtomic: string; readonly blockHash: Hex; readonly safe: true;
  readonly logs: readonly BridgeLog[];
}
export interface NearTronSourceDepositCandidate {
  readonly kind: "offline_near_tron_source_deposit_candidate";
  readonly executionAdmitted: false; readonly bridgeCompletion: false;
  readonly recipientDelivery: "unverified"; readonly status: "unverified";
  readonly chainId: 8453; readonly transactionHash: Hex; readonly blockNumberAtomic: string;
  readonly blockHash: Hex; readonly logsHash: string; readonly transactionId: Hex;
  readonly quoteId: Hex; readonly depositAddress: Address; readonly sourceToken: Address;
  readonly bridgeAmountAtomic: string; readonly facetMinimumOutputAtomic: string;
  readonly tronRecipient: string; readonly facetNonEvmReceiver: Hex;
  readonly quotedDestinationToken: string; readonly minimumOutputAtomic: string;
  readonly refundTo: Address;
}
function fail(reason: string): never { return bridgeFailure("APN_RPC_PROTOCOL", `near_tron_receipt_${reason}`); }
function one<T>(logs: readonly BridgeLog[], address: Address, topic: Hex, name: string): T {
  const found = logs.filter(x => x.address === address && x.topics[0]?.toLowerCase() === topic.toLowerCase());
  if (found.length !== 1) fail(`${name}_count`);
  try { return (decodeEventLog({ abi: nearSourceEventsAbi, eventName: name as never, data: found[0]!.data,
    topics: found[0]!.topics as [Hex, ...Hex[]], strict: true }) as { args: T }).args; }
  catch { return fail(`${name}_decode`); }
}
export function inspectNearBaseTronSourceReceiptOffline(
  frozenQuote: unknown, binding: NearTronOfflineBinding, tx: NearSourceTransaction, receipt: NearSafeSourceReceipt,
): NearTronSourceDepositCandidate {
  const quote = inspectNearBaseTronQuoteOffline(frozenQuote, binding);
  const raw = frozenQuote as { transactionId: Hex; transactionRequest: { data: Hex } };
  const txHash = bridgeHex(tx.hash, 32, 32, "APN_RPC_PROTOCOL");
  const blockHash = bridgeHex(receipt.blockHash, 32, 32, "APN_RPC_PROTOCOL");
  bridgeUint(receipt.blockNumberAtomic, true, "APN_RPC_PROTOCOL");
  if (txHash === BRIDGE_ZERO_WORD || blockHash === BRIDGE_ZERO_WORD || tx.chainId !== 8453 || receipt.chainId !== 8453 ||
    receipt.status !== "success" || receipt.safe !== true || bridgeHex(receipt.transactionHash, 32, 32, "APN_RPC_PROTOCOL") !== txHash) fail("identity");
  if (bridgeAddress(tx.from, "APN_RPC_PROTOCOL") !== bridgeAddress(binding.sender, "APN_RPC_PROTOCOL") ||
    bridgeAddress(tx.to, "APN_RPC_PROTOCOL") !== BRIDGE_DIAMOND || tx.valueAtomic !== "0" ||
    bridgeHex(tx.input, 12 * 1024, undefined, "APN_RPC_PROTOCOL") !== bridgeHex(raw.transactionRequest.data, 12 * 1024, undefined, "APN_RPC_PROTOCOL") ||
    tx.input.slice(0, 10).toLowerCase() !== "0x3110c7b9") fail("transaction_binding");
  if (!Array.isArray(receipt.logs) || receipt.logs.length > 512) fail("log_count");
  for (const log of receipt.logs) {
    if (bridgeAddress(log.address, "APN_RPC_PROTOCOL") !== log.address || !Array.isArray(log.topics) || log.topics.length > 4) fail("log_shape");
    for (const topic of log.topics) bridgeHex(topic, 32, 32, "APN_RPC_PROTOCOL");
    bridgeHex(log.data, 12 * 1024, undefined, "APN_RPC_PROTOCOL");
  }
  const near = one<{ transactionId: Hex; quoteId: Hex; depositAddress: Address; sendingAssetId: Address; amount: bigint; deadline: bigint; minAmountOut: bigint }>(receipt.logs, BRIDGE_DIAMOND, topics.near, "NEARIntentsBridgeStarted");
  const nonEvm = one<{ transactionId: Hex; destinationChainId: bigint; receiver: Hex }>(receipt.logs, BRIDGE_DIAMOND, topics.nonEvm, "BridgeToNonEVMChainBytes32");
  const lifi = one<{ bridgeData: { transactionId: Hex; bridge: string; integrator: string; referrer: Address; sendingAssetId: Address; receiver: Address; minAmount: bigint; destinationChainId: bigint; hasSourceSwaps: boolean; hasDestinationCall: boolean } }>(receipt.logs, BRIDGE_DIAMOND, topics.lifi, "LiFiTransferStarted").bridgeData;
  const deposits = receipt.logs.filter(x => x.address === quote.sourceToken && x.topics[0]?.toLowerCase() === topics.transfer.toLowerCase()).map(x => {
    try { return (decodeEventLog({ abi: nearSourceEventsAbi, eventName: "Transfer", data: x.data,
      topics: x.topics as [Hex, ...Hex[]], strict: true }) as { args: { from: Address; to: Address; value: bigint } }).args; }
    catch { return fail("Transfer_decode"); }
  }).filter(x => x.to === quote.depositAddress);
  if (deposits.length !== 1) fail("Transfer_count");
  const transfer = deposits[0]!;
  if (near.transactionId.toLowerCase() !== raw.transactionId.toLowerCase() || near.quoteId.toLowerCase() !== quote.quoteId.toLowerCase() ||
    near.depositAddress !== quote.depositAddress || near.sendingAssetId !== quote.sourceToken || near.amount.toString() !== quote.bridgeAmountAtomic ||
    near.deadline.toString() !== quote.deadline || near.minAmountOut.toString() !== quote.facetMinimumOutputAtomic ||
    nonEvm.transactionId.toLowerCase() !== raw.transactionId.toLowerCase() || nonEvm.destinationChainId.toString() !== quote.facetDestinationChainId ||
    nonEvm.receiver.toLowerCase() !== quote.facetNonEvmReceiver.toLowerCase() ||
    lifi.transactionId.toLowerCase() !== raw.transactionId.toLowerCase() || lifi.bridge !== "near" || lifi.integrator !== "lifi-api" ||
    lifi.referrer !== "0x0000000000000000000000000000000000000000" || lifi.sendingAssetId !== quote.sourceToken ||
    lifi.receiver !== "0x11f111f111f111F111f111f111F111f111f111F1" || lifi.minAmount.toString() !== quote.bridgeAmountAtomic ||
    lifi.destinationChainId.toString() !== quote.facetDestinationChainId || !lifi.hasSourceSwaps || lifi.hasDestinationCall ||
    transfer.from !== BRIDGE_DIAMOND || transfer.to !== quote.depositAddress || transfer.value.toString() !== quote.bridgeAmountAtomic) fail("event_binding");
  return { kind: "offline_near_tron_source_deposit_candidate", executionAdmitted: false, bridgeCompletion: false,
    recipientDelivery: "unverified", status: "unverified", chainId: 8453, transactionHash: txHash,
    blockNumberAtomic: receipt.blockNumberAtomic, blockHash, logsHash: sha256(canonicalJson(receipt.logs)),
    transactionId: raw.transactionId, quoteId: quote.quoteId, depositAddress: quote.depositAddress, sourceToken: quote.sourceToken,
    bridgeAmountAtomic: quote.bridgeAmountAtomic, facetMinimumOutputAtomic: quote.facetMinimumOutputAtomic,
    tronRecipient: quote.quotedTronRecipient, facetNonEvmReceiver: quote.facetNonEvmReceiver,
    quotedDestinationToken: quote.quotedDestinationToken, minimumOutputAtomic: quote.offchainMinimumOutputAtomic,
    refundTo: binding.sender };
}
