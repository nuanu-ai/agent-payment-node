import type { PrivateKeyAccount } from "viem/accounts";
import type { DirectEffectMaterial } from "./encrypted-wallet-store.js";
import type { OperationRecord } from "./model.js";
import type { StateStore } from "./state.js";
/** Checks one canonical operation and exact signed bytes; it cannot read custody or submit. */
export declare function assertFreshDirectEffect(state: StateStore, operation: OperationRecord, effect: DirectEffectMaterial): Promise<void>;
/** Called inside Native's already-loaded custody context after its encrypted effect was saved. */
export declare function publishDirectPublicEffect(state: StateStore, operation: OperationRecord, effect: DirectEffectMaterial, account: PrivateKeyAccount): Promise<void>;
