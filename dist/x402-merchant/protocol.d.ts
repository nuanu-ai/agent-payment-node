import { type Hex } from "viem";
import type { HttpObservation } from "../x402-model.js";
import type { MerchantAssetPin } from "./asset-pins.js";
export interface MerchantChallenge {
    readonly x402Version: 2;
    readonly resource: Record<string, unknown>;
    readonly accepts: readonly Record<string, unknown>[];
    readonly error?: string;
    readonly extensions?: Record<string, unknown>;
}
export interface FrozenMerchantChallenge {
    readonly challenge: MerchantChallenge;
    readonly accepted: Record<string, unknown>;
    readonly challengeHash: string;
}
/** The merchant context a challenge, proof or delivery is checked against: the operation's URL and, for v2, its pinned asset. */
export interface MerchantContext {
    readonly url: string;
    readonly legacy: boolean;
    readonly asset: MerchantAssetPin;
}
/** `--url`: a credential-free public HTTPS URL in its canonical WHATWG form (the rule x402 fetch uses). */
export declare function canonicalMerchantUrl(value: unknown): string;
/** HTTPS from the exact URL, TLS-authorized, no redirects, bounded body. */
export declare function checkMerchantObservation(o: HttpObservation, url?: string): void;
/** Version 1 (frozen legacy table): exactly one x402engine USDm Bitcoin-price row. */
export declare function checkMerchantChallenge(value: unknown): FrozenMerchantChallenge;
/**
 * Any merchant (OD-2): exactly one `exact` row whose network and asset name a pinned asset. Payee, amount and asset come
 * from that row; the owner's admission (asset, mechanism, caps, optional recipient pin) bounds them. A row whose payment
 * window is shorter than APN's own 300-second local deadline is not payable and never matches.
 */
export declare function checkGenericMerchantChallenge(value: unknown, assets: readonly MerchantAssetPin[]): FrozenMerchantChallenge & {
    readonly asset: MerchantAssetPin;
};
/** Re-derive the frozen challenge from its stored body under the operation's own context; never from the current registry. */
export declare function checkChallengeFor(ctx: MerchantContext, value: unknown): FrozenMerchantChallenge;
/** The 402 challenge for the operation's URL; version 1 keeps the legacy reader. */
export declare function merchantChallenge(o: HttpObservation, ctx?: MerchantContext): FrozenMerchantChallenge;
/** A new merchant's 402: the single row naming any pinned asset selects the asset. */
export declare function merchantGenericChallenge(o: HttpObservation, url: string, assets: readonly MerchantAssetPin[]): FrozenMerchantChallenge & {
    readonly asset: MerchantAssetPin;
};
export declare function merchantProof(frozen: FrozenMerchantChallenge, txHash: Hex, ctx?: MerchantContext): string;
/** Version 1 delivery: HTTP 200 JSON with a finite positive Bitcoin USD price. */
export declare function merchantPrice(o: HttpObservation): Record<string, unknown>;
/**
 * Any merchant: delivery is HTTP 200 from the operation's URL. The bounded body is retained with its digest; a JSON body
 * (by media type, duplicate keys refused) is kept parsed, any other body as base64.
 */
export declare function merchantDelivery(o: HttpObservation, ctx: MerchantContext): Record<string, unknown>;
export declare function refuse(reason: string): never;
