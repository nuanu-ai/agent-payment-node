import type { Address, Hex } from "../model.js";
import { type MetaMaskGaslessChainId, type MetaMaskGaslessRequest } from "./model.js";
import { type MetaMaskGaslessFailureReason } from "./reasons.js";
export declare function mmExact(value: unknown, keys: readonly string[], reason?: MetaMaskGaslessFailureReason): Record<string, unknown>;
export declare function mmUint(value: unknown, positive?: boolean, reason?: MetaMaskGaslessFailureReason): bigint;
/** Exact decimal text of token atoms at the token's own scale (6 for USDC rows, 18 for the chain 56 rows). */
export declare function mmFormat(value: string, decimals: number): string;
export declare function mmAddress(value: unknown, reason?: MetaMaskGaslessFailureReason): Address;
export declare function mmCanonicalAddress(value: unknown, reason?: MetaMaskGaslessFailureReason): Address;
export declare function mmHex(value: unknown, bytes?: number, reason?: MetaMaskGaslessFailureReason, maximum?: number): Hex;
export declare function mmHash(value: unknown, reason?: MetaMaskGaslessFailureReason): string;
export declare function mmIso(value: unknown, reason?: MetaMaskGaslessFailureReason): string;
export declare function mmUuid(value: unknown, reason?: MetaMaskGaslessFailureReason): string;
export declare function mmChain(value: unknown): MetaMaskGaslessChainId;
export declare function mmSame(a: unknown, b: unknown): boolean;
/**
 * The request's shape only. Its optional token is a canonical address; which chains need it is the registry's rule,
 * applied when a request is prepared (`mmRequestDeployment`), so a saved record never depends on today's rows.
 */
export declare function mmRequest(value: unknown, reason?: MetaMaskGaslessFailureReason): MetaMaskGaslessRequest;
