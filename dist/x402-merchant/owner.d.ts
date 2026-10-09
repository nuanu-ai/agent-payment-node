import { type AssetUsageIdentity } from "../asset-usage-ledger.js";
import type { StateStore } from "../state.js";
import type { MerchantOperation } from "./model.js";
export declare const merchantUsageIdentity: AssetUsageIdentity;
export declare function merchantUsageKey(id: string): string;
export declare class MerchantOwner {
    private readonly state;
    private readonly now;
    private readonly ledger;
    constructor(state: StateStore, now: () => Date);
    admit(profile: string, operation?: MerchantOperation): Promise<{
        digest: string;
        revision: number;
        activationDigest: string;
    }>;
    confirm(o: MerchantOperation): Promise<void>;
    reserve(o: MerchantOperation): Promise<void>;
    follow(o: MerchantOperation, target: "unknown_finality" | "finalized" | "failed_confirmed_revert"): Promise<void>;
}
