import { SecureStateStore } from "../secure-state-store.js";
import { type MerchantOperation } from "./model.js";
export declare class MerchantRepository extends SecureStateStore {
    private path;
    findOperation(id: string): Promise<MerchantOperation | null>;
    listAllOperations(): Promise<MerchantOperation[]>;
    listOperations(profileHash: string): Promise<MerchantOperation[]>;
    /** Caller holds profile/operation/idempotency/account locks. Append continuity forbids resets or resend. */
    persist(o: MerchantOperation): Promise<void>;
}
