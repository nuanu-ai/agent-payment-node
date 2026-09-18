import type { Address, Hex } from "../model.js";
import { type UsdtTransferPlan } from "./model.js";
/**
 * The ERC-7769 short EIP-7702 marker. Pimlico's paymaster endpoint refuses the 20-byte spelling ("factory that is neither
 * null or 0x7702"); both pack to the same initCode on chain, and the EntryPoint hashes the delegate in its place.
 */
export declare const USDT_7702_FACTORY_MARKER: "0x7702";
/** The signed EIP-7702 tuple for a first use; a delegated account sends none. */
export interface UsdtAuthorization {
    readonly chainId: Hex;
    readonly address: Address;
    readonly nonce: Hex;
    readonly yParity: Hex;
    readonly r: Hex;
    readonly s: Hex;
}
/** ERC-4337 v0.8 JSON-RPC form. Every field is exact; nothing is filled in by the bundler or the paymaster. */
export interface UsdtUserOperation {
    readonly sender: Address;
    readonly nonce: Hex;
    readonly factory?: typeof USDT_7702_FACTORY_MARKER;
    readonly factoryData?: Hex;
    readonly callData: Hex;
    readonly callGasLimit: Hex;
    readonly verificationGasLimit: Hex;
    readonly preVerificationGas: Hex;
    readonly maxFeePerGas: Hex;
    readonly maxPriorityFeePerGas: Hex;
    readonly paymaster: Address;
    readonly paymasterVerificationGasLimit: Hex;
    readonly paymasterPostOpGasLimit: Hex;
    readonly paymasterData: Hex;
    readonly signature: Hex;
    readonly eip7702Auth?: UsdtAuthorization;
}
/**
 * The account batch: reset the paymaster allowance to zero (USDT refuses a nonzero-to-nonzero approve), grant exactly F,
 * then send exactly N. The paymaster pulls its charge from the sender in postOp, after this batch, so F - A stays
 * approved to the pinned paymaster; only a later UserOperation signed by this owner can use it, and the next batch resets it.
 */
export declare function usdtBatchCallData(plan: UsdtTransferPlan): Hex;
export declare function usdtUserOperation(plan: UsdtTransferPlan, input: {
    readonly entryPointNonce: bigint;
    readonly paymasterData: Hex;
    readonly signature: Hex;
    readonly authorization: UsdtAuthorization | null;
}): UsdtUserOperation;
/** EntryPoint v0.8 EIP-712 hash; the 7702 marker makes the EntryPoint hash the delegate in place of initCode. */
export declare function usdtUserOperationHash(op: UsdtUserOperation): Hex;
