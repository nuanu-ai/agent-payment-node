import { type UsdtOperationInput, type UsdtOperationRecord, type UsdtOperationRepository } from "./operation.js";
import { type UsdtBoundOperation, type UsdtBoundRecovery, type UsdtBoundReplayIntent } from "./bound-operation.js";
import type { UsdtPolicyPrepared, UsdtPreparePort } from "./policy-prepare.js";
/** Read-only operation boundary for the gasless USDT foundation. No signer or dispatcher is reachable. */
export declare class GaslessUsdtOperationService {
    readonly repository: UsdtOperationRepository;
    private readonly profileHash?;
    constructor(repository: UsdtOperationRepository, profileHash?: string | undefined);
    /** Bind an explicit persisted profile hash; profile names are never interpreted as hashes. */
    forProfile(profileHash: string): GaslessUsdtOperationService;
    private boundProfile;
    prepare(input: Omit<UsdtOperationInput, "profileHash">, idempotencyKey: string): Promise<UsdtOperationRecord>;
    status(operationId: string): Promise<UsdtOperationRecord>;
    resume(operationId: string): Promise<UsdtOperationRecord>;
    /** Persist the complete domain preparation. This cannot reserve usage or reach a signer. */
    prepareBound(binding: UsdtPolicyPrepared, idempotencyKey: string, now: Date): Promise<UsdtBoundOperation>;
    replayBound(idempotencyKey: string, intent: UsdtBoundReplayIntent): Promise<UsdtBoundOperation | null>;
    statusBound(operationId: string): Promise<UsdtBoundOperation>;
    /** Fresh, read-only recovery classification. No saved state is changed. */
    resumeBound(operationId: string, port: UsdtPreparePort): Promise<UsdtBoundRecovery>;
    approve(): never;
    execute(): never;
    sign(): never;
    dispatch(): never;
    recover(): never;
}
