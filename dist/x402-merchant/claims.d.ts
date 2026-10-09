import { SecureStateStore } from "../secure-state-store.js";
import type { MerchantOperation } from "./model.js";
export declare class MerchantClaims extends SecureStateStore {
    private binding;
    assertUnused(o: MerchantOperation): Promise<void>;
    requireSign(o: MerchantOperation): Promise<void>;
    /** Independent create-only/fsynced records survive restoring only the operation and usage journals. */
    claim(o: MerchantOperation, effect: "sign" | "send", txHash?: string | null): Promise<void>;
}
