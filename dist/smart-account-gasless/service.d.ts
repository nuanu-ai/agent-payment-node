import type { SmartAccountGaslessObservationRpcFactory } from "./ports.js";
import { OperationService } from "../operation-service.js";
import type { RuntimeContext } from "../runtime.js";
import type { SmartAccountGaslessApprovalPort, SmartAccountGaslessMaterialPort, SmartAccountGaslessProviderPort, SmartAccountGaslessRepositoryPort, SmartAccountGaslessRpcFactory } from "./ports.js";
import { SmartAccountGaslessPreparation } from "./prepare.js";
export interface SmartAccountGaslessDependencies {
    readonly rpcFor: SmartAccountGaslessRpcFactory;
    readonly material: SmartAccountGaslessMaterialPort;
    readonly observationRpcFor?: SmartAccountGaslessObservationRpcFactory;
    readonly provider: SmartAccountGaslessProviderPort;
    readonly approval?: SmartAccountGaslessApprovalPort;
    readonly records?: SmartAccountGaslessRepositoryPort;
}
export declare class SmartAccountGaslessService {
    private readonly context;
    readonly records: SmartAccountGaslessRepositoryPort;
    readonly operations: OperationService;
    constructor(context: RuntimeContext);
    balance(profile: string, chainId: number): Promise<{
        profile: string;
        provider: string;
        chain_id: number;
        token: "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913";
        symbol: string;
        decimals: number;
        owner: `0x${string}`;
        session: `0x${string}`;
        balance_atomic: string;
        owner_native_balance_wei: string;
        session_native_balance_wei: string;
        available_allowance_atomic: string;
        root_delegation_hash: `0x${string}`;
        root_nonce_atomic: string;
        block: import("./model.js").SmartAccountGaslessBlock;
        observed_at: string;
        rpc_origin: string;
        endpoint_hash: string;
        sender_native_balance_required: boolean;
        proof_class: string;
    }>;
    prepare(input: Parameters<SmartAccountGaslessPreparation["prepare"]>[0]): Promise<import("./operation-model.js").SmartAccountGaslessPublicOperation>;
    approve(operationId: string): Promise<import("./operation-model.js").SmartAccountGaslessPublicOperation>;
    resume(operationId: string, observationRpcEnv?: string): Promise<import("./operation-model.js").SmartAccountGaslessPublicOperation>;
    status(operationId: string): Promise<import("./operation-model.js").SmartAccountGaslessPublicOperation>;
    receipt(operationId: string): Promise<import("./operation-model.js").SmartAccountGaslessReceipt>;
    private project;
    private dependencies;
    private execution;
    private locked;
}
