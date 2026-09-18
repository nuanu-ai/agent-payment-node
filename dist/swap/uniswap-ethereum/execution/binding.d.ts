import { type Hex } from "viem";
import { type SwapOperationRecord } from "../../model.js";
import { type SwapProtocolRegistry } from "../../protocol-registry.js";
import type { UniswapTransactionEnvelope } from "../../uniswap-codec.js";
import type { UniswapExecutionApprovalRequest, UniswapExecutionBinding, UniswapExecutionFreshness, UniswapOwnerAdmission } from "./types.js";
export declare function assertInjectedProtocol(operationValue: unknown, registryValue: unknown): SwapProtocolRegistry;
export declare function createUniswapApprovalRequest(operationValue: unknown, envelope: UniswapTransactionEnvelope, freshness: UniswapExecutionFreshness, now: Date): UniswapExecutionApprovalRequest;
export declare function createUniswapExecutionBinding(input: {
    readonly operation: SwapOperationRecord;
    readonly envelope: UniswapTransactionEnvelope;
    readonly freshness: UniswapExecutionFreshness;
    readonly admission: UniswapOwnerAdmission;
    readonly approvalHash: string;
}): UniswapExecutionBinding;
export declare function validateUniswapExecutionBinding(value: unknown, operationValue: unknown): UniswapExecutionBinding;
export declare function validateFreshness(operationValue: unknown, envelope: UniswapTransactionEnvelope, fresh: UniswapExecutionFreshness, now: Date): void;
export declare function verifySignedUniswapTransaction(raw: Hex, bindingValue: unknown, operationValue: unknown): Promise<Hex>;
