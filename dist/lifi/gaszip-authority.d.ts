import { type Hex } from "viem";
export interface GaszipEffectBinding {
    readonly operationId: string;
    readonly profile: string;
    readonly owner: unknown;
    readonly providerBinding: unknown;
    readonly activationDigest?: string;
    readonly policyDigest: string;
    readonly policyRevision: number;
    readonly plan: unknown;
    readonly amountAtomic: string;
    readonly minimumOutputAtomic: string;
    readonly maximumFeeAtomic: string;
    readonly quoteDigest: string;
    readonly expiresAt: string;
}
export declare function gaszipEffectBinding(value: GaszipEffectBinding, lane: string): string;
export declare function assertGaszipPhysicalGuard(guard: (() => void) | undefined, raw: unknown): asserts guard is () => void;
export interface GaszipScopedAuthority {
    assert(binding: string, policyExpiresAt?: string): void;
    beforeSend(binding: string, raw: Hex, hash: Hex): () => void;
}
/** Constructor and grant state stay private; persisted operation metadata cannot mint this scope.
 * The caller supplies the trusted normal foreground flow, then disposes all capabilities on return. */
export declare function withGaszipForegroundAuthority<T>(binding: string, operationExpiresAt: string, now: () => number, confirm: () => Promise<void>, work: (authority: GaszipScopedAuthority) => Promise<T>): Promise<T>;
