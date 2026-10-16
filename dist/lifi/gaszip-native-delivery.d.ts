import { type Hex } from "viem";
interface Helpers {
    fail(reason: string): never;
    object(v: unknown): Record<string, unknown>;
    uint(v: unknown): bigint;
    quantity(v: unknown): bigint;
    hash(v: unknown): Hex;
    address(v: unknown): string;
    exact(v: Record<string, unknown>, required: readonly string[], optional?: readonly string[]): void;
}
export interface GaszipNativeDelivery {
    readonly hash: Hex;
    readonly amount: string;
    readonly signer: string;
    readonly nonce: string;
    readonly providerDigest: string;
    readonly grossNative?: true;
}
/** The provider says this exact deposit (or its outbound payout) was cancelled or refunded: a terminal destination failure. */
export interface GaszipProviderFailure {
    readonly providerFailure: "provider_cancelled" | "provider_refund";
    readonly providerDigest: string;
}
/** Exact boolean refund/cancelled flags; any other value is malformed. */
export declare function gaszipProviderFlags(row: Record<string, unknown>, fail: (reason: string) => never): GaszipProviderFailure["providerFailure"] | null;
/**
 * Only the fully observed native EOA API schema. Legacy responses use their existing parser. The deposit binding is checked
 * first; a cancelled or refunded deposit or payout is then a terminal provider failure, and the owner's floor is applied by
 * the caller after the payout is proved on chain (`floor` stays the structural minimum, 0 for the caller's own check).
 */
export declare function inspectGaszipNativeDelivery(value: unknown, sourceHash: Hex, owner: string, amount: string, sourceBlock: string | undefined, chain: 1329 | 4326, short: 246 | 514, floor: bigint, h: Helpers): GaszipNativeDelivery | GaszipProviderFailure | null;
/** Observed type-0 EIP-155 native payouts only. Reconstruct signed bytes before trusting the gross/net equation. */
export declare function gaszipNativeNet(tv: unknown, d: GaszipNativeDelivery, owner: string, chain: 1329 | 4326, floor: bigint, h: Helpers): Promise<string>;
/** Status refusals keep code and reason, and name the public operation, observer phase and the only same-operation step. */
export declare function gaszipObservationRefusal(error: unknown, operationId: string, phase: string, statusCommand: string): never;
export {};
