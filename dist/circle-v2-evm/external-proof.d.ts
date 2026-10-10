import { type Address, type Hex } from "viem";
import { type CircleObservation, type CircleReceiptProof, type CircleSourceProof } from "./protocol.js";
import type { CircleOperationV1 } from "./operation-model.js";
export interface CircleExternalFulfillment {
    readonly schemaVersion: "apn.circle-external-fulfillment.v1";
    readonly operationId: string;
    readonly fingerprint: string;
    readonly sourceTransactionHash: Hex;
    readonly sourceMessageHash: Hex;
    readonly attestedMessageHash: Hex;
    readonly nonce: Hex;
    readonly destinationChain: number;
    readonly recipient: Address;
    readonly token: Address;
    readonly grossAtomic: "40100";
    readonly issuerFeeAtomic: string;
    readonly netAtomic: string;
    readonly caller: Address;
    readonly controlledDestinationNativeAtomic: "0";
    readonly sourceApprovalActualFeeAtomic: string;
    readonly sourceBurnActualFeeAtomic: string;
    readonly destinationReceipt: CircleReceiptProof;
    readonly sourceFinality: CircleSourceProof;
    readonly recipientBalance: {
        readonly parentHash: Hex;
        readonly parentNumberAtomic: string;
        readonly before: string;
        readonly after: string;
        readonly delta: string;
    };
    readonly historicalDeploymentDigest: string;
    readonly claimDigest: string;
    readonly evidenceHash: string;
    readonly proofHash: string;
}
/** Recompute the actual Ethereum-compatible RLP header, including contiguous fork suffixes. */
export declare function circleExternalHeader(value: unknown): Hex;
export declare function circleExternalTransaction(value: unknown): Promise<{
    hash: Hex;
    caller: Address;
    feePrice: bigint;
}>;
export declare function decodeCircleExternalDestination(op: CircleOperationV1, input: CircleObservation, usedNonce: unknown, feeRecipient?: Address): Promise<CircleReceiptProof & {
    caller: Address;
}>;
export declare function externalClaimKey(op: CircleOperationV1): string;
export declare function validateExternalFulfillment(p: CircleExternalFulfillment, op: CircleOperationV1): void;
