import { getAddress, zeroAddress, type Hex } from "viem";
import { ApnError } from "../errors.js";
import type { Address } from "../model.js";
import type { StargateTokenPacketBinding } from "./token-model.js";

export const STARGATE_TOKEN_SOURCE_CHAIN = 10 as const;
export const STARGATE_TOKEN_DESTINATION_CHAIN = 137 as const;
export const STARGATE_TOKEN_SOURCE_EID = 30111 as const;
export const STARGATE_TOKEN_DESTINATION_EID = 30109 as const;
export const STARGATE_TOKEN_SOURCE_TOKEN = getAddress("0x0b2C639c533813f4Aa9D7837CAf62653d097Ff85");
export const STARGATE_TOKEN_DESTINATION_TOKEN = getAddress("0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359");
export const STARGATE_TOKEN_SOURCE_POOL = getAddress("0xcE8CcA271Ebc0533920C83d39F417ED6A0abB7D0");
export const STARGATE_TOKEN_DESTINATION_POOL = getAddress("0x9Aa02D4Fae7F58b8E8f34c66E756cC734DAc7fe4");
/** Official LayerZero Optimism mainnet Executor at lz-address-book commit 7c800d6. */
export const STARGATE_TOKEN_SOURCE_EXECUTOR = getAddress("0x2D2ea0697bdbede3F01553D2Ae4B8d0c486B666e");
export const STARGATE_TOKEN_DESTINATION_EXECUTOR = getAddress("0xCd3F213AD101472e1713C72B1697E727C803885b");
export const LAYERZERO_ENDPOINT_V2 = getAddress("0x1a44076050125825900e736c501f859c50fE728c");
export const STARGATE_TOKEN_SOURCE_MESSAGING = getAddress("0xF1fCb4CBd57B67d683972A59B6a7b1e2E8Bf27E6");
export const STARGATE_TOKEN_DESTINATION_MESSAGING = getAddress("0x6CE9bf8CDaB780416AD1fd87b318A077D2f50EaC");
// TokenMessaging embeds chain-specific immutable configuration, so each deployed runtime has its own byte hash.
export const STARGATE_TOKEN_SOURCE_MESSAGING_CODE_HASH = "0x40eefa854ab4e4564009d7d4c08b0e2d341f6b6a354c201c326096468b300827" as Hex;
export const STARGATE_TOKEN_DESTINATION_MESSAGING_CODE_HASH = "0xae66157283b0894d904b84d87efe27ea850e5eae61351827f4fcf7c3c04d593f" as Hex;
export const STARGATE_TOKEN_MECHANISM = Object.freeze({ provider: "stargate-v2", reference:
  `eip155:10:${STARGATE_TOKEN_SOURCE_POOL}/eip155:137:${STARGATE_TOKEN_DESTINATION_POOL}` });
export const UINT = /^(?:0|[1-9][0-9]{0,77})$/u, HASH = /^0x[0-9a-f]{64}$/u, CODE = /^0x(?:[0-9a-f]{2})+$/u;
export const MAX_TTL_MS = 120_000;
export const STARGATE_TOKEN_APPROVAL_FINALITY_WINDOW_MS = 30 * 60_000;
export const STARGATE_TOKEN_POST_APPROVAL_QUOTE_TTL_MS = 60_000;
export const STARGATE_TOKEN_MAX_BRIDGE_GAS = 5_000_000n;
export function fail(code: "APN_INVALID_INPUT" | "APN_OPERATION_BLOCKED" | "APN_RPC_PROTOCOL" | "APN_RPC_AMBIGUOUS" |
  "APN_CHAIN_MISMATCH" | "APN_REPREPARE_REQUIRED" | "APN_STATE_CORRUPT", reason: string): never {
  throw new ApnError(code, `Direct Stargate V2 token execution failed closed: ${reason}.`, { reason });
}
export function uint(value: unknown, positive = false): bigint {
  if (typeof value !== "string" || !UINT.test(value)) return fail("APN_INVALID_INPUT", "noncanonical_uint");
  const n = BigInt(value); if (n >= 1n << 256n || (positive && n === 0n)) return fail("APN_INVALID_INPUT", "uint_range"); return n;
}
export function address(value: unknown): Address { try { const a = getAddress(value as string); if (a === zeroAddress) throw 0; return a; } catch { return fail("APN_INVALID_INPUT", "address"); } }
export function hex32(value: unknown): Hex { if (typeof value !== "string" || !HASH.test(value)) return fail("APN_RPC_PROTOCOL", "hash"); return value as Hex; }
export function quantity(value: unknown): bigint { if (typeof value !== "string" || !/^0x(?:0|[1-9a-f][0-9a-f]*)$/u.test(value)) return fail("APN_RPC_PROTOCOL", "quantity"); return BigInt(value); }
export function packetBinding(payload: Hex): StargateTokenPacketBinding & { readonly guid: Hex } {
  const bytes = payload.slice(2); if (!/^[0-9a-f]+$/u.test(bytes) || bytes.length < 226 || bytes.slice(0, 2) !== "01") fail("APN_RPC_PROTOCOL", "source_packet_encoding");
  const at = (offset: number, length: number) => bytes.slice(offset * 2, (offset + length) * 2);
  const binding = { srcEid: Number(BigInt(`0x${at(9, 4)}`)), sender: `0x${at(13, 32)}` as Hex,
    nonceAtomic: BigInt(`0x${at(1, 8)}`).toString(), dstEid: Number(BigInt(`0x${at(45, 4)}`)),
    receiver: `0x${at(49, 32)}` as Hex, guid: `0x${at(81, 32)}` as Hex };
  if (binding.srcEid !== 30111 || binding.dstEid !== 30109) fail("APN_RPC_PROTOCOL", "source_packet_eids");
  return binding as StargateTokenPacketBinding & { readonly guid: Hex };
}
/** Exact OptionsBuilder.addExecutorNativeDropOption Type-3 wire encoding. */
export function encodeStargateNativeDrop(amountInput: string, recipientInput: Address): Hex {
  const amount = uint(amountInput, true), recipient = address(recipientInput);
  if (amount >= 1n << 128n) fail("APN_INVALID_INPUT", "native_drop_uint128");
  return (`0x0003` + `01` + `0031` + `02` + amount.toString(16).padStart(32, "0") + recipient.slice(2).toLowerCase().padStart(64, "0")) as Hex;
}
