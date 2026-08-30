import type { RpcPort, X402RpcBlock, X402RpcPort } from "./ports.js";
import type { ProviderX402OperationRecord, ProviderX402SettlementEvidence } from "./provider-x402-model.js";
export type ProviderSettlementObservation = {
    readonly kind: "pending";
} | {
    readonly kind: "ambiguous";
    readonly reason: string;
    readonly upperBlock?: X402RpcBlock;
} | {
    readonly kind: "verified";
    readonly upperBlock: X402RpcBlock;
    readonly evidence: ProviderX402SettlementEvidence;
};
export declare function providerX402ReadPort(rpc: RpcPort): X402RpcPort;
export declare function captureProviderEvidenceLowerBlock(rpc: X402RpcPort): Promise<{
    readonly lowerBlock: Awaited<ReturnType<X402RpcPort["getX402Head"]>>;
    readonly rpcOriginHash: string;
}>;
export declare function observeProviderSettlement(operation: ProviderX402OperationRecord, rpc: X402RpcPort): Promise<ProviderSettlementObservation>;
