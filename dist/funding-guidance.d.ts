import type { ProfilePolicyRecord } from "./profile-policy.js";
export interface WalletFundingGuidance {
    readonly funding_guidance: {
        readonly action: string;
        readonly warning: string;
    };
    readonly next_actions: readonly string[];
}
/** Posture-aware funding advice: never suggests adding an asset that is at or above its owner limit. */
export declare function walletFundingGuidance(usdcAtomic: string, ethAtomic: string, policy: ProfilePolicyRecord | null, postureActions: readonly string[]): WalletFundingGuidance;
