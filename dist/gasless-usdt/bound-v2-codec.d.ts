import type { UsdtPolicyPreparedV2 } from "./policy-prepare-v2.js";
export declare const USDT_BOUND_V2_SCHEMA: "apn.gasless-usdt-bound-operation.v2";
export type PersistedV2<T> = T extends bigint ? string : T extends readonly (infer Item)[] ? readonly PersistedV2<Item>[] : T extends object ? {
    readonly [Key in keyof T]: PersistedV2<T[Key]>;
} : T;
export interface UsdtBoundOperationV2 {
    readonly schemaVersion: typeof USDT_BOUND_V2_SCHEMA;
    readonly operationId: string;
    readonly profileHash: string;
    readonly idempotencyKey: string;
    readonly binding: PersistedV2<UsdtPolicyPreparedV2>;
    readonly createdAt: string;
    readonly signerBoundary: "unavailable";
    readonly dispatch: "disabled";
    readonly usageReservation: "disabled";
    readonly integrityHash: string;
}
export declare function validateUsdtBoundOperationV2(value: unknown): UsdtBoundOperationV2;
