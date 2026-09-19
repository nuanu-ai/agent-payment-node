import { type ErrorCode } from "../errors.js";
import type { Address, Hex } from "../model.js";
/**
 * Local-wallet gasless USDT on Ethereum through Pimlico's ERC-20 paymaster, reached through the keyless public endpoint.
 * Every identity below was read from Ethereum mainnet on 2026-09-18 (block 26002950) and is exposed as a read-only capability registry; this foundation performs no effect.
 * The sponsor charges its fee in the same token, in postOp, from the sender to the pinned treasury.
 */
export declare const USDT_GASLESS: Readonly<{
    chainId: 1;
    chain: "eip155:1";
    network: "Ethereum";
    rpcEnv: "APN_ETHEREUM_RPC_URL";
    bundlerEnv: "APN_ETHEREUM_BUNDLER_RPC_URL";
    /** Public, keyless: no API key, 20 requests per minute per IP shared with every other call. */
    bundlerUrl: "https://public.pimlico.io/v2/1/rpc";
    token: `0x${string}`;
    symbol: "USDT";
    decimals: 6;
    tokenCodeHash: Hex;
    /** USDT storage the quote names: `balances` at slot 2 and `allowed` at slot 5. */
    balanceSlot: 2n;
    allowanceSlot: 5n;
    entryPoint: `0x${string}`;
    entryPointCodeHash: Hex;
    delegate: `0x${string}`;
    delegateCodeHash: Hex;
    /** Pimlico singleton ERC-20 paymaster for EntryPoint v0.8; not a proxy. */
    paymaster: `0x${string}`;
    paymasterCodeHash: Hex;
    /** Fee recipient named inside every signed paymaster payload. A different treasury fails closed. */
    treasury: `0x${string}`;
    /** The owner allowlist pin an admission on rail `gasless` must carry, field for field. */
    mechanism: Readonly<{
        provider: "pimlico-erc20-paymaster";
        reference: "eip155:1:0x888888888888Ec68A58AB8094Cc1AD20Ba3D2402";
    }>;
}>;
/**
 * Fixed gas offer for the three-call batch (approve 0, approve fee cap, transfer). The fee bound multiplies every field by
 * the price, so the owner's cap covers the worst case; the bundler cannot use more than these limits.
 */
export declare const USDT_GASLESS_GAS: Readonly<{
    verificationGasLimit: 75000n;
    callGasLimit: 130000n;
    paymasterVerificationGasLimit: 100000n;
    paymasterPostOpGasLimit: 75000n;
    preVerificationGas: 100000n;
}>;
export type UsdtGaslessGas = typeof USDT_GASLESS_GAS;
/** Bounds the provider quote must stay inside; anything outside refuses instead of being clamped. */
export declare const USDT_POST_OP_GAS_MAX = 100000n;
export declare const USDT_EXCHANGE_RATE_MAX: bigint;
/** A sponsor payload must be valid for at least this long and at most this long after the check. */
export declare const USDT_PAYMASTER_MIN_VALIDITY_S = 60n;
export declare const USDT_PAYMASTER_MAX_VALIDITY_S = 3600n;
export interface UsdtTokenQuote {
    readonly paymaster: Address;
    readonly token: Address;
    readonly postOpGas: bigint;
    /** Token atomic units per 1e18 wei, markup included. */
    readonly exchangeRate: bigint;
    readonly exchangeRateNativeToUsd: bigint;
}
export interface UsdtGasPrice {
    readonly maxFeePerGas: bigint;
    readonly maxPriorityFeePerGas: bigint;
}
export interface UsdtTransferRequest {
    readonly sender: Address;
    readonly recipient: Address;
    readonly grossAtomic: bigint;
    readonly maxFeeAtomic: bigint;
    readonly minReceivedAtomic: bigint;
}
/** Every value that a future caller must bind before any authorization. */
export interface UsdtTransferPlan {
    readonly request: UsdtTransferRequest;
    /** F: the fee budget and the exact paymaster allowance the batch grants. */
    readonly feeCapAtomic: bigint;
    /** N: the recipient's exact credit. */
    readonly netAtomic: bigint;
    /** The quote's worst-case charge at the offered gas and price; never above F. */
    readonly quotedFeeAtomic: bigint;
    readonly quote: UsdtTokenQuote;
    readonly price: UsdtGasPrice;
    readonly gas: UsdtGaslessGas;
}
export interface UsdtPaymasterPayload {
    readonly allowAllBundlers: boolean;
    readonly validUntil: bigint;
    readonly validAfter: bigint;
    readonly token: Address;
    readonly postOpGas: bigint;
    readonly exchangeRate: bigint;
    readonly paymasterValidationGasLimit: bigint;
    readonly treasury: Address;
    readonly signature: Hex;
}
export declare function usdtFailure(code: ErrorCode, reason: string, message?: string): never;
