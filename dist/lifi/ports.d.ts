import type { EvmChainId } from "../evm-asset.js";
import type { EvmFeeQuote } from "../evm-ports.js";
import type { Address, Hex } from "../model.js";
import type { FeeEstimate } from "../ports.js";
import type { BridgeOperationRecord } from "./operation-model.js";
import type { BridgeAccountSnapshot, BridgeBlock, BridgeDeploymentIdentity, BridgeEnvelope, BridgeOwner, BridgeProtocolReceipt, BridgeProviderObservation, BridgeRouteRequest, BridgeTool, BridgeTransaction, BridgeTransactionProof } from "./model.js";
export interface LifiResponse {
    readonly status: number;
    readonly body: string;
}
export interface LifiProviderPort {
    inventory(): Promise<Readonly<Record<"chains" | "tokens" | "tools" | "connections", LifiResponse>>>;
    routes(request: BridgeRouteRequest, sender: Address): Promise<LifiResponse>;
    materialize(step: Readonly<Record<string, unknown>>): Promise<LifiResponse>;
    status(input: {
        readonly transactionHash: Hex;
        readonly tool: BridgeTool;
        readonly fromChainId: EvmChainId;
        readonly toChainId: EvmChainId;
    }): Promise<BridgeProviderObservation>;
}
export interface BridgeRpcPort {
    readonly chainId: EvmChainId;
    readonly origin: string;
    assertChain(): Promise<void>;
    block(tag: "latest" | "safe" | string): Promise<BridgeBlock>;
    deployment(tool: BridgeTool, peerChainId: EvmChainId, block?: BridgeBlock): Promise<BridgeDeploymentIdentity>;
    account(owner: Address, spender: Address): Promise<BridgeAccountSnapshot>;
    prices(): Promise<Pick<FeeEstimate, "maxFeePerGasAtomic" | "maxPriorityFeePerGasAtomic">>;
    estimate(transaction: BridgeTransaction): Promise<FeeEstimate>;
    feeQuote(envelope: Pick<BridgeEnvelope, "economics">): Promise<EvmFeeQuote>;
    send(rawTransaction: Hex): Promise<Hex>;
    observe(transactionHash: Hex, expected?: BridgeEnvelope): Promise<{
        readonly transaction: BridgeTransactionProof;
        readonly receipt: BridgeProtocolReceipt;
    } | null>;
    logs(input: {
        readonly fromBlockAtomic: string;
        readonly toBlockAtomic: string;
        readonly address: Address;
        readonly topics: readonly (Hex | null)[];
    }): Promise<readonly {
        readonly transactionHash: Hex;
        readonly blockNumberAtomic: string;
        readonly blockHash: Hex;
    }[]>;
}
export type BridgeRpcFactory = (chainId: EvmChainId) => BridgeRpcPort;
export interface BridgeSealedMaterial {
    readonly schemaVersion: "apn.bridge-effect.v1";
    readonly profileHash: string;
    readonly operationId: string;
    readonly role: "approval" | "bridge";
    readonly fingerprint: string;
    readonly envelopeHash: string;
    readonly rawTransaction: Hex;
    readonly transactionHash: Hex;
    readonly materialHash: string;
}
export interface BridgeCustodyPort {
    load(operation: BridgeOperationRecord, role: "approval" | "bridge"): Promise<BridgeSealedMaterial | null>;
    seal(operation: BridgeOperationRecord, role: "approval" | "bridge", owner: BridgeOwner): Promise<BridgeSealedMaterial>;
}
export interface BridgeApprovalPort {
    confirm(input: {
        readonly operationId: string;
        readonly fingerprint: string;
        readonly exactPhrase: string;
        readonly summary: Readonly<Record<string, unknown>>;
    }): Promise<boolean>;
}
