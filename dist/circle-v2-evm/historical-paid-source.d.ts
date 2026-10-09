import type { StateStore } from "../state.js";
import { type CircleOperationV1 } from "./operation-model.js";
import { decodeCircleSource, type CircleReceiptProof } from "./protocol.js";
import { type CircleRpc } from "./rpc.js";
import type { CircleDeploymentSnapshot } from "./preflight.js";
/** This module verifies public source history only. It cannot authorize any effect or ledger write. */
export declare const HISTORICAL_LINEA_OPERATION = "23f54a86f0ec0cfaf0a69f419c9a0c9fd19420fc9f2195bfe6c00192ab7b44c6";
export declare const HISTORICAL_MONAD_OPERATION = "df077b005a9723de748d425d9172c4fb1cf5c6e4b2cc5bdd18327f770cd1ad46";
export interface HistoricalPaidSourceEvidence {
    readonly version: "apn.circle-historical-paid-source.v1";
    readonly operationDigest: string;
    readonly approvalProof: CircleReceiptProof;
    readonly sourceProof: ReturnType<typeof decodeCircleSource>;
    readonly cleanupProof: CircleReceiptProof | null;
    readonly acceptanceBlock: {
        readonly hash: string;
        readonly numberAtomic: string;
        readonly timestampAtomic: string;
    };
    readonly allowanceAtomic: "0";
    readonly historicalNonceAtomic: string;
    readonly nonceFloorAtomic: string;
    readonly finalityBlock: {
        readonly hash: string;
        readonly numberAtomic: string;
        readonly timestampAtomic: string;
    };
    readonly deployment: CircleDeploymentSnapshot;
    readonly materialHeaderDigest: string;
    readonly evidenceHash: string;
}
export interface VerifiedHistoricalPaidSource {
    readonly kind: "verified-historical-paid-source";
}
/** Re-reads the durable actual parent before RPC and after the complete anchored observation.
 * Financial expiry/current policy pointers are deliberately irrelevant to this public-only proof. */
export declare function verifyHistoricalPaidSource(state: StateStore, input: CircleOperationV1, source: CircleRpc): Promise<VerifiedHistoricalPaidSource>;
/** Detached verified public metadata, not a caller flag or ledger capability. */
export declare function historicalPaidSourceBody(token: VerifiedHistoricalPaidSource, state: StateStore, op: CircleOperationV1): Promise<{
    readonly operation: CircleOperationV1;
    readonly evidence: HistoricalPaidSourceEvidence;
}>;
