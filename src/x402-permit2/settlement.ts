import { isPlainRecord } from "../canonical.js";
import { ApnError } from "../errors.js";
import type { Address, Hex } from "../model.js";
import {
  ERC20_TRANSFER_TOPIC,
  PERMIT2_ADDRESS,
  PROXY_SETTLED_TOPIC,
  PROXY_SETTLED_WITH_PERMIT_TOPIC,
  X402_EXACT_PERMIT2_PROXY,
  type Permit2ListAsset,
} from "./registry.js";

const HASH = /^0x[0-9a-f]{64}$/u;
const QUANTITY = /^0x(0|[1-9a-f][0-9a-f]{0,63})$/u;
/** Permit2 `nonceBitmap(address,uint256)`. */
const NONCE_BITMAP_SELECTOR = "0x4fe02b44";

export interface Permit2SettlementExpectation {
  readonly listAsset: Permit2ListAsset;
  readonly payer: Address;
  readonly payTo: Address;
  readonly amountAtomic: string;
  /** From the seller's PAYMENT-RESPONSE; a seller claim only until this receipt proves it. */
  readonly transactionHash: Hex;
  /** Whether the signed payload carried the EIP-2612 permit, which selects the proxy's settleWithPermit path. */
  readonly withPermit: boolean;
}

export interface Permit2SettlementProof {
  readonly transactionHash: Hex;
  readonly blockHash: Hex;
  readonly blockNumber: string;
  readonly transferLogIndex: string;
  readonly settledEvent: "Settled" | "SettledWithPermit";
}

/**
 * Independent settlement proof from a successful receipt on the admitted chain: exactly one pinned-token Transfer
 * from the payer to the payee for the exact amount, and exactly one matching proxy settlement event. HTTP success
 * or a facilitator claim alone never completes the payment.
 */
export function verifyPermit2SettlementReceipt(receipt: unknown, expected: Permit2SettlementExpectation): Permit2SettlementProof {
  if (!isPlainRecord(receipt) || !Array.isArray(receipt.logs)) fail("The settlement receipt is malformed.");
  const transactionHash = lowerHash(receipt.transactionHash), blockHash = lowerHash(receipt.blockHash);
  if (transactionHash !== expected.transactionHash.toLowerCase()) fail("The receipt is not the claimed settlement transaction.");
  if (receipt.status !== "0x1") fail("The settlement transaction did not succeed.");
  if (typeof receipt.blockNumber !== "string" || !QUANTITY.test(receipt.blockNumber)) fail("The settlement block number is malformed.");
  const token = expected.listAsset.token.toLowerCase(), proxy = X402_EXACT_PERMIT2_PROXY.toLowerCase();
  const transfers: { readonly topics: readonly unknown[]; readonly data: string; readonly logIndex: unknown }[] = [];
  const settled: string[] = [];
  for (const log of receipt.logs) {
    if (!isPlainRecord(log) || !Array.isArray(log.topics) || typeof log.address !== "string" || typeof log.data !== "string") {
      fail("A settlement receipt log is malformed.");
    }
    if (log.removed === true) fail("The settlement receipt contains a removed log.");
    if (log.transactionHash !== undefined && lowerHash(log.transactionHash) !== transactionHash) fail("A receipt log names another transaction.");
    const address = log.address.toLowerCase(), topic0 = typeof log.topics[0] === "string" ? log.topics[0].toLowerCase() : "";
    if (address === token && topic0 === ERC20_TRANSFER_TOPIC) transfers.push({ topics: log.topics, data: log.data, logIndex: log.logIndex });
    if (address === proxy && (topic0 === PROXY_SETTLED_TOPIC || topic0 === PROXY_SETTLED_WITH_PERMIT_TOPIC)) settled.push(topic0);
  }
  const matching = transfers.filter((log) => log.topics.length === 3 && topicAddress(log.topics[1]) === expected.payer.toLowerCase() &&
    topicAddress(log.topics[2]) === expected.payTo.toLowerCase() && word(log.data) === BigInt(expected.amountAtomic));
  if (matching.length !== 1 || transfers.length !== 1) fail("The receipt does not carry exactly the frozen token transfer.");
  const wanted = expected.withPermit ? PROXY_SETTLED_WITH_PERMIT_TOPIC : PROXY_SETTLED_TOPIC;
  if (settled.length !== 1 || settled[0] !== wanted) fail("The receipt does not carry exactly one matching proxy settlement.");
  const logIndex = matching[0]!.logIndex;
  if (typeof logIndex !== "string" || !QUANTITY.test(logIndex)) fail("The transfer log index is malformed.");
  return { transactionHash: transactionHash as Hex, blockHash: blockHash as Hex, blockNumber: BigInt(receipt.blockNumber).toString(),
    transferLogIndex: BigInt(logIndex).toString(), settledEvent: expected.withPermit ? "SettledWithPermit" : "Settled" };
}

/** eth_call parameters that read the Permit2 unordered-nonce word for recovery; read-only. */
export function permit2NonceBitmapCall(owner: Address, nonce: string): { readonly to: Address; readonly data: Hex } {
  const value = uint(nonce);
  if (!/^0x[0-9a-fA-F]{40}$/u.test(owner)) throw new ApnError("APN_INVALID_INPUT", "The Permit2 owner is invalid.");
  return { to: PERMIT2_ADDRESS, data: `${NONCE_BITMAP_SELECTOR}${owner.slice(2).toLowerCase().padStart(64, "0")}${(value >> 8n).toString(16).padStart(64, "0")}` as Hex };
}

/** True when the frozen nonce is spent. A spent nonce without a matching receipt is ambiguous, never success. */
export function permit2NonceConsumed(bitmapWord: unknown, nonce: string): boolean {
  if (typeof bitmapWord !== "string" || !/^0x[0-9a-fA-F]{64}$/u.test(bitmapWord)) {
    throw new ApnError("APN_RPC_PROTOCOL", "The Permit2 nonce bitmap response is malformed.");
  }
  return ((BigInt(bitmapWord) >> (uint(nonce) & 0xffn)) & 1n) === 1n;
}

function uint(value: string): bigint {
  if (typeof value !== "string" || !/^(0|[1-9][0-9]{0,77})$/u.test(value) || BigInt(value) >= 1n << 256n) {
    throw new ApnError("APN_INVALID_INPUT", "The Permit2 nonce is invalid.");
  }
  return BigInt(value);
}
function lowerHash(value: unknown): string {
  if (typeof value !== "string" || !HASH.test(value.toLowerCase()) || /^0x0{64}$/u.test(value)) fail("A settlement hash is malformed.");
  return value.toLowerCase();
}
function topicAddress(value: unknown): string {
  if (typeof value !== "string" || !/^0x0{24}[0-9a-fA-F]{40}$/u.test(value)) return "";
  return `0x${value.slice(26).toLowerCase()}`;
}
function word(value: string): bigint {
  return /^0x[0-9a-fA-F]{64}$/u.test(value) ? BigInt(value) : -1n;
}
function fail(message: string): never { throw new ApnError("APN_X402_SETTLEMENT_INVALID", message); }
