import { type Hex } from "viem";
export interface Cleanup85NativeAuthority {
    assert(binding: string, policyExpiresAt: string): void;
    beforeSend(binding: string, raw: Hex, hash: Hex): () => void;
}
export declare function assertCleanup85PhysicalGuard(guard: (() => void) | undefined, raw: unknown): asserts guard is () => void;
/** A foreground controller must hold the real owner/custody/policy locks throughout work.
 * No JSON request, journal or recovery sidecar can reconstruct this ephemeral authority. */
export declare function withCleanup85NativeAuthority<T>(binding: string, expiresAt: string, now: () => number, confirm: () => Promise<void>, work: (authority: Cleanup85NativeAuthority) => Promise<T>): Promise<T>;
