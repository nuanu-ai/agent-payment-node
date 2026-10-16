import { type ProfilePolicyRecord } from "./profile-policy.js";
export interface WalletFundingGuidance {
    readonly funding_guidance: {
        readonly action: string;
        readonly warning: string;
    };
    readonly next_actions: readonly string[];
}
/** Posture-aware funding advice: never suggests adding an asset that is at or above its owner limit. */
export declare function walletFundingGuidance(usdcAtomic: string, ethAtomic: string, policy: ProfilePolicyRecord | null, postureActions: readonly string[]): WalletFundingGuidance;
export interface SelectedAssetFunding {
    readonly chainId: number;
    readonly kind: "native" | "erc20";
    readonly decimals: number;
    readonly nativeSymbol: string;
    readonly assetAtomic: bigint;
    readonly nativeAtomic: bigint;
    /** Owner limit of the selected asset: the network's ETH limit for native, its USDC limit for the x402 token. */
    readonly assetLimit: string | undefined;
    readonly nativeLimit: string | undefined;
    readonly x402Token: boolean;
}
/** `wallet balance-asset` advice: the selected asset follows its posture; a token read also applies the rule to native gas. */
export declare function selectedAssetFundingGuidance(input: SelectedAssetFunding): WalletFundingGuidance;
