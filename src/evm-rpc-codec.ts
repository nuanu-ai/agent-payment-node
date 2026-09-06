import { getAddress } from "viem";
import { isPlainRecord } from "./canonical.js";
import { ApnError } from "./errors.js";
import { MAX_EVM_UINT } from "./evm-asset.js";
import type { Address, Hex } from "./model.js";
import type { EvmRpcCall } from "./evm-ports.js";

export function evmRpcRecord(value: unknown): Record<string, unknown> {
  if (!isPlainRecord(value)) throw new ApnError("APN_RPC_PROTOCOL", "EVM RPC returned a malformed object.");
  return value;
}

export function evmRpcQuantity(value: unknown): bigint {
  if (typeof value !== "string" || !/^0x(?:0|[1-9a-fA-F][0-9a-fA-F]{0,63})$/u.test(value)) {
    throw new ApnError("APN_RPC_PROTOCOL", "EVM RPC returned a noncanonical quantity.");
  }
  const result = BigInt(value);
  if (result > MAX_EVM_UINT) throw new ApnError("APN_RPC_PROTOCOL", "EVM RPC quantity exceeds uint256.");
  return result;
}

export function evmRpcHex(value: unknown, bytes?: number): Hex {
  if (typeof value !== "string" || !/^0x(?:[0-9a-fA-F]{2})*$/u.test(value) || (bytes !== undefined && value.length !== 2 + 2 * bytes)) {
    throw new ApnError("APN_RPC_PROTOCOL", "EVM RPC returned malformed bytes.");
  }
  return value.toLowerCase() as Hex;
}

export function evmRpcWord(value: unknown): bigint {
  return BigInt(evmRpcHex(value, 32));
}

export function evmRpcAddress(value: unknown): Address {
  try { return getAddress(evmRpcHex(value, 20)); } catch { throw new ApnError("APN_RPC_PROTOCOL", "EVM RPC returned an invalid address."); }
}

export async function evmRpcBlock(call: EvmRpcCall, tag: string): Promise<{ readonly tag: Hex; readonly number: string; readonly hash: Hex; readonly raw: Record<string, unknown> }> {
  const raw = evmRpcRecord(await call("eth_getBlockByNumber", [tag, false]));
  const number = evmRpcQuantity(raw.number);
  const hash = evmRpcHex(raw.hash, 32);
  if (hash === `0x${"0".repeat(64)}` || (tag.startsWith("0x") && number !== evmRpcQuantity(tag))) {
    throw new ApnError("APN_RPC_PROTOCOL", "EVM RPC block identity is inconsistent.");
  }
  return { tag: `0x${number.toString(16)}`, number: number.toString(), hash, raw };
}

export async function recheckEvmBlock(call: EvmRpcCall, block: { readonly tag: Hex; readonly hash: Hex }): Promise<void> {
  if ((await evmRpcBlock(call, block.tag)).hash !== block.hash) throw new ApnError("APN_RPC_PROTOCOL", "EVM block changed around pinned reads.");
}

export async function evmTokenBalance(call: EvmRpcCall, token: Address, address: Address, tag: Hex): Promise<bigint> {
  const data = `0x70a08231${address.slice(2).toLowerCase().padStart(64, "0")}`;
  return evmRpcWord(await call("eth_call", [{ to: token, data }, tag]));
}
