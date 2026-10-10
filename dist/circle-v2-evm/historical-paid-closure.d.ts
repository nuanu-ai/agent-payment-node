import type { StateStore } from "../state.js";
import type { AssetUsageReservation } from "../asset-usage-ledger.js";
import { SecureStateStore } from "../secure-state-store.js";
import { type CircleOperationV1 } from "./operation-model.js";
import type { HistoricalPaidRpc } from "./historical-paid-rpc.js";
import { type HistoricalPaidSourceEvidence } from "./historical-paid-source.js";
import { type HistoricalPaidDestinationEvidence } from "./historical-paid-destination.js";
import { type CircleExternalFulfillment } from "./external-proof.js";
export declare function detachedHistorical<T>(value: T): T;
export interface HistoricalPaidClosure {
    readonly schemaVersion: "apn.circle-historical-paid-closure.v1";
    readonly originalOperation: CircleOperationV1;
    readonly originalOperationDigest: string;
    readonly source: HistoricalPaidSourceEvidence;
    readonly destination: HistoricalPaidDestinationEvidence;
    readonly externalFulfillment: CircleExternalFulfillment | null;
    readonly readCounts: {
        readonly source: ReturnType<HistoricalPaidRpc["counts"]>;
        readonly destination: ReturnType<HistoricalPaidRpc["counts"]>;
    };
    readonly outcomes: readonly {
        readonly reservation: AssetUsageReservation;
        readonly state: "finalized" | "failed_confirmed_revert" | "released_unsubmitted";
        readonly consumedAtomic: string | null;
        readonly outcomeDigest: string;
    }[];
    readonly proofHash: string;
}
export interface VerifiedHistoricalPaidClosure {
    readonly kind: "verified-historical-paid-closure";
}
export declare class HistoricalPaidClosureStore extends SecureStateStore {
    load(op: CircleOperationV1): Promise<HistoricalPaidClosure | null>;
    create(op: CircleOperationV1, closure: HistoricalPaidClosure): Promise<void>;
}
/** No JSON evidence input exists: source and destination must both be freshly verified here. */
export declare function verifyHistoricalPaidClosure(state: StateStore, input: CircleOperationV1, source: HistoricalPaidRpc, destination: HistoricalPaidRpc): Promise<VerifiedHistoricalPaidClosure>;
/** One use, full durable frame check before the consumer's first ledger read, retained frozen values only. */
export declare function consumeHistoricalPaidClosure(token: VerifiedHistoricalPaidClosure, state: StateStore, input: CircleOperationV1): Promise<{
    readonly operation: CircleOperationV1;
    readonly closure: HistoricalPaidClosure;
}>;
