import { OperationService } from "../operation-service.js";
import type { RuntimeContext } from "../runtime.js";
import type { MetaMaskGaslessChainId } from "./model.js";
import type { MetaMaskGaslessApprovalPort, MetaMaskGaslessProviderPort, MetaMaskGaslessRepositoryPort, MetaMaskGaslessRpcFactory } from "./ports.js";
import { MetaMaskGaslessPreparation } from "./prepare.js";
export interface MetaMaskGaslessDependencies {
    readonly rpcFor: MetaMaskGaslessRpcFactory;
    readonly provider: MetaMaskGaslessProviderPort;
    readonly approval?: MetaMaskGaslessApprovalPort;
    readonly records?: MetaMaskGaslessRepositoryPort;
}
export declare class MetaMaskGaslessService {
    private readonly context;
    readonly records: MetaMaskGaslessRepositoryPort;
    readonly operations: OperationService;
    constructor(context: RuntimeContext);
    balance(profile: string, chainId: MetaMaskGaslessChainId): Promise<{
        profile: string;
        provider: string;
        chain_id: 1 | 8453 | 42161 | 10 | 137 | 143 | 1329 | 59144;
        token: `0x${string}`;
        symbol: string;
        decimals: number;
        address: `0x${string}`;
        balance_atomic: string;
        designation: "empty" | "pinned";
        block: import("./model.js").MetaMaskGaslessBlock;
        observed_at: string;
        rpc_origin: string;
        endpoint_hash: string;
        sender_native_balance_required: boolean;
        proof_class: string;
    }>;
    prepare(input: Parameters<MetaMaskGaslessPreparation["prepare"]>[0]): Promise<import("./operation-model.js").MetaMaskGaslessPublicOperation>;
    approve(operationId: string): Promise<import("./operation-model.js").MetaMaskGaslessPublicOperation>;
    resume(operationId: string): Promise<import("./operation-model.js").MetaMaskGaslessPublicOperation>;
    status(operationId: string): Promise<import("./operation-model.js").MetaMaskGaslessPublicOperation>;
    receipt(operationId: string): Promise<import("./operation-model.js").MetaMaskGaslessReceipt>;
    private project;
    private dependencies;
    private execution;
    private locked;
}
