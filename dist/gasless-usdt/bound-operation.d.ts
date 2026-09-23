import { type UsdtPolicyPrepared, type UsdtPreparePort } from "./policy-prepare.js";
export declare const USDT_BOUND_OPERATION_SCHEMA: "apn.gasless-usdt-bound-operation.v1";
type Persisted<T> = T extends bigint ? string : T extends readonly (infer Item)[] ? readonly Persisted<Item>[] : T extends object ? {
    readonly [Key in keyof T]: Persisted<T[Key]>;
} : T;
export interface UsdtBoundOperation {
    readonly schemaVersion: typeof USDT_BOUND_OPERATION_SCHEMA;
    readonly operationId: string;
    readonly profileHash: string;
    readonly idempotencyKey: string;
    readonly binding: Persisted<UsdtPolicyPrepared>;
    readonly createdAt: string;
    readonly signerBoundary: "unavailable";
    readonly dispatch: "disabled";
    readonly usageReservation: "disabled";
    readonly integrityHash: string;
}
export type UsdtBoundRecovery = {
    readonly state: "prepared";
    readonly operation: UsdtBoundOperation;
} | {
    readonly state: "capability_unavailable" | "recovery_required";
    readonly reason: string;
    readonly operation: UsdtBoundOperation;
};
/** Validate both hashes and the relationships that a rehashed but inconsistent record could violate. */
export declare function validateUsdtBoundOperation(value: unknown): UsdtBoundOperation;
/** Separate bound journal: one key claims across its profiles, independently of every other payment family's claims. */
export declare class UsdtBoundOperationRepository {
    readonly root: string;
    readonly directory: string;
    constructor(root: string);
    private profilePath;
    private path;
    private claimsPath;
    private claimPath;
    private dir;
    private syncDirectory;
    protected fsyncDirectory(path: string): Promise<void>;
    private readRecord;
    private readClaim;
    private writeCompleteTemp;
    /** Publish a fully written file with link(2), which fails rather than replacing an existing record. */
    private publish;
    private cleanupOldTemps;
    load(profileHash: string, operationId: string): Promise<UsdtBoundOperation | null>;
    create(profileHash: string, binding: UsdtPolicyPrepared, idempotencyKey: string, now: Date): Promise<UsdtBoundOperation>;
}
/** Classification reads only. Drift or revocation never advances the operation or authorizes an effect. */
export declare function classifyUsdtBoundRecovery(operation: UsdtBoundOperation, port: UsdtPreparePort): Promise<UsdtBoundRecovery>;
export {};
