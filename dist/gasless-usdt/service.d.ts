import { type UsdtOperationInput, type UsdtOperationRecord, type UsdtOperationRepository } from "./operation.js";
/** Read-only operation boundary for the gasless USDT foundation. No signer or dispatcher is reachable. */
export declare class GaslessUsdtOperationService {
    readonly repository: UsdtOperationRepository;
    readonly profileHash: string;
    constructor(repository: UsdtOperationRepository, profileHash: string);
    prepare(input: Omit<UsdtOperationInput, "profileHash">, idempotencyKey: string): Promise<UsdtOperationRecord>;
    status(operationId: string): Promise<UsdtOperationRecord>;
    resume(operationId: string): Promise<UsdtOperationRecord>;
    approve(): never;
    execute(): never;
    sign(): never;
    dispatch(): never;
    recover(): never;
}
