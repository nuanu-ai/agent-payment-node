import { getAddress } from "viem";
import { hashObject, isPlainRecord } from "../canonical.js";
import type { Address, Hex } from "../model.js";
import type { GaslessBlock, GaslessLog } from "./model.js";
import { gaslessFailure } from "./validation.js";

export type GaslessRpcMethod = "eth_chainId" | "eth_getBlockByNumber" | "eth_getBalance" | "eth_getCode" |
  "eth_getStorageAt" | "eth_getTransactionCount" | "eth_call" | "eth_maxPriorityFeePerGas" |
  "eth_getTransactionByHash" | "eth_getTransactionReceipt" | "eth_getLogs" |
  "eth_supportedEntryPoints" | "eth_estimateUserOperationGas" | "eth_sendUserOperation" |
  "eth_getUserOperationReceipt" | "eth_getUserOperationByHash";
export type GaslessRpcCall = (method: GaslessRpcMethod, params: readonly unknown[]) => Promise<unknown>;

export interface GaslessRawBlock {
  readonly block: GaslessBlock;
  readonly tag: Hex;
  readonly raw: Record<string, unknown>;
}

export function rpcRecord(value: unknown): Record<string, unknown> {
  if (!isPlainRecord(value)) gaslessFailure("APN_RPC_PROTOCOL", "gasless_RPC_record");
  return value;
}

export function rpcJson(value: string, maximumBytes: number): unknown {
  if (Buffer.byteLength(value, "utf8") > maximumBytes) gaslessFailure("APN_RPC_PROTOCOL", "gasless_RPC_response_size");
  try { return JSON.parse(value) as unknown; }
  catch { return gaslessFailure("APN_RPC_PROTOCOL", "gasless_RPC_JSON"); }
}

export function rpcQuantity(value: unknown): bigint {
  if (typeof value !== "string" || !/^0x(?:0|[1-9a-fA-F][0-9a-fA-F]{0,63})$/u.test(value)) {
    gaslessFailure("APN_RPC_PROTOCOL", "gasless_RPC_quantity");
  }
  return BigInt(value);
}

export function rpcHex(value: unknown, maximumBytes = 256 * 1024, bytes?: number): Hex {
  if (typeof value !== "string" || !/^0x(?:[0-9a-fA-F]{2})*$/u.test(value) ||
    value.length > 2 + maximumBytes * 2 || (bytes !== undefined && value.length !== 2 + bytes * 2)) {
    gaslessFailure("APN_RPC_PROTOCOL", "gasless_RPC_hex");
  }
  return value.toLowerCase() as Hex;
}

export function rpcWord(value: unknown): bigint { return BigInt(rpcHex(value, 32, 32)); }

export function rpcBool(value: unknown): boolean {
  const word = rpcWord(value);
  if (word !== 0n && word !== 1n) gaslessFailure("APN_RPC_PROTOCOL", "gasless_RPC_boolean");
  return word === 1n;
}

export function rpcAddress(value: unknown): Address {
  try { return getAddress(rpcHex(value, 20, 20)); }
  catch { return gaslessFailure("APN_RPC_PROTOCOL", "gasless_RPC_address"); }
}

export function quantity(value: bigint): Hex {
  if (value < 0n || value >= 1n << 256n) gaslessFailure("APN_RPC_PROTOCOL", "gasless_RPC_quantity_bound");
  return `0x${value.toString(16)}`;
}

export function addressWord(value: Address): Hex { return `0x${value.slice(2).toLowerCase().padStart(64, "0")}`; }

export async function rpcBlock(call: GaslessRpcCall, tag: "latest" | "safe" | Hex): Promise<GaslessRawBlock> {
  const raw = rpcRecord(await call("eth_getBlockByNumber", [tag, false]));
  const number = rpcQuantity(raw.number), hash = rpcHex(raw.hash, 32, 32);
  if (hash === `0x${"0".repeat(64)}` || (tag.startsWith("0x") && number !== rpcQuantity(tag))) {
    gaslessFailure("APN_RPC_PROTOCOL", "gasless_block_identity");
  }
  const block = { numberAtomic: number.toString(), hash, timestampAtomic: rpcQuantity(raw.timestamp).toString() };
  return { block, tag: quantity(number), raw };
}

export async function recheckBlock(call: GaslessRpcCall, block: GaslessBlock): Promise<void> {
  const again = await rpcBlock(call, quantity(BigInt(block.numberAtomic)));
  if (!sameBlock(again.block, block)) gaslessFailure("APN_RPC_PROTOCOL", "gasless_block_reorg");
}

export function sameBlock(left: GaslessBlock, right: GaslessBlock): boolean {
  return left.numberAtomic === right.numberAtomic && left.hash === right.hash && left.timestampAtomic === right.timestampAtomic;
}

export function parseReceiptLogs(value: unknown, transactionHash: Hex, block: GaslessBlock,
  transactionIndex: bigint): readonly GaslessLog[] {
  if (!Array.isArray(value) || value.length > 512) gaslessFailure("APN_RPC_PROTOCOL", "gasless_receipt_log_count");
  const indexes = new Set<string>();
  return value.map((item) => {
    const log = rpcRecord(item), logIndex = rpcQuantity(log.logIndex).toString();
    if (indexes.has(logIndex) || rpcHex(log.transactionHash, 32, 32) !== transactionHash ||
      rpcHex(log.blockHash, 32, 32) !== block.hash || rpcQuantity(log.blockNumber).toString() !== block.numberAtomic ||
      rpcQuantity(log.transactionIndex) !== transactionIndex || log.removed !== false ||
      !Array.isArray(log.topics) || log.topics.length > 4) {
      gaslessFailure("APN_RPC_PROTOCOL", "gasless_receipt_log_membership");
    }
    indexes.add(logIndex);
    return { address: rpcAddress(log.address), topics: log.topics.map((topic) => rpcHex(topic, 32, 32)),
      data: rpcHex(log.data, 64 * 1024), logIndexAtomic: logIndex };
  });
}

export function receiptHash(chainId: number, transactionHash: Hex, block: GaslessBlock,
  status: bigint, logs: readonly GaslessLog[]): string {
  return hashObject({ chainId, transactionHash, block, status: status.toString(), logs });
}
