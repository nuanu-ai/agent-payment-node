import type { ChainAccount, ChainAsset, ChainAssetAlias, DirectRailName } from "./direct-rail-ports.js";
import type { RailOperationRecord } from "./rail-operation-model.js";
export declare const SOLANA_GENESIS = "5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d";
export declare const SOLANA_USDC = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
export interface ChainPolicy {
    readonly schemaVersion: "apn.chain-policy.v1";
    readonly account: ChainAccount;
    readonly asset: ChainAsset;
    readonly networkIdentity: string;
    readonly maximumPerTransferAtomic: string;
    readonly dailyLimitAtomic: string;
    readonly maximumNativeFeeAtomic: string;
    readonly admittedAt: string;
    readonly policyHash: string;
}
export interface ChainPolicyApprovalPort {
    approve(policy: ChainPolicy): Promise<void>;
}
export declare function chainAsset(rail: DirectRailName, alias: ChainAssetAlias): ChainAsset;
export declare function validateChainAsset(value: unknown): ChainAsset;
export declare function atomic(value: unknown, positive?: boolean): bigint;
export declare function chainDecimal(value: string, decimals: number): string;
export declare function chainDisplay(value: string, decimals: number): string;
export declare function isoDate(value: unknown): asserts value is string;
export declare function sealChainPolicy(value: Omit<ChainPolicy, "policyHash">): ChainPolicy;
export declare function validateChainPolicy(value: unknown): ChainPolicy;
/** Nonterminal reservations remain charged even across a UTC-day boundary. */
export declare function chainUsage(policy: ChainPolicy, operations: readonly RailOperationRecord[], now: Date, excluding?: string): {
    principalAtomic: string;
    nativeFeeAtomic: string;
};
export declare function assertChainPolicy(policy: ChainPolicy, account: ChainAccount, asset: ChainAsset, amount: string, maximumFee: string, operations: readonly RailOperationRecord[], now: Date, excluding?: string): void;
