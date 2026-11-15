import type { Address, Hex } from "../model.js";
import type { MetaMaskGaslessBalance, MetaMaskGaslessBinding, MetaMaskGaslessChainId, MetaMaskGaslessCursor, MetaMaskGaslessExecutions, MetaMaskGaslessIntent, MetaMaskGaslessProfileIdentity, MetaMaskGaslessProviderIntent, MetaMaskGaslessProviderObservation, MetaMaskGaslessQuote, MetaMaskGaslessRpcObservation, MetaMaskGaslessSnapshot, MetaMaskGaslessUnsignedResult } from "./model.js";
import type { MetaMaskGaslessOperationRecord, MetaMaskGaslessReceipt } from "./operation-model.js";
import type { MmDeploymentView } from "./recorded.js";
import type { MetaMaskDisableCall } from "./revocation/call.js";
import type { MetaMaskRevocationChain } from "./revocation/chain.js";
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
    readonly feeMode?: "sponsored";
    /** A saved record's own frozen deployment; absent means today's registry, as when APN acts. */
    readonly deployment?: MmDeploymentView;
}
export interface MetaMaskGaslessProviderPort {
    inspect(expected: MetaMaskGaslessProfileIdentity): Promise<MetaMaskGaslessBinding>;
    quote(input: MetaMaskGaslessQuoteInput): Promise<MetaMaskGaslessQuote>;
    buildUnsigned(input: MetaMaskGaslessUnsignedInput): Promise<MetaMaskGaslessUnsignedResult>;
    submit(intent: MetaMaskGaslessProviderIntent): Promise<MetaMaskGaslessProviderObservation>;
    observe(intent: MetaMaskGaslessProviderIntent): Promise<MetaMaskGaslessProviderObservation>;
}
/** The operation a sealed provider request id belongs to, and the hash its intent keeps in place of the id. */
export interface MetaMaskGaslessRequestBinding {
    readonly profileHash: string;
    readonly operationId: string;
    readonly requestIdHash: string;
}
/**
 * Custody of the provider request id of an operation whose intent keeps only its hash
 * (journal/request-reference.ts): sealed once at prepare, opened only to send the request or to read its job.
 */
export interface MetaMaskGaslessRequestReferencePort {
    /**
     * Loads the wrapping secret, or creates the first one for a state that holds nothing sealed, before prepare reads the
     * provider or the chain: a missing secret or a refusing Keychain costs no provider read.
     */
    ready(): Promise<void>;
    seal(binding: MetaMaskGaslessRequestBinding, requestId: string): Promise<void>;
    open(binding: MetaMaskGaslessRequestBinding): Promise<string>;
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
        readonly feeMode?: "sponsored";
    }): Promise<MetaMaskGaslessSnapshot>;
    observe(intent: MetaMaskGaslessIntent, cursor: MetaMaskGaslessCursor, provider: MetaMaskGaslessProviderObservation | null): Promise<MetaMaskGaslessRpcObservation>;
    /** Chain facts for the owner's disable of this dispatched delegation (absent on observation-only test doubles). */
    revocation?(intent: MetaMaskGaslessIntent, disable: MetaMaskDisableCall, operationId: string): Promise<MetaMaskRevocationChain>;
    /** The delegator's native balance at the latest block, read again right before the disable is sent (atomic wei). */
    revocationBalance?(intent: MetaMaskGaslessIntent, disable: MetaMaskDisableCall): Promise<string>;
}
export type MetaMaskGaslessRpcFactory = (chainId: MetaMaskGaslessChainId) => MetaMaskGaslessRpcPort;
export type MetaMaskGaslessObservationRpcFactory = (chainId: MetaMaskGaslessChainId, environmentName: string) => MetaMaskGaslessRpcPort;
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
    loadReceipt(profileHash: string, operationId: string): Promise<MetaMaskGaslessReceipt>;
}
