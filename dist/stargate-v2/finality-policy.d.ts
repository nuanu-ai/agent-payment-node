export type StargateV2FinalityTag = "safe" | "finalized";
export declare const STARGATE_V2_FINALITY_POLICY_VERSION: "apn.stargate-v2-finality.v1";
declare const TAG_BY_CHAIN: Readonly<{
    readonly 1: "safe";
    readonly 10: "safe";
    readonly 130: "safe";
    readonly 137: "finalized";
    readonly 8453: "safe";
    readonly 42161: "safe";
    readonly 43114: "safe";
}>;
export interface StargateV2ChainFinalityPolicy {
    readonly chainId: keyof typeof TAG_BY_CHAIN;
    readonly blockTag: StargateV2FinalityTag;
}
export interface StargateV2RouteFinalityPolicy {
    readonly version: typeof STARGATE_V2_FINALITY_POLICY_VERSION;
    readonly source: StargateV2ChainFinalityPolicy;
    readonly destination: StargateV2ChainFinalityPolicy;
}
export declare function stargateV2ChainFinalityPolicy(chainId: number): StargateV2ChainFinalityPolicy;
export declare function stargateV2RouteFinalityPolicy(sourceChainId: number, destinationChainId: number): StargateV2RouteFinalityPolicy;
export declare function assertStargateV2RouteFinalityPolicy(value: unknown, sourceChainId: number, destinationChainId: number): asserts value is StargateV2RouteFinalityPolicy;
export {};
