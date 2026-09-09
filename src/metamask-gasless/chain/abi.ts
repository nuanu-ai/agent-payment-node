import { getAddress, toEventSelector, toFunctionSelector } from "viem";
import { hashObject, isPlainRecord } from "../../canonical.js";
import type { Address, Hex } from "../../model.js";
import type { MetaMaskGaslessBlock } from "../model.js";
import { mmFail, type MetaMaskGaslessFailureReason } from "../reasons.js";

export type MmRpcMethod = "eth_chainId" | "eth_getBlockByNumber" | "eth_getCode" |
  "eth_getStorageAt" | "eth_call" | "eth_getTransactionByHash" |
  "eth_getTransactionReceipt" | "eth_getLogs";
export type MmRpcCall = (method: MmRpcMethod, params: readonly unknown[]) => Promise<unknown>;

export interface MmRawBlock {
  readonly block: MetaMaskGaslessBlock;
  readonly raw: Record<string, unknown>;
  readonly tag: Hex;
}
export interface MmReceiptLog {
  readonly address: Address;
  readonly topics: readonly Hex[];
  readonly data: Hex;
  readonly logIndexAtomic: string;
}

export const MM_ZERO_HEX_HASH = `0x${"0".repeat(64)}` as Hex;
export const MM_TRANSFER_TOPIC = toEventSelector("Transfer(address,address,uint256)");
export const MM_APPROVAL_TOPIC = toEventSelector("Approval(address,address,uint256)");
export const MM_INCREASED_COUNT_TOPIC =
  toEventSelector("IncreasedCount(address,address,bytes32,uint256,uint256)");
export const MM_REDEEM_SELECTOR = toFunctionSelector("redeemDelegations(bytes[],bytes32[],bytes[])");
export const MM_DECIMALS_CALL = toFunctionSelector("decimals()");

export const MM_EXECUTION_PARAMETER = {
  type: "tuple[]",
  components: [
    { name: "target", type: "address" },
    { name: "value", type: "uint256" },
    { name: "callData", type: "bytes" },
  ],
} as const;

export const MM_DELEGATION_PARAMETER = {
  type: "tuple[]",
  components: [
    { name: "delegate", type: "address" },
    { name: "delegator", type: "address" },
    { name: "authority", type: "bytes32" },
    {
      name: "caveats", type: "tuple[]", components: [
        { name: "enforcer", type: "address" },
        { name: "terms", type: "bytes" },
        { name: "args", type: "bytes" },
      ],
    },
    { name: "salt", type: "uint256" },
    { name: "signature", type: "bytes" },
  ],
} as const;

export function rpcRecord(value: unknown,
  reason: MetaMaskGaslessFailureReason = "mm_gasless_evidence_invalid"): Record<string, unknown> {
  if (!isPlainRecord(value)) mmFail(reason);
  return value;
}

export function rpcQuantity(value: unknown,
  reason: MetaMaskGaslessFailureReason = "mm_gasless_evidence_invalid"): bigint {
  if (typeof value !== "string" || !/^0x(?:0|[1-9a-fA-F][0-9a-fA-F]{0,63})$/u.test(value)) mmFail(reason);
  return BigInt(value);
}

export function rpcHex(value: unknown, maximumBytes = 256 * 1024, bytes?: number,
  reason: MetaMaskGaslessFailureReason = "mm_gasless_evidence_invalid"): Hex {
  if (typeof value !== "string" || !/^0x(?:[0-9a-fA-F]{2})*$/u.test(value) ||
    value.length > 2 + maximumBytes * 2 || (bytes !== undefined && value.length !== 2 + bytes * 2)) mmFail(reason);
  return value.toLowerCase() as Hex;
}

export function rpcAddress(value: unknown,
  reason: MetaMaskGaslessFailureReason = "mm_gasless_evidence_invalid"): Address {
  try { return getAddress(rpcHex(value, 20, 20, reason)).toLowerCase() as Address; }
  catch { return mmFail(reason); }
}

export function rpcWord(value: unknown,
  reason: MetaMaskGaslessFailureReason = "mm_gasless_evidence_invalid"): bigint {
  return BigInt(rpcHex(value, 32, 32, reason));
}

export function quantity(value: bigint): Hex {
  if (value < 0n || value >= 1n << 256n) mmFail("mm_gasless_evidence_invalid");
  return `0x${value.toString(16)}`;
}

export function addressWord(value: Address): Hex {
  return `0x${value.slice(2).toLowerCase().padStart(64, "0")}`;
}

export function callData(signature: string, words: readonly Hex[] = []): Hex {
  return `${toFunctionSelector(signature)}${words.map((word) => word.slice(2)).join("")}` as Hex;
}

export async function rpcBlock(call: MmRpcCall, tag: "latest" | "safe" | "finalized" | Hex,
  fullTransactions = false): Promise<MmRawBlock> {
  const raw = rpcRecord(await call("eth_getBlockByNumber", [tag, fullTransactions]));
  const number = rpcQuantity(raw.number), hash = rpcHex(raw.hash, 32, 32);
  if (hash === MM_ZERO_HEX_HASH || (tag.startsWith("0x") && number !== rpcQuantity(tag))) {
    mmFail("mm_gasless_evidence_invalid");
  }
  return { block: { numberAtomic: number.toString(), hash, timestampAtomic: rpcQuantity(raw.timestamp).toString() },
    raw, tag: quantity(number) };
}

export async function recheckBlock(call: MmRpcCall, block: MetaMaskGaslessBlock,
  reason: MetaMaskGaslessFailureReason = "mm_gasless_scan_reorg"): Promise<void> {
  const current = await rpcBlock(call, quantity(BigInt(block.numberAtomic)));
  if (!sameBlock(current.block, block)) mmFail(reason);
}

export function sameBlock(left: MetaMaskGaslessBlock, right: MetaMaskGaslessBlock): boolean {
  return left.numberAtomic === right.numberAtomic && left.hash === right.hash &&
    left.timestampAtomic === right.timestampAtomic;
}

export function parseReceiptLogs(value: unknown, transactionHash: Hex, block: MetaMaskGaslessBlock,
  transactionIndex: bigint): readonly MmReceiptLog[] {
  if (!Array.isArray(value) || value.length > 512) mmFail("mm_gasless_evidence_invalid");
  const indexes = new Set<string>();
  let prior = -1n;
  return value.map((item) => {
    const log = rpcRecord(item), index = rpcQuantity(log.logIndex), indexAtomic = index.toString();
    if (indexes.has(indexAtomic) || index <= prior || rpcHex(log.transactionHash, 32, 32) !== transactionHash ||
      rpcHex(log.blockHash, 32, 32) !== block.hash || rpcQuantity(log.blockNumber).toString() !== block.numberAtomic ||
      rpcQuantity(log.transactionIndex) !== transactionIndex || log.removed !== false ||
      !Array.isArray(log.topics) || log.topics.length > 4) mmFail("mm_gasless_evidence_invalid");
    indexes.add(indexAtomic); prior = index;
    return { address: rpcAddress(log.address), topics: log.topics.map((topic) => rpcHex(topic, 32, 32)),
      data: rpcHex(log.data, 64 * 1024), logIndexAtomic: indexAtomic };
  });
}

export function topicAddress(value: Hex): Address {
  if (!/^0x0{24}[0-9a-f]{40}$/u.test(value)) mmFail("mm_gasless_evidence_invalid");
  return rpcAddress(`0x${value.slice(-40)}`);
}

export function twoWords(value: Hex): readonly [bigint, bigint] {
  if (value.length !== 2 + 64 * 2) mmFail("mm_gasless_evidence_invalid");
  return [BigInt(`0x${value.slice(2, 66)}`), BigInt(`0x${value.slice(66, 130)}`)];
}

export function receiptHash(chainId: number, transactionHash: Hex, block: MetaMaskGaslessBlock,
  status: bigint, logs: readonly MmReceiptLog[]): string {
  return hashObject({ chainId, transactionHash, block, status: status.toString(), logs });
}
