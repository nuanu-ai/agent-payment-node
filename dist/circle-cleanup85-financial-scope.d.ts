import type { Cleanup85CancellationRequest } from "./circle-cleanup85-cancellation-contract.js";
import type { StateStore } from "./state.js";
export interface HeldCleanup85Scope {
    readonly kind: "held-cleanup85-financial-scope";
}
export declare function assertHeldCleanup85Scope(token: HeldCleanup85Scope, state: StateStore, request: Cleanup85CancellationRequest, operationId: string): void;
/** Metadata and locks only. No nonce, policy TTL, reservation or financial authority. */
export declare function withCleanup85FinancialScope<T>(state: StateStore, request: Cleanup85CancellationRequest, operationId: string, action: (scope: HeldCleanup85Scope) => Promise<T>): Promise<T>;
export declare function withCleanup85UnsignedRetirementScope<T>(state: StateStore, request: Cleanup85CancellationRequest, action: (scope: HeldCleanup85Scope) => Promise<T>): Promise<T>;
