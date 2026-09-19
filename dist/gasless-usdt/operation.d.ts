import type { Address } from "../model.js";
export declare const USDT_OPERATION_SCHEMA: "apn.gasless-usdt-operation.v1";
export type UsdtOperationState = "prepared" | "recovery_required" | "capability_unavailable";
export interface UsdtOperationInput {
    readonly profileHash: string;
    readonly policyDigest: string;
    readonly sender: Address;
    readonly recipient: Address;
    readonly grossAtomic: bigint;
    readonly maxFeeAtomic: bigint;
    readonly minReceivedAtomic: bigint;
    readonly nonce: bigint;
    readonly expiresAt: number;
    readonly now?: number;
}
export interface UsdtOperationRecord {
    readonly schemaVersion: typeof USDT_OPERATION_SCHEMA;
    readonly kind: "gasless_usdt_transfer";
    readonly operationId: string;
    readonly idempotencyKey: string;
    readonly idempotencyHash: string;
    readonly profileHash: string;
    readonly policyDigest: string;
    readonly chainId: 1;
    readonly token: Address;
    readonly sender: Address;
    readonly recipient: Address;
    readonly grossAtomic: string;
    readonly maxFeeAtomic: string;
    readonly minReceivedAtomic: string;
    readonly nonce: string;
    readonly expiresAt: number;
    readonly signerBoundary: "unavailable";
    readonly dispatch: "disabled";
    readonly recovery: "read_only";
    readonly state: UsdtOperationState;
    readonly createdAt: string;
    readonly updatedAt: string;
    readonly integrityHash: string;
}
export declare function validateUsdtOperation(value: unknown): UsdtOperationRecord;
export declare class UsdtOperationRepository {
    readonly root: string;
    readonly directory: string;
    private idempotencyTail;
    constructor(root: string);
    private identifier;
    private path;
    private secureDirectory;
    private ensureDirectory;
    private secureFile;
    load(profileHash: string, operationId: string): Promise<UsdtOperationRecord | null>;
    private listEntries;
    findIdempotency(idempotencyHash: string): Promise<UsdtOperationRecord | null>;
    create(record: UsdtOperationRecord): Promise<UsdtOperationRecord>;
    withIdempotencyLock<T>(action: () => Promise<T>): Promise<T>;
}
export declare function prepareUsdtOperation(repository: UsdtOperationRepository, input: UsdtOperationInput, idempotencyKey: string): Promise<UsdtOperationRecord>;
export declare function statusUsdtOperation(repository: UsdtOperationRepository, profileHash: string, operationId: string): Promise<UsdtOperationRecord>;
/** Resume is a read-only classification. It never rewrites the saved journal or advances state. */
export declare function resumeUsdtOperation(repository: UsdtOperationRepository, profileHash: string, operationId: string): Promise<UsdtOperationRecord>;
export declare function refuseUsdtApproval(action: "approve" | "execute"): never;
export declare function refuseUsdtSigner(): never;
export declare function refuseUsdtDispatch(): never;
export declare function refuseUsdtRecovery(): never;
