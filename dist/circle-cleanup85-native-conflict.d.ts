import { type VerifiedCleanup85RecoveryAdmission } from "./circle-v2-evm/cleanup85-recovery-admission.js";
import type { Cleanup85CancellationRequest } from "./circle-cleanup85-cancellation-contract.js";
import type { OperationRecord } from "./model.js";
import type { StateStore } from "./state.js";
export declare function cleanup85ConflictExclusion(state: StateStore, proof: VerifiedCleanup85RecoveryAdmission, request: Cleanup85CancellationRequest, exceptOperation?: OperationRecord): Promise<{
    profileHash: string;
    account: `0x${string}`;
    parent: {
        operationId: string;
        integrityHash: string;
    };
}>;
export type { VerifiedCleanup85RecoveryAdmission } from "./circle-v2-evm/cleanup85-recovery-admission.js";
export type { Cleanup85CancellationRequest } from "./circle-cleanup85-cancellation-contract.js";
