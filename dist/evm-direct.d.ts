import { type CircleNativeAdmission } from "./legacy/circle-native-admission-rider.js";
import { type EvmAsset } from "./evm-asset.js";
import { type DirectEvmChainId } from "./evm-direct-networks.js";
import { type DirectEvmStep } from "./evm-direct-reads.js";
import type { EvmBalanceSnapshot, EvmDirectReads, EvmFeeQuote, EvmRpcPort, EvmTransactionInput } from "./evm-ports.js";
import { type Address, type Economics, type OperationRecord } from "./model.js";
import type { RpcPort } from "./ports.js";
import { type EvmNativeCustody } from "./evm-native-custody.js";
import { type Cleanup85NativeBinding } from "./legacy/cleanup85-native-records.js";
export interface EvmDirectBinding {
    readonly schemaVersion: "apn.evm-direct.v1";
    readonly asset: EvmAsset;
    readonly transactionTo: Address;
    readonly valueAtomic: string;
    readonly maxFeeWei: string;
    readonly feeQuote: EvmFeeQuote;
    readonly nativeCustody?: EvmNativeCustody;
    readonly circleNativeAdmission?: CircleNativeAdmission;
    readonly cleanup85Cancellation?: Cleanup85NativeBinding;
}
export declare function requireEvmRpc(rpc: RpcPort): EvmRpcPort;
/** The one batched reader every direct EVM transfer uses on every listed network; there is no scalar or per-lane variant. */
export declare function requireDirectEvmReads(rpc: RpcPort, chainId: DirectEvmChainId): EvmDirectReads;
/** Arm the command's POST cap from the step's own read plan; every listed network is capped and paced the same way. */
export declare function armDirectEvmStep(rpc: RpcPort, chainId: DirectEvmChainId, step: DirectEvmStep): void;
export declare function evmTransaction(asset: EvmAsset, from: Address, recipient: Address, amountAtomic: string): EvmTransactionInput;
export declare function evmDirectFingerprint(operation: Pick<OperationRecord, "operationId" | "profile" | "chainId" | "token" | "walletAddress" | "recipient" | "amountAtomic" | "transactionData" | "economics" | "preparedAt" | "expiresAt" | "evm">): string;
export declare function validateEvmFeeQuote(value: unknown, economics?: Economics): EvmFeeQuote;
export declare function validateEvmDirectBinding(value: unknown, economics?: Economics): EvmDirectBinding;
export declare function validateEvmOperation(operation: OperationRecord): void;
export declare function requireEvmFunding(balance: EvmBalanceSnapshot, amountAtomic: string, quote: EvmFeeQuote, maximumFeeWei: string): void;
