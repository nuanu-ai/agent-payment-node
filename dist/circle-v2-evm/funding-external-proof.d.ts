import { type Address } from "viem";
import { type CircleObservation, type CircleReceiptProof } from "./protocol.js";
import type { CircleFundingOperationV2 } from "./funding-operation.js";
import { type CircleExternalFulfillment } from "./external-proof.js";
export interface CircleFundingExternalFulfillment extends Omit<CircleExternalFulfillment, "schemaVersion" | "grossAtomic" | "recipientBalance"> {
    readonly schemaVersion: "apn.circle-funding-external-fulfillment.v2";
    readonly grossAtomic: string;
    readonly recipientCredit: {
        readonly transactionHash: string;
        readonly blockHash: string;
        readonly logIndexAtomic: string;
        readonly amountAtomic: string;
        readonly logHash: string;
    };
}
export declare function decodeCircleFundingExternalDestination(op: CircleFundingOperationV2, input: CircleObservation, usedNonce: unknown, feeRecipient?: Address): Promise<CircleReceiptProof & {
    caller: Address;
}>;
export declare function fundingExternalClaimKey(op: CircleFundingOperationV2): string;
export declare function validateFundingExternalFulfillment(p: CircleFundingExternalFulfillment, op: CircleFundingOperationV2): void;
/** Both full proofs are validated before comparing identity. Only advancing current-head witnesses (finality heads and
 * the deployment check, kept under its historical field name) and their derived digests are excluded; included
 * transactions, receipts, events and economics stay exact. */
export declare function fundingExternalStableIdentity(p: CircleFundingExternalFulfillment): unknown;
