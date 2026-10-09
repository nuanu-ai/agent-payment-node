import { type Hex } from "viem";
import type { HttpObservation } from "../x402-model.js";
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
export declare function checkMerchantObservation(o: HttpObservation): void;
export declare function checkMerchantChallenge(value: unknown): FrozenMerchantChallenge;
export declare function merchantChallenge(o: HttpObservation): FrozenMerchantChallenge;
export declare function merchantProof(frozen: FrozenMerchantChallenge, txHash: Hex): string;
export declare function merchantPrice(o: HttpObservation): Record<string, unknown>;
export declare function refuse(reason: string): never;
