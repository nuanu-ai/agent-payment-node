import type { RuntimeContext } from "./runtime.js";
/** Caller holds the profile lock; this precedes every potentially mutating wallet action. */
export declare function assertWalletLifecycleAvailable(context: RuntimeContext, profileHash: string): Promise<void>;
/**
 * Read-only wallet commands never wait for money operations. While one is in flight they still answer,
 * but skip profile upkeep (migration saves, permission activation, drift saves) that could move a frozen revision.
 */
export declare function walletLifecycleMutable(context: RuntimeContext, profileHash: string): Promise<boolean>;
