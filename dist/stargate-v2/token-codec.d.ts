import { type Hex } from "viem";
import type { Address } from "../model.js";
import type { StargateTokenPacketBinding } from "./token-model.js";
export declare const STARGATE_TOKEN_SOURCE_CHAIN: 10;
export declare const STARGATE_TOKEN_DESTINATION_CHAIN: 137;
export declare const STARGATE_TOKEN_SOURCE_TOKEN: `0x${string}`;
export declare const STARGATE_TOKEN_DESTINATION_TOKEN: `0x${string}`;
export declare const STARGATE_TOKEN_SOURCE_POOL: `0x${string}`;
export declare const STARGATE_TOKEN_DESTINATION_POOL: `0x${string}`;
/** Official LayerZero Optimism mainnet Executor at lz-address-book commit 7c800d6. */
export declare const STARGATE_TOKEN_SOURCE_EXECUTOR: `0x${string}`;
export declare const STARGATE_TOKEN_DESTINATION_EXECUTOR: `0x${string}`;
export declare const LAYERZERO_ENDPOINT_V2: `0x${string}`;
export declare const STARGATE_TOKEN_SOURCE_MESSAGING: `0x${string}`;
export declare const STARGATE_TOKEN_DESTINATION_MESSAGING: `0x${string}`;
export declare const STARGATE_TOKEN_MECHANISM: Readonly<{
    provider: "stargate-v2";
    reference: `eip155:10:0x${string}/eip155:137:0x${string}`;
}>;
export declare const UINT: RegExp, HASH: RegExp, CODE: RegExp;
export declare const MAX_TTL_MS = 120000;
export declare const STARGATE_TOKEN_APPROVAL_FINALITY_WINDOW_MS: number;
export declare const STARGATE_TOKEN_POST_APPROVAL_QUOTE_TTL_MS = 60000;
export declare const STARGATE_TOKEN_MAX_BRIDGE_GAS = 5000000n;
/** v6 binds OP Mainnet L1 data and operator fee bounds into the native debit; v5 (0.5.25..) records stay readable as they were. */
export declare const STARGATE_TOKEN_SCHEMA: "apn.stargate-v2-token-operation.v6";
export declare const STARGATE_TOKEN_SCHEMA_V5: "apn.stargate-v2-token-operation.v5";
export declare const STARGATE_TOKEN_POST_APPROVAL_SCHEMA: "apn.stargate-v2-token-post-approval-quote.v2";
export declare const STARGATE_TOKEN_POST_APPROVAL_SCHEMA_V1: "apn.stargate-v2-token-post-approval-quote.v1";
export declare function fail(code: "APN_INVALID_INPUT" | "APN_OPERATION_BLOCKED" | "APN_RPC_PROTOCOL" | "APN_RPC_AMBIGUOUS" | "APN_CHAIN_MISMATCH" | "APN_REPREPARE_REQUIRED" | "APN_STATE_CORRUPT", reason: string): never;
export declare function uint(value: unknown, positive?: boolean): bigint;
export declare function address(value: unknown): Address;
export declare function hex32(value: unknown): Hex;
export declare function quantity(value: unknown): bigint;
export declare function packetBinding(payload: Hex): StargateTokenPacketBinding & {
    readonly guid: Hex;
};
/** Exact OptionsBuilder.addExecutorNativeDropOption Type-3 wire encoding. */
export declare function encodeStargateNativeDrop(amountInput: string, recipientInput: Address): Hex;
