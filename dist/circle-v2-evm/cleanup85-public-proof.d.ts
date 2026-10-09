import { type Hex } from "viem";
import type { Cleanup85CancellationProof } from "../circle-cleanup85-cancellation-contract.js";
import { type CircleEnvelope } from "./operation-model.js";
import { type CircleObservation } from "./protocol.js";
import type { CircleRpc } from "./rpc.js";
/** Reconstructs public finalized wire only. Never loads any stored private material. */
export declare function verifyCleanup85PublicWire(input: CircleObservation, envelope: Omit<CircleEnvelope, "valueAtomic"> & {
    readonly valueAtomic: string;
}, expectedHash: string, noLogs?: boolean): Promise<Hex>;
export declare function cleanup85Reanchor(source: CircleRpc, observation: CircleObservation): Promise<void>;
export declare function assertCancellationProofShape(proof: Cleanup85CancellationProof): void;
export declare function verifyCancellationPublic(source: CircleRpc, proof: Cleanup85CancellationProof): Promise<CircleObservation>;
