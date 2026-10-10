import { type AssetUsageIdentity } from "../asset-usage-ledger.js";
import type { StateStore } from "../state.js";
import type { MerchantOperation, MerchantReceipt } from "./model.js";
export declare const merchantUsageIdentity: AssetUsageIdentity;
export declare const merchantNativeUsageIdentity: AssetUsageIdentity;
export declare function merchantUsageKey(id: string): string;
export declare function merchantNativeUsageKey(id: string): string;
export declare class MerchantOwner {
    private readonly state;
    private readonly now;
    private readonly policyLocked;
    private readonly ledger;
    constructor(state: StateStore, now: () => Date, policyLocked?: boolean);
    withPolicyLock<T>(profile: string, action: (owner: MerchantOwner) => Promise<T>): Promise<T>;
    private active;
    private evaluate;
    admit(profile: string, operation?: MerchantOperation, nativeAmount?: string): Promise<{
        digest: string;
        revision: number;
        activationDigest: string;
    }>;
    effectBinding(profile: string, nativeAmountAtomic: string, expiresAt: string): Promise<{
        nativeAmountAtomic: string;
        policyEndsAt: string;
    }>;
    confirm(o: MerchantOperation): Promise<void>;
    reserve(o: MerchantOperation): Promise<void>;
    held(o: MerchantOperation): Promise<{
        token: string;
        native: string;
    }>;
    follow(o: MerchantOperation, target: "unknown_finality" | "finalized" | "failed_confirmed_revert", freshReceipt?: MerchantReceipt): Promise<void>;
}
