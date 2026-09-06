import { decodeAbiParameters } from "viem";
import { ApnError } from "./errors.js";
import type { Address, Hex } from "./model.js";
import type { X402RpcLog } from "./ports.js";
const MAX_X402_TOPICS = 4;
const MAX_X402_LOG_DATA_BYTES = 4096;

export function record(value: unknown, label: string): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) throw new ApnError("APN_RPC_PROTOCOL", `RPC ${label} is invalid.`);
  return value as Record<string, unknown>;
}
export function rpcQuantity(value: unknown): bigint {
  if (typeof value !== "string" || !/^0x(?:0|[1-9a-fA-F][0-9a-fA-F]*)$/.test(value)) throw new ApnError("APN_RPC_PROTOCOL", "RPC quantity is not canonical hexadecimal.");
  return BigInt(value);
}
export function rpcHex(value: unknown, byteLength?: number): Hex {
  if (typeof value !== "string" || !/^0x(?:[0-9a-fA-F]{2})*$/.test(value)) throw new ApnError("APN_RPC_PROTOCOL", "RPC hex data is invalid.");
  if (byteLength !== undefined && value.length !== 2 + byteLength * 2) throw new ApnError("APN_RPC_PROTOCOL", "RPC hex data has the wrong length.");
  return value.toLowerCase() as Hex;
}
export function rpcAddress(value: unknown): Address {
  if (typeof value !== "string" || !/^0x[0-9a-fA-F]{40}$/.test(value)) throw new ApnError("APN_RPC_PROTOCOL", "RPC address is invalid.");
  return value as Address;
}

export function nonzeroBytes32(value: unknown, label: string): Hex {
  const parsed = rpcHex(value, 32);
  if (/^0x0{64}$/u.test(parsed)) throw new ApnError("APN_RPC_PROTOCOL", `RPC ${label} is zero.`);
  return parsed;
}

export function x402RpcLog(value: unknown): X402RpcLog {
  const log = record(value, "x402 log");
  if (!Array.isArray(log.topics) || log.topics.length > MAX_X402_TOPICS) {
    throw new ApnError("APN_RPC_PROTOCOL", "RPC log topics exceed the fixed bound.");
  }
  const data = rpcHex(log.data);
  if ((data.length - 2) / 2 > MAX_X402_LOG_DATA_BYTES) {
    throw new ApnError("APN_RPC_PROTOCOL", "RPC log data exceeds the fixed bound.");
  }
  return {
    address: rpcAddress(log.address).toLowerCase() as Address,
    topics: log.topics.map((topic: unknown) => rpcHex(topic, 32)),
    data,
    blockNumber: rpcQuantity(log.blockNumber).toString(),
    blockHash: nonzeroBytes32(log.blockHash, "log block hash"),
    transactionHash: nonzeroBytes32(log.transactionHash, "log transaction hash"),
    logIndex: rpcQuantity(log.logIndex).toString(),
  };
}
export function rpcString(value: unknown, label: string): string {
  const encoded = rpcHex(value);
  try {
    const [decoded] = decodeAbiParameters([{ type: "string" }], encoded);
    if (decoded.length === 0 || Buffer.byteLength(decoded, "utf8") > 128) throw new Error("bounded string");
    return decoded;
  } catch {
    throw new ApnError("APN_RPC_PROTOCOL", `RPC ${label} is invalid.`);
  }
}
export function rpcUint256Data(value: unknown, label: string): string {
  try { return BigInt(rpcHex(value, 32)).toString(); }
  catch { throw new ApnError("APN_RPC_PROTOCOL", `RPC ${label} is invalid.`); }
}
