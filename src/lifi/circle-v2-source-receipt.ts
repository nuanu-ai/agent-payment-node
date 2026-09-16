/** Pure CCTP V2 Base source observation. The caller authenticates the safe transaction and receipt. */
import { decodeEventLog, encodeAbiParameters, getAddress, keccak256, parseAbi, toEventSelector } from "viem";
import type { Address, Hex } from "../model.js";
import { bridgeAddress, bridgeFailure, bridgeHex, bridgeRecord, bridgeUint, BRIDGE_ZERO_WORD } from "./validation.js";
import { BASE_SOLANA_USDC_CANDIDATE } from "./discovery-candidates.js";

// Circle mainnet deployments: https://developers.circle.com/cctp/references/contract-addresses
export const BASE_CCTP_V2_TOKEN_MESSENGER_WITH_FEES = getAddress("0x71f54F818671cD0D7ea140Da213e5C8b5C92a408");
export const BASE_CCTP_V2_TOKEN_MESSENGER = getAddress("0x28b5a0e9C621a5BadaA536219b3a228C8168cf5d");
export const BASE_CCTP_V2_MESSAGE_TRANSMITTER = getAddress("0x81D40F21F12A8F0E3252Bccb954D722d4c464B64");
// https://developers.circle.com/cctp/references/solana-programs
export const SOLANA_CCTP_V2_TOKEN_MESSENGER_MINTER = "CCTPV2vPZJS2u2BBsUoscuikbYjnpFmbFsvVuJdgUMQe";
const SOLANA_TOKEN_MESSENGER_BYTES32 = "0xa65fc81d0fefa8860cb3b83f089b0224be8a6687b7ae49f594c0b9b4d7e93893" as Hex;
const ZERO = BRIDGE_ZERO_WORD;
const BURN_ABI = parseAbi(["event DepositForBurn(address indexed burnToken,uint256 amount,address indexed depositor,bytes32 mintRecipient,uint32 destinationDomain,bytes32 destinationTokenMessenger,bytes32 destinationCaller,uint256 maxFee,uint32 indexed minFinalityThreshold,bytes hookData)"]);
const MESSAGE_ABI = parseAbi(["event MessageSent(bytes message)"]);
const BURN_TOPIC = toEventSelector(BURN_ABI[0]);
const MESSAGE_TOPIC = toEventSelector(MESSAGE_ABI[0]);
const BASE_USDC = getAddress(BASE_SOLANA_USDC_CANDIDATE.fromToken);

export interface CircleV2BurnIntent {
  readonly sourceTransactionHash: Hex;
  readonly sourceFrom: Address;
  readonly amountAtomic: string;
  /** Existing Solana USDC ATA, encoded as its raw 32-byte public key. */
  readonly solanaAtaBytes32: Hex;
  /** CCTP burn maxFee, excluding any separate wrapper FORWARD fee; zero is valid for Standard. */
  readonly maxFeeAtomic: string;
  readonly minFinalityThreshold: number;
  readonly hookData: Hex;
}
/** This live path admits only a FORWARD quote. The wrapper then selects Standard CCTP with zero burn maxFee. */
export function circleV2BurnTermsFromQuote(responseValue: unknown): { maxFeeAtomic: string; minFinalityThreshold: 1000 | 2000 } {
  const response = bridgeRecord(responseValue, "APN_PROVIDER_PROTOCOL");
  if (!Array.isArray(response.items) || response.items.length !== 1) fail("quote_items");
  const forward = bridgeRecord(response.items[0], "APN_PROVIDER_PROTOCOL");
  if (forward.type !== "FORWARD") fail("quote_items");
  const forwardFee = bridgeUint(forward.amount, false, "APN_PROVIDER_PROTOCOL");
  if (forwardFee !== bridgeUint(response.feeTotalAmount, false, "APN_PROVIDER_PROTOCOL")) fail("quote_fee_sum");
  return { maxFeeAtomic: "0", minFinalityThreshold: 2000 };
}
export interface CircleV2SourceProof {
  readonly kind: "offline_circle_cctp_v2_base_source_receipt";
  readonly sourceTransactionHash: Hex;
  readonly blockHash: Hex;
  readonly blockNumberAtomic: string;
  readonly sourceDomain: 6;
  readonly destinationDomain: 5;
  readonly burnToken: Address;
  readonly burnAmountAtomic: string;
  readonly depositor: Address;
  readonly mintRecipient: Hex;
  readonly destinationTokenMessenger: Hex;
  readonly destinationCaller: Hex;
  readonly maxFeeAtomic: string;
  readonly minFinalityThreshold: number;
  readonly hookData: Hex;
  readonly message: Hex;
  readonly messageHash: Hex;
  readonly executionAdmitted: false;
  readonly bridgeCompletion: false;
}
function fail(reason: string): never { return bridgeFailure("APN_RPC_PROTOCOL", `circle_v2_source_${reason}`); }
function part(value: Hex, offset: number, length: number): Hex { return `0x${value.slice(2 + offset * 2, 2 + (offset + length) * 2)}` as Hex; }
function int(value: Hex): bigint { return BigInt(value); }
function word(address: Address): Hex { return `0x${"0".repeat(24)}${address.slice(2).toLowerCase()}` as Hex; }
function logValue(value: unknown) {
  const log = bridgeRecord(value, "APN_RPC_PROTOCOL");
  if (!Array.isArray(log.topics) || log.topics.length > 4) fail("log_topics");
  return { address: bridgeAddress(log.address, "APN_RPC_PROTOCOL"), topics: log.topics.map(t => bridgeHex(t, 32, 32, "APN_RPC_PROTOCOL")),
    data: bridgeHex(log.data, 12 * 1024, undefined, "APN_RPC_PROTOCOL") };
}
/** No RPC, network, signer, provider, or execution dependency. A successful safe receipt is caller-authenticated input. */
export function decodeCircleV2BaseSourceReceiptOffline(intent: CircleV2BurnIntent, transactionValue: unknown, receiptValue: unknown): CircleV2SourceProof {
  const tx = bridgeRecord(transactionValue, "APN_RPC_PROTOCOL"), receipt = bridgeRecord(receiptValue, "APN_RPC_PROTOCOL");
  const hash = bridgeHex(intent.sourceTransactionHash, 32, 32, "APN_RPC_PROTOCOL");
  const from = bridgeAddress(intent.sourceFrom, "APN_RPC_PROTOCOL");
  const ata = bridgeHex(intent.solanaAtaBytes32, 32, 32, "APN_RPC_PROTOCOL");
  const amount = bridgeUint(intent.amountAtomic, false, "APN_RPC_PROTOCOL");
  const maxFee = bridgeUint(intent.maxFeeAtomic, false, "APN_RPC_PROTOCOL");
  const hook = bridgeHex(intent.hookData, 12 * 1024, undefined, "APN_RPC_PROTOCOL");
  if (hash === ZERO || ata === ZERO || amount === 0n || maxFee >= amount ||
    !Number.isInteger(intent.minFinalityThreshold) || intent.minFinalityThreshold < 0 || intent.minFinalityThreshold > 0xffffffff) fail("intent");
  if (tx.chainId !== 8453 || receipt.chainId !== 8453 || bridgeHex(tx.hash, 32, 32, "APN_RPC_PROTOCOL") !== hash ||
    bridgeHex(receipt.transactionHash, 32, 32, "APN_RPC_PROTOCOL") !== hash || receipt.status !== "0x1" ||
    bridgeAddress(tx.from, "APN_RPC_PROTOCOL") !== from ||
    bridgeAddress(tx.to, "APN_RPC_PROTOCOL") !== BASE_CCTP_V2_TOKEN_MESSENGER_WITH_FEES) fail("transaction_binding");
  const blockHash = bridgeHex(receipt.blockHash, 32, 32, "APN_RPC_PROTOCOL");
  const blockNumberAtomic = bridgeUint(receipt.blockNumberAtomic, true, "APN_RPC_PROTOCOL").toString();
  if (blockHash === ZERO || !Array.isArray(receipt.logs) || receipt.logs.length > 512) fail("receipt_shape");
  const logs = receipt.logs.map(logValue);
  const burns = logs.filter(log => log.address === BASE_CCTP_V2_TOKEN_MESSENGER && log.topics[0] === BURN_TOPIC);
  const messages = logs.filter(log => log.address === BASE_CCTP_V2_MESSAGE_TRANSMITTER && log.topics[0] === MESSAGE_TOPIC);
  if (burns.length !== 1 || messages.length !== 1) fail("event_count");
  if (logs.indexOf(messages[0]!) >= logs.indexOf(burns[0]!)) fail("event_order");
  const burn = burns[0]!, sent = messages[0]!;
  if (burn.topics.length !== 4 || sent.topics.length !== 1) fail("event_topics");
  let b: ReturnType<typeof decodeEventLog<typeof BURN_ABI, "DepositForBurn">>["args"], message: Hex;
  try {
    b = decodeEventLog({ abi: BURN_ABI, eventName: "DepositForBurn", data: burn.data, topics: burn.topics as [Hex, ...Hex[]], strict: true }).args;
    message = decodeEventLog({ abi: MESSAGE_ABI, eventName: "MessageSent", data: sent.data, topics: sent.topics as [Hex, ...Hex[]], strict: true }).args.message;
  } catch { return fail("event_decode"); }
  if (encodeAbiParameters(BURN_ABI[0].inputs.filter(i => !("indexed" in i)), [b.amount, b.mintRecipient, b.destinationDomain, b.destinationTokenMessenger, b.destinationCaller, b.maxFee, b.hookData]).toLowerCase() !== burn.data.toLowerCase() ||
    encodeAbiParameters([{ type: "bytes" }], [message]).toLowerCase() !== sent.data.toLowerCase()) fail("noncanonical_event");
  if (b.burnToken !== BASE_USDC || b.depositor !== BASE_CCTP_V2_TOKEN_MESSENGER_WITH_FEES || b.amount !== amount || b.mintRecipient.toLowerCase() !== ata ||
    b.destinationDomain !== 5 || b.destinationTokenMessenger.toLowerCase() !== SOLANA_TOKEN_MESSENGER_BYTES32 ||
    b.destinationCaller !== ZERO || b.maxFee !== maxFee || b.minFinalityThreshold !== intent.minFinalityThreshold ||
    b.hookData.toLowerCase() !== hook) fail("burn_intent_binding");
  message = bridgeHex(message, 12 * 1024, 376 + (hook.length - 2) / 2, "APN_RPC_PROTOCOL");
  if (int(part(message, 0, 4)) !== 1n || int(part(message, 4, 4)) !== 6n || int(part(message, 8, 4)) !== 5n ||
    part(message, 12, 32) !== ZERO || part(message, 44, 32) !== word(BASE_CCTP_V2_TOKEN_MESSENGER) ||
    part(message, 76, 32) !== SOLANA_TOKEN_MESSENGER_BYTES32 || part(message, 108, 32) !== ZERO ||
    int(part(message, 140, 4)) !== BigInt(intent.minFinalityThreshold) || int(part(message, 144, 4)) !== 0n ||
    int(part(message, 148, 4)) !== 1n || part(message, 152, 32) !== word(BASE_USDC) ||
    part(message, 184, 32).toLowerCase() !== ata || int(part(message, 216, 32)) !== amount ||
    part(message, 248, 32) !== word(BASE_CCTP_V2_TOKEN_MESSENGER_WITH_FEES) || int(part(message, 280, 32)) !== maxFee ||
    int(part(message, 312, 32)) !== 0n || int(part(message, 344, 32)) !== 0n ||
    part(message, 376, (message.length - 2) / 2 - 376).toLowerCase() !== hook) fail("message_burn_binding");
  return { kind: "offline_circle_cctp_v2_base_source_receipt", sourceTransactionHash: hash, blockHash, blockNumberAtomic,
    sourceDomain: 6, destinationDomain: 5, burnToken: BASE_USDC, burnAmountAtomic: amount.toString(), depositor: BASE_CCTP_V2_TOKEN_MESSENGER_WITH_FEES,
    mintRecipient: ata, destinationTokenMessenger: SOLANA_TOKEN_MESSENGER_BYTES32, destinationCaller: ZERO,
    maxFeeAtomic: maxFee.toString(), minFinalityThreshold: intent.minFinalityThreshold, hookData: hook,
    message, messageHash: keccak256(message), executionAdmitted: false, bridgeCompletion: false };
}
