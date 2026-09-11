import type { Address, Hex } from "../model.js";
import type { MetaMaskGaslessBalance, MetaMaskGaslessBinding, MetaMaskGaslessChainId, MetaMaskGaslessCursor, MetaMaskGaslessExecutions, MetaMaskGaslessIntent, MetaMaskGaslessProfileIdentity, MetaMaskGaslessProviderObservation, MetaMaskGaslessQuote, MetaMaskGaslessRpcObservation, MetaMaskGaslessSnapshot, MetaMaskGaslessUnsignedResult } from "./model.js";
import type { MetaMaskGaslessOperationRecord, MetaMaskGaslessReceipt } from "./operation-model.js";
export interface MetaMaskGaslessQuoteInput {
    readonly binding: MetaMaskGaslessBinding;
    readonly chainId: MetaMaskGaslessChainId;
    readonly token: Address;
    readonly recipient: Address;
    readonly netAtomic: string;
    /** Exact configured endpoint. This private field never enters the public DTO or journal. */
    readonly rpcUrl: string;
}
export interface MetaMaskGaslessUnsignedInput {
    readonly owner: Address;
    readonly chainId: MetaMaskGaslessChainId;
    readonly executions: MetaMaskGaslessExecutions;
}
export interface MetaMaskGaslessProviderPort {
    inspect(expected: MetaMaskGaslessProfileIdentity): Promise<MetaMaskGaslessBinding>;
    quote(input: MetaMaskGaslessQuoteInput): Promise<MetaMaskGaslessQuote>;
    buildUnsigned(input: MetaMaskGaslessUnsignedInput): Promise<MetaMaskGaslessUnsignedResult>;
    submit(intent: MetaMaskGaslessIntent): Promise<MetaMaskGaslessProviderObservation>;
    observe(intent: MetaMaskGaslessIntent): Promise<MetaMaskGaslessProviderObservation>;
}
export interface MetaMaskGaslessRpcPort {
    readonly chainId: MetaMaskGaslessChainId;
    readonly endpointOrigin: string;
    readonly endpointHash: string;
    readonly rpcUrl: string;
    balance(owner: Address): Promise<MetaMaskGaslessBalance>;
    snapshot(input: {
        readonly owner: Address;
        readonly delegationHash: Hex;
        readonly grossAtomic: string;
    }): Promise<MetaMaskGaslessSnapshot>;
    observe(intent: MetaMaskGaslessIntent, cursor: MetaMaskGaslessCursor, provider: MetaMaskGaslessProviderObservation | null): Promise<MetaMaskGaslessRpcObservation>;
}
export type MetaMaskGaslessRpcFactory = (chainId: MetaMaskGaslessChainId) => MetaMaskGaslessRpcPort;
export interface MetaMaskGaslessApprovalPort {
    confirm(input: {
        readonly operationId: string;
        readonly fingerprint: string;
        readonly exactPhrase: string;
        readonly summary: Readonly<Record<string, unknown>>;
    }): Promise<boolean>;
}
export interface MetaMaskGaslessRepositoryPort {
    loadOperation(profileHash: string, operationId: string): Promise<MetaMaskGaslessOperationRecord | null>;
    findOperation(operationId: string): Promise<MetaMaskGaslessOperationRecord | null>;
    listOperations(profileHash: string): Promise<readonly MetaMaskGaslessOperationRecord[]>;
    listAllOperations(): Promise<readonly MetaMaskGaslessOperationRecord[]>;
    writeOperation(operation: MetaMaskGaslessOperationRecord): Promise<void>;
    persist(operation: MetaMaskGaslessOperationRecord): Promise<void>;
    repairReceipt(operation: MetaMaskGaslessOperationRecord): Promise<void>;
    loadReceipt(profileHash: string, operationId: string): Promise<MetaMaskGaslessReceipt>;
}
