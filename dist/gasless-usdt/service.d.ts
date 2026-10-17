import { type UsdtAnyBoundOperation as UsdtBoundOperation, type UsdtBoundReplayIntent } from "./bound-operation.js";
import type { UsdtPolicyPrepared } from "./policy-prepare.js";
/** Profile-bound access to the gasless USDT bound journal. No signer or dispatcher is reachable from here. */
export declare class GaslessUsdtOperationService {
    readonly root: string;
    private readonly profileHash?;
    constructor(root: string, profileHash?: string | undefined);
    /** Bind an explicit persisted profile hash; profile names are never interpreted as hashes. */
    forProfile(profileHash: string): GaslessUsdtOperationService;
    private boundProfile;
    /** Persist the complete domain preparation. This cannot reserve usage or reach a signer. */
    prepareBound(binding: UsdtPolicyPrepared | import("./policy-prepare-v2.js").UsdtPolicyPreparedV2, idempotencyKey: string, now: Date): Promise<UsdtBoundOperation>;
    replayBound(idempotencyKey: string, intent: UsdtBoundReplayIntent): Promise<UsdtBoundOperation | null>;
    statusBound(operationId: string): Promise<UsdtBoundOperation>;
}
