import type { Address, Hex } from "../model.js";
import { type UsdtTransferPlan } from "./model.js";
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
export declare function usdtUserOperation(plan: UsdtTransferPlan, input: {
    readonly entryPointNonce: bigint;
    readonly callData: Hex;
    readonly paymasterData: Hex;
    readonly signature: Hex;
    readonly authorization: UsdtAuthorization | null;
}): UsdtUserOperation;
/** EntryPoint v0.8 EIP-712 hash; the 7702 marker makes the EntryPoint hash the delegate in place of initCode. */
export declare function usdtUserOperationHash(op: UsdtUserOperation): Hex;
