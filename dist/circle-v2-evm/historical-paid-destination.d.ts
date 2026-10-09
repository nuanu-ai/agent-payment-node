import { type Hex } from "viem";
import type { StateStore } from "../state.js";
import { type CircleOperationV1 } from "./operation-model.js";
import { type CircleObservation, type CircleReceiptProof } from "./protocol.js";
import { type CircleRpc } from "./rpc.js";
import { type CircleDeploymentSnapshot } from "./preflight.js";
import { type HistoricalPaidSourceEvidence } from "./historical-paid-source.js";
export declare const HISTORICAL_MONAD_MINT = "0xa960a09b6abb91ab9cc8c847d5846266cb84b83d617e162b052c60640a28a961";
export interface HistoricalPaidDestinationEvidence {
    readonly kind: "owned_linea" | "external_monad";
    readonly receipt: CircleReceiptProof;
    readonly observation: CircleObservation;
    readonly historicalDeployment: CircleDeploymentSnapshot;
    readonly currentDeployment: CircleDeploymentSnapshot;
    readonly sourceCurrentDeployment: CircleDeploymentSnapshot;
    readonly caller: string;
    readonly parentHash: Hex;
    readonly parentNumberAtomic: string;
    readonly beforeAtomic: string;
    readonly afterAtomic: string;
    readonly historicalDeploymentDigest: string;
    readonly signedMaterialHash: string | null;
    readonly rawTransactionBinding: string;
    readonly timestampDerived: boolean;
}
/** Called only within the private coordinator's fresh proof pipeline; never consumes supplied destination JSON. */
export declare function verifyHistoricalPaidDestination(state: StateStore, op: CircleOperationV1, sourceEvidence: HistoricalPaidSourceEvidence, source: CircleRpc, destination: CircleRpc): Promise<HistoricalPaidDestinationEvidence>;
