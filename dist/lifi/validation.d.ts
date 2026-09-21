import { type ErrorCode, type ErrorDetails } from "../errors.js";
import type { Address, Hex } from "../model.js";
export declare const BRIDGE_MAX_CALLDATA_BYTES: number;
export declare const BRIDGE_MAX_SIGNED_BYTES: number;
export declare const BRIDGE_MAX_GAS = 5000000n;
export declare const BRIDGE_TTL_MS = 300000;
export declare const BRIDGE_MIN_REMAINING_MS = 15000;
/**
 * The stated EIP-1559 price headroom the owner approves with the intent. A bridge is priced at preparation and
 * signed later, so the approved maximum is the quoted price raised by exactly this many basis points; the frozen
 * envelope, the signature, the native debit cap check and the approval disclosure all use that maximum. There is
 * no other multiplier anywhere in the rail, and a fresh estimate above the maximum is refused, never repriced.
 */
export declare const BRIDGE_FEE_HEADROOM_POLICY: "apn.bridge-fee-headroom.v1";
export declare const BRIDGE_FEE_HEADROOM_BPS = 5000;
export declare const BRIDGE_DIAMOND: `0x${string}`;
export declare const BRIDGE_ZERO_ADDRESS: Address;
export declare const BRIDGE_ZERO_WORD: Hex;
export declare function bridgeFailure(code: ErrorCode, reason: string, details?: ErrorDetails): never;
export declare function bridgeRecord(value: unknown, code?: ErrorCode): Record<string, unknown>;
export declare function bridgeExact(value: unknown, keys: readonly string[], code?: ErrorCode): Record<string, unknown>;
export declare function bridgeUint(value: unknown, positive?: boolean, code?: ErrorCode): bigint;
export declare function bridgeAddress(value: unknown, code?: ErrorCode): Address;
export declare function bridgeHex(value: unknown, maxBytes?: number, exactBytes?: number, code?: ErrorCode): Hex;
export declare function bridgeHash(value: unknown, code?: ErrorCode): string;
export declare function bridgeOpaque(value: unknown, code?: ErrorCode): string;
export declare function bridgeIso(value: unknown): string;
export declare function bridgeJson(value: string, maxBytes: number): unknown;
export declare function bridgeSame(left: unknown, right: unknown): boolean;
/**
 * Raises one quoted wei price to the owner-approved maximum by exactly BRIDGE_FEE_HEADROOM_BPS, rounding up so the
 * maximum is never below the quote. This is the only place the headroom is applied.
 */
export declare function bridgeHeadroomWei(quotedWei: string, code?: ErrorCode): string;
