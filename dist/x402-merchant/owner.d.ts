import { type AssetUsageIdentity } from "../asset-usage-ledger.js";
import type { StateStore } from "../state.js";
import type { MerchantOperation, MerchantReceipt } from "./model.js";
import { type MerchantTerms } from "./terms.js";
/** The payer's token usage bucket; the payer is the operation's own custody wallet. */
export declare function merchantUsageIdentity(t: Pick<MerchantTerms, "payer" | "chain" | "token">): AssetUsageIdentity;
/** The payer's native fee bucket on the payment chain. */
export declare function merchantNativeUsageIdentity(t: Pick<MerchantTerms, "payer" | "chain">): AssetUsageIdentity;
export declare function merchantUsageKey(id: string): string;
export declare function merchantNativeUsageKey(id: string): string;
export declare class MerchantOwner {
    private readonly state;
    private readonly now;
    private readonly policyLocked;
    private readonly ledger;
    constructor(state: StateStore, now: () => Date, policyLocked?: boolean);
    withPolicyLock<T>(profile: string, action: (owner: MerchantOwner) => Promise<T>): Promise<T>;
    /** Before any merchant request: the profile has an active policy naming the payer as its EVM account. */
    assertPayerPolicy(profile: string, payer: string): Promise<void>;
    /** The profile's active policy, whose EVM account must be the payer (custody of the same profile). */
    private active;
    private evaluate;
    /** Token and (when given) native fee admission of `terms` under the profile's active policy. */
    admit(profile: string, terms: MerchantTerms, operation?: MerchantOperation, nativeAmount?: string): Promise<{
        digest: string;
        revision: number;
        activationDigest: string;
    }>;
    effectBinding(profile: string, terms: MerchantTerms, nativeAmountAtomic: string, expiresAt: string): Promise<{
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
