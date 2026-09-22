import {
  decodeEventLog, decodeFunctionResult, encodeFunctionData, getAddress, keccak256, pad, parseTransaction,
  recoverTransactionAddress, type Hex, type TransactionSerialized,
} from "viem";
import type { EvmRpcCall } from "../evm-ports.js";
import type { Address } from "../model.js";
import { LAYERZERO_ENDPOINT_V2_ABI, LAYERZERO_EXECUTOR_ABI, STARGATE_ERC20_ABI, STARGATE_QUOTE_ABI, STARGATE_SEND_ABI } from "./abi.js";
import type { StargateV2QuoteEvidence } from "./quote.js";
import {
  CODE, LAYERZERO_ENDPOINT_V2, STARGATE_TOKEN_DESTINATION_EID, STARGATE_TOKEN_DESTINATION_EXECUTOR, STARGATE_TOKEN_DESTINATION_MESSAGING,
  STARGATE_TOKEN_DESTINATION_POOL, STARGATE_TOKEN_DESTINATION_TOKEN, STARGATE_TOKEN_SOURCE_CHAIN,
  STARGATE_TOKEN_SOURCE_EID, STARGATE_TOKEN_SOURCE_EXECUTOR, STARGATE_TOKEN_SOURCE_MESSAGING, STARGATE_TOKEN_SOURCE_POOL,
  STARGATE_TOKEN_SOURCE_TOKEN, address, fail, hex32, packetBinding, quantity, uint,
} from "./token-codec.js";
import type {
  StargateTokenConfirmedReceipt, StargateTokenDestinationEvidence, StargateTokenEnvelope,
  StargateTokenOperation, StargateTokenSourceReceipt,
} from "./token-model.js";

export function rpcEnvelope(envelope: StargateTokenEnvelope) { return { from: envelope.from, to: envelope.to, data: envelope.data,
  value: `0x${BigInt(envelope.valueAtomic).toString(16)}`, gas: `0x${BigInt(envelope.gasLimitAtomic).toString(16)}`,
  maxFeePerGas: `0x${BigInt(envelope.maxFeePerGasAtomic).toString(16)}`,
  maxPriorityFeePerGas: `0x${BigInt(envelope.maxPriorityFeePerGasAtomic).toString(16)}` }; }

export function sourceReceipt(op: StargateTokenOperation, receipt: StargateTokenConfirmedReceipt): StargateTokenSourceReceipt {
  if (receipt.status !== "success" || receipt.finality !== op.finalityPolicy.source.blockTag || receipt.transactionHash !== op.transactionHash) fail("APN_RPC_PROTOCOL", "source_receipt");
  const events = receipt.logs.flatMap(log => { if (address(log.address) !== STARGATE_TOKEN_SOURCE_POOL) return []; try { return [decodeEventLog({ abi: STARGATE_SEND_ABI, eventName: "OFTSent", topics: log.topics as [Hex, ...Hex[]], data: log.data }).args]; } catch { return []; } });
  if (events.length !== 1) fail("APN_RPC_PROTOCOL", "source_oft_sent_count"); const event = events[0]!;
  const minimumOutputAtomic = (op.postApprovalQuote?.quote ?? op.quote).quote.minimumOutputAtomic;
  if (event.dstEid !== 30109 || address(event.fromAddress) !== op.owner || event.amountSentLD.toString() !== op.amountAtomic || event.amountReceivedLD.toString() !== minimumOutputAtomic) fail("APN_RPC_PROTOCOL", "source_oft_sent_binding");
  const packets = receipt.logs.flatMap(log => { if (address(log.address) !== LAYERZERO_ENDPOINT_V2) return []; try {
    const decoded = decodeEventLog({ abi: LAYERZERO_ENDPOINT_V2_ABI, eventName: "PacketSent", topics: log.topics as [Hex, ...Hex[]], data: log.data });
    return [packetBinding(decoded.args.encodedPayload)];
  } catch { return []; } });
  if (op.schemaVersion === "apn.stargate-v2-token-operation.v5" && packets.length !== 1) fail("APN_RPC_PROTOCOL", "source_packet_sent_count");
  const packet = packets[0]; if (packet !== undefined && (packet.guid !== event.guid || packet.sender.toLowerCase() !== pad(STARGATE_TOKEN_SOURCE_MESSAGING, { size: 32 }).toLowerCase() ||
    packet.receiver.toLowerCase() !== pad(STARGATE_TOKEN_DESTINATION_MESSAGING, { size: 32 }).toLowerCase())) fail("APN_RPC_PROTOCOL", "source_packet_sent_binding");
  return { transactionHash: op.transactionHash!, blockNumberAtomic: uint(receipt.blockNumberAtomic).toString(), blockHash: hex32(receipt.blockHash), finality: op.finalityPolicy.source.blockTag, guid: hex32(event.guid), amountSentAtomic: event.amountSentLD.toString(), amountReceivedAtomic: event.amountReceivedLD.toString(),
    ...(packet === undefined ? {} : { packet: { srcEid: packet.srcEid, sender: packet.sender, nonceAtomic: packet.nonceAtomic,
      dstEid: packet.dstEid, receiver: packet.receiver } }) };
}
export function validateDestination(op: StargateTokenOperation, source: StargateTokenSourceReceipt, e: StargateTokenDestinationEvidence) {
  if (e.finality !== op.finalityPolicy.destination.blockTag || e.emitter !== STARGATE_TOKEN_DESTINATION_POOL || e.sourceTransactionHash !== source.transactionHash || e.sourceEid !== 30111 || e.guid !== source.guid || address(e.recipient) !== op.recipient || e.amountReceivedAtomic !== source.amountReceivedAtomic) fail("APN_RPC_PROTOCOL", "destination_event");
  if (BigInt(e.tokenBalanceAfterAtomic) - BigInt(e.tokenBalanceBeforeAtomic) !== BigInt(e.tokenDeltaAtomic)) fail("APN_RPC_PROTOCOL", "destination_token_delta");
  if (BigInt(e.nativeBalanceAfterAtomic) - BigInt(e.nativeBalanceBeforeAtomic) !== BigInt(e.nativeDeltaAtomic)) fail("APN_RPC_PROTOCOL", "destination_native_drop_delta");
  if (BigInt(op.nativeDropAtomic) === 0n) { if (e.nativeDrop !== undefined) fail("APN_RPC_PROTOCOL", "unexpected_native_drop_event"); }
  else if (e.nativeDrop?.executor !== STARGATE_TOKEN_DESTINATION_EXECUTOR || e.nativeDrop.success !== true || BigInt(e.nativeDrop.nonceAtomic) < 0n) {
    fail("APN_RPC_PROTOCOL", "destination_native_drop_event");
  }
  if (op.schemaVersion === "apn.stargate-v2-token-operation.v5" && (source.packet === undefined || e.packetDelivery === undefined ||
    e.packetDelivery.endpoint !== LAYERZERO_ENDPOINT_V2 || e.packetDelivery.tokenMessaging !== STARGATE_TOKEN_DESTINATION_MESSAGING ||
    e.packetDelivery.nonceAtomic !== source.packet.nonceAtomic)) fail("APN_RPC_PROTOCOL", "destination_packet_delivery");
  hex32(e.destinationTransactionHash); hex32(e.blockHash); uint(e.logIndexAtomic); uint(e.blockNumberAtomic);
}
export async function readExecutorCap(call: EvmRpcCall, tag: string) { if (quantity(await call("eth_chainId", [])) !== 10n) fail("APN_CHAIN_MISMATCH", "executor_chain");
  const code = await call("eth_getCode", [STARGATE_TOKEN_SOURCE_EXECUTOR, tag]); if (typeof code !== "string" || !CODE.test(code) || code === "0x") fail("APN_RPC_PROTOCOL", "executor_code");
  const data = encodeFunctionData({ abi: LAYERZERO_EXECUTOR_ABI, functionName: "dstConfig", args: [30109] });
  const decoded = decodeFunctionResult({ abi: LAYERZERO_EXECUTOR_ABI, functionName: "dstConfig", data: await call("eth_call", [{ to: STARGATE_TOKEN_SOURCE_EXECUTOR, data }, tag]) as Hex });
  if (decoded[3] <= 0n) fail("APN_RPC_PROTOCOL", "executor_native_cap"); return decoded[3]; }
export async function requoteSend(call: EvmRpcCall, sendParam: Parameters<typeof encodeFunctionData>[0] extends never ? never : any, tag: string) {
  const data = encodeFunctionData({ abi: STARGATE_QUOTE_ABI, functionName: "quoteSend", args: [sendParam, false] });
  const result = decodeFunctionResult({ abi: STARGATE_QUOTE_ABI, functionName: "quoteSend", data: await call("eth_call", [{ to: STARGATE_TOKEN_SOURCE_POOL, data }, tag]) as Hex });
  if (result.lzTokenFee !== 0n) fail("APN_RPC_PROTOCOL", "lz_token_fee"); return result.nativeFee;
}
export async function readPoolConfig(call: EvmRpcCall, chain: number, pool: Address, token: Address, eid: number, tag: string) {
  if (quantity(await call("eth_chainId", [])) !== BigInt(chain)) fail("APN_CHAIN_MISMATCH", "pool_chain");
  const [poolCode, tokenCode] = await Promise.all([call("eth_getCode", [pool, tag]), call("eth_getCode", [token, tag])]);
  if (typeof poolCode !== "string" || !CODE.test(poolCode) || poolCode === "0x" || typeof tokenCode !== "string" || !CODE.test(tokenCode) || tokenCode === "0x") fail("APN_RPC_PROTOCOL", "contract_code");
  const read = async (name: "token" | "localEid" | "sharedDecimals" | "status" | "stargateType") => decodeFunctionResult({ abi: STARGATE_SEND_ABI, functionName: name, data: await call("eth_call", [{ to: pool, data: encodeFunctionData({ abi: STARGATE_SEND_ABI, functionName: name }) }, tag]) as Hex });
  const [actualToken, actualEid, decimals, status, kind] = await Promise.all([read("token"), read("localEid"), read("sharedDecimals"), read("status"), read("stargateType")]);
  if (address(actualToken) !== token || actualEid !== eid || decimals !== 6 || status !== 1 || kind !== 0) fail("APN_RPC_PROTOCOL", "pool_config");
  return { poolCodeHash: keccak256(poolCode as Hex), tokenCodeHash: keccak256(tokenCode as Hex) };
}
export async function readAllowance(call: EvmRpcCall, owner: Address, tag: string) { return decodeFunctionResult({ abi: STARGATE_ERC20_ABI, functionName: "allowance",
  data: await call("eth_call", [{ to: STARGATE_TOKEN_SOURCE_TOKEN, data: encodeFunctionData({ abi: STARGATE_ERC20_ABI, functionName: "allowance", args: [owner, STARGATE_TOKEN_SOURCE_POOL] }) }, tag]) as Hex }); }
export async function readTokenBalance(call: EvmRpcCall, token: Address, owner: Address, tag: string) { return decodeFunctionResult({ abi: STARGATE_ERC20_ABI, functionName: "balanceOf",
  data: await call("eth_call", [{ to: token, data: encodeFunctionData({ abi: STARGATE_ERC20_ABI, functionName: "balanceOf", args: [owner] }) }, tag]) as Hex }); }
export function assertLane(q: StargateV2QuoteEvidence) { const r = q.route; if (r.sourceChainId !== 10 || r.destinationChainId !== 137 || r.sourceEid !== 30111 || r.destinationEid !== 30109 || r.sourcePool !== STARGATE_TOKEN_SOURCE_POOL || r.destinationPool !== STARGATE_TOKEN_DESTINATION_POOL || r.sourceToken !== STARGATE_TOKEN_SOURCE_TOKEN || r.destinationToken !== STARGATE_TOKEN_DESTINATION_TOKEN || r.asset !== "USDC") fail("APN_OPERATION_BLOCKED", "lane"); }
export async function verifySignedEnvelope(raw: Hex, owner: Address, e: StargateTokenEnvelope) { let tx: ReturnType<typeof parseTransaction>, signer: Address;
  try { tx = parseTransaction(raw); signer = getAddress(await recoverTransactionAddress({ serializedTransaction: raw as TransactionSerialized })); } catch { return fail("APN_RPC_PROTOCOL", "signed_transaction_decode"); }
  if (signer !== owner || tx.chainId !== 10 || tx.type !== "eip1559" || tx.to?.toLowerCase() !== e.to.toLowerCase() || (tx.data ?? "0x").toLowerCase() !== e.data.toLowerCase() || (tx.value ?? 0n) !== BigInt(e.valueAtomic) || tx.nonce !== Number(e.nonceAtomic) || tx.gas !== BigInt(e.gasLimitAtomic) || tx.maxFeePerGas !== BigInt(e.maxFeePerGasAtomic) || (tx.maxPriorityFeePerGas ?? 0n) !== BigInt(e.maxPriorityFeePerGasAtomic)) fail("APN_RPC_PROTOCOL", "signed_transaction_envelope"); }
