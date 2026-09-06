import { type EvmAsset } from "./evm-asset.js";
import type { EvmBalanceSnapshot, EvmFeeQuote, EvmRpcPort, EvmTransactionInput } from "./evm-ports.js";
import type { Address, Economics, OperationRecord } from "./model.js";
import type { RpcPort } from "./ports.js";
export interface EvmDirectBinding {
    readonly schemaVersion: "apn.evm-direct.v1";
    readonly asset: EvmAsset;
    readonly transactionTo: Address;
    readonly valueAtomic: string;
    readonly maxFeeWei: string;
    readonly feeQuote: EvmFeeQuote;
}
export declare function requireEvmRpc(rpc: RpcPort): EvmRpcPort;
export declare function evmTransaction(asset: EvmAsset, from: Address, recipient: Address, amountAtomic: string): EvmTransactionInput;
export declare function evmDirectFingerprint(operation: Pick<OperationRecord, "operationId" | "profile" | "chainId" | "token" | "walletAddress" | "recipient" | "amountAtomic" | "transactionData" | "economics" | "preparedAt" | "expiresAt" | "evm">): string;
export declare function validateEvmFeeQuote(value: unknown, economics?: Economics): EvmFeeQuote;
export declare function validateEvmDirectBinding(value: unknown, economics?: Economics): EvmDirectBinding;
export declare function validateEvmOperation(operation: OperationRecord): void;
export declare function requireEvmFunding(balance: EvmBalanceSnapshot, amountAtomic: string, quote: EvmFeeQuote, maximumFeeWei: string): void;
