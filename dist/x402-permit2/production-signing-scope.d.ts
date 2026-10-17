import { StateStore } from "../state.js";
import { AllowlistPolicyStore } from "../allowlist-policy-store.js";
import { decodePermit2WalletBinding } from "./owner-binding.js";
import { type Permit2MetadataMode, type Permit2SavedIdentity } from "./production-signing-owner.js";
import { type Permit2ProductionRecord, type Permit2ProductionRepository } from "./production-repository.js";
type Context = {
    readonly record: Permit2ProductionRecord;
    readonly mode: Permit2MetadataMode;
    readonly keys: readonly string[];
    readonly close: Set<() => void>;
    time?: {
        readonly policy: Awaited<ReturnType<AllowlistPolicyStore["readUnderProfileLock"]>>;
        readonly wallet: ReturnType<typeof decodePermit2WalletBinding>;
        readonly used: string;
    };
};
/** Lives only inside Permit2MetadataLockOwner.within, while its metadata locks are held; it carries no key, approval,
 * signature or transport authority, only the lexical fact that those locks are held. */
export declare class Permit2MetadataLockScope {
    #private;
    readonly kind: "permit2-metadata-lock-scope";
    constructor(owner: Permit2MetadataLockOwner, context: Context);
    static held(scope: unknown, owner: Permit2MetadataLockOwner): Context;
    static exit(scope: Permit2MetadataLockScope): void;
}
/** An actual metadata lock callback only. No key, approval, signature or transport authority. */
export declare class Permit2MetadataLockOwner {
    #private;
    constructor(state: StateStore, records: Permit2ProductionRepository);
    within<T>(id: string, mode: Permit2MetadataMode, clock: () => Date, action: (scope: Permit2MetadataLockScope) => Promise<T>): Promise<T>;
    assert(scope: Permit2MetadataLockScope, id: string, mode: Permit2MetadataMode): void;
    assertTime(scope: Permit2MetadataLockScope, id: string, mode: Permit2MetadataMode, at: Date): void;
    onExit(scope: Permit2MetadataLockScope, id: string, mode: Permit2MetadataMode, close: () => void): () => void;
    owner(scope: Permit2MetadataLockScope, id: string, mode: Permit2MetadataMode, clock: () => Date, expected?: Permit2SavedIdentity): Promise<{
        record: Permit2ProductionRecord;
        lease: import("../asset-usage-ledger-types.js").AssetUsageReservation;
    }>;
}
export {};
