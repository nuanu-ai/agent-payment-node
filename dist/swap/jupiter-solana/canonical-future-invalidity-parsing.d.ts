import type { JupiterFutureInvalidityInput, JupiterFutureInvalidityOriginalLifetime, JupiterFutureInvalidityReason } from "./canonical-future-invalidity.js";
/** Internal parsing only; no RPC or financial authority. */
export interface WireFacts {
    readonly transactionHash: string;
    readonly messageHash: string;
    readonly signatureHash: string;
    readonly signature: string;
    readonly blockhash: string;
}
export interface BlockHeader {
    readonly slot: bigint;
    readonly blockHeight: bigint;
    readonly blockhash: string;
    readonly parentSlot: bigint;
    readonly previousBlockhash: string;
}
export declare class Refusal extends Error {
    readonly reason: JupiterFutureInvalidityReason;
    constructor(reason: JupiterFutureInvalidityReason);
}
export declare function parseSignedWire(input: JupiterFutureInvalidityInput): WireFacts;
export declare function parseLifetime(value: JupiterFutureInvalidityOriginalLifetime): {
    readonly contextSlot: bigint;
    readonly blockhash: string;
    readonly lastValidBlockHeight: bigint | null;
};
export declare function parseHeader(value: unknown, slot: bigint): BlockHeader;
export declare function parseContextualBoolean(value: unknown, minimumSlot: bigint): boolean;
export declare function parseSignatureStatusObservation(value: unknown, minimumSlot: bigint): "not_reported" | "reported";
export declare function parseUnsignedRpc(value: unknown): bigint;
export declare function toSafeNumber(value: bigint): number;
export declare function validInputShape(value: unknown): value is JupiterFutureInvalidityInput;
export declare function safeInputHash(value: unknown): string;
