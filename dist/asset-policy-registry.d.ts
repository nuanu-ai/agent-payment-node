export declare const ASSET_POLICY_REGISTRY_SCHEMA: "apn.asset-policy-registry.v1";
export type AssetPolicyChainFamily = "evm" | "solana" | "tron";
export type AssetPolicyRail = "direct" | "gasless" | "x402" | "bridge" | "swap";
export interface AssetRailAdmission {
    readonly direct: boolean;
    readonly gasless: boolean;
    readonly x402: boolean;
    readonly bridge: boolean;
    readonly swap: boolean;
}
export interface AssetAtomicCaps {
    readonly maximumPerTransferAtomic: string;
    readonly dailyLimitAtomic: string;
}
export interface AssetPolicyRow {
    readonly kind: "native" | "token";
    /** Null is the only native identity. Token identities are canonical contract or mint addresses. */
    readonly identifier: string | null;
    readonly symbol: string;
    readonly decimals: number;
    readonly rails: AssetRailAdmission;
    readonly caps: AssetAtomicCaps;
    readonly mechanismPins?: Readonly<Partial<Record<"gasless" | "x402" | "bridge", Readonly<{
        provider: string;
        reference: string;
    }>>>>;
}
export interface AssetPolicyChain {
    /** Exact network identity: eip155 chain ID, Solana genesis hash, or TRON genesis block ID. */
    readonly chain: string;
    readonly family: AssetPolicyChainFamily;
    readonly name: string;
    readonly assets: readonly AssetPolicyRow[];
}
export interface AssetPolicyRegistry {
    readonly schemaVersion: typeof ASSET_POLICY_REGISTRY_SCHEMA;
    readonly registryVersion: string;
    readonly publishedAt: string;
    readonly effectiveDate: string;
    /** Optional exact instant boundary used by compiled allowlist overlays. */
    readonly effectiveAt?: string;
    readonly expiresAt?: string;
    readonly chains: readonly AssetPolicyChain[];
    readonly policyDigest: string;
}
export type UnsignedAssetPolicyRegistry = Omit<AssetPolicyRegistry, "policyDigest">;
export interface AssetPolicyEvaluationInput {
    readonly chain: string;
    readonly asset: Readonly<{
        kind: "native";
        identifier: null;
    } | {
        kind: "token";
        identifier: string;
    }>;
    readonly rail: AssetPolicyRail;
    readonly amountAtomic: string;
    /** Already charged or reserved for this asset in the applicable UTC owner day. */
    readonly dailyUsageAtomic: string;
    /** Explicit UTC policy date keeps evaluation deterministic and testable. */
    readonly asOfDate: string;
    /** Required when the registry carries exact instant boundaries. */
    readonly asOf?: string;
}
export interface AssetPolicyAdmission {
    readonly admitted: true;
    readonly policyDigest: string;
    readonly registryVersion: string;
    readonly effectiveDate: string;
    readonly chain: string;
    readonly family: AssetPolicyChainFamily;
    readonly asset: AssetPolicyRow;
    readonly rail: AssetPolicyRail;
    readonly amountAtomic: string;
    readonly dailyUsageAtomic: string;
    readonly dailyRemainingAtomic: string;
}
export declare function assetPolicyDigest(value: UnsignedAssetPolicyRegistry): string;
export declare function sealAssetPolicyRegistry(value: UnsignedAssetPolicyRegistry): AssetPolicyRegistry;
export declare function validateAssetPolicyRegistry(value: unknown): AssetPolicyRegistry;
/** Shared fail-closed evaluator for future CLI and MCP admission surfaces. */
export declare function evaluateAssetPolicy(registryValue: unknown, input: AssetPolicyEvaluationInput): AssetPolicyAdmission;
