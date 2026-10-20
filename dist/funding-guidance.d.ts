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
    /** Owner limit of the selected asset from the exact chain+token policy (its native cap for native gas). */
    readonly assetLimit: string | undefined;
    readonly nativeLimit: string | undefined;
    /** The selected token's symbol from APN's frozen token list (USDC for a released pair); null when unlisted. */
    readonly tokenSymbol: string | null;
    /** Where native gas's cap is read: the one policy loaded, or, on a network with no implied token, each token's own policy. */
    readonly nativeScope: "policy" | "token_policies";
}
/** `wallet balance --chain --asset` advice: the selected asset follows its posture; a token read also applies the rule to native gas. */
export declare function selectedAssetFundingGuidance(input: SelectedAssetFunding): WalletFundingGuidance;
