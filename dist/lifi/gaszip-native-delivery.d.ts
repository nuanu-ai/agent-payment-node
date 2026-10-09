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
/** Only the fully observed native EOA API schema. Legacy responses use their existing parser. */
export declare function inspectGaszipNativeDelivery(value: unknown, sourceHash: Hex, owner: string, amount: string, sourceBlock: string | undefined, chain: 1329 | 4326, short: 246 | 514, floor: bigint, h: Helpers): GaszipNativeDelivery | null;
/** Observed type-0 EIP-155 native payouts only. Reconstruct signed bytes before trusting the gross/net equation. */
export declare function gaszipNativeNet(tv: unknown, d: GaszipNativeDelivery, owner: string, chain: 1329 | 4326, floor: bigint, h: Helpers): Promise<string>;
export {};
