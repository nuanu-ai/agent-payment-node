import type { RuntimeContext } from "./runtime.js";
/** Caller holds the profile lock; this precedes every potentially mutating wallet action. */
export declare function assertWalletLifecycleAvailable(context: RuntimeContext, profileHash: string): Promise<void>;
