import type { Hex } from "viem";
import { SecureStateStore } from "../../secure-state-store.js";
import type { TokenEffectKind } from "./token-execution.js";
import type { UniswapTokenOperation } from "./token-operation.js";
export type TokenEffectPhase = "sealed" | "send_started" | "send_accepted" | "send_ambiguous";
export interface TokenSignedEffect {
    readonly schemaVersion: "apn.uniswap-token-effect.v1";
    readonly operationId: string;
    readonly kind: TokenEffectKind;
    readonly markerHash: string;
    readonly envelopeHash: string;
    readonly transactionHash: Hex;
    readonly phase: TokenEffectPhase;
    readonly sendAttempts: 0 | 1;
    readonly createdAt: string;
    readonly updatedAt: string;
    readonly integrityHash: string;
}
export declare class UniswapTokenEffectJournal extends SecureStateStore {
    load(op: UniswapTokenOperation, kind: TokenEffectKind): Promise<TokenSignedEffect | null>;
    seal(op: UniswapTokenOperation, kind: TokenEffectKind, transactionHash: Hex, envelope: object, now: Date): Promise<TokenSignedEffect>;
    markStarted(op: UniswapTokenOperation, kind: TokenEffectKind, now: Date): Promise<TokenSignedEffect>;
    markOutcome(op: UniswapTokenOperation, kind: TokenEffectKind, phase: "send_accepted" | "send_ambiguous", now: Date): Promise<TokenSignedEffect>;
    private move;
    private path;
}
