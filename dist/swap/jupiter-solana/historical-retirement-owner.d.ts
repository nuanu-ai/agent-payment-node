import { type ActiveAssetPolicy } from "../../allowlist-active-policy.js";
import type { RailSignedEffect } from "../../direct-rail-ports.js";
import type { SwapOperationRecord } from "../model.js";
import { type JupiterV1ExecutionBinding } from "./v1-effects.js";
import type { JupiterV1PreparedMaterial, JupiterV1ResolvedMaterial } from "./v1-material.js";
import type { HistoricalJupiterProjection } from "./historical-projection-reader.js";
import { HistoricalReadState } from "./historical-authentication-readers.js";
declare const AUTHORITY: unique symbol;
export interface OwnedJupiterHistoricalRetirementAuthority {
    readonly [AUTHORITY]: true;
}
/** Internal data sent only to the statically bound, token-gated consumer. Never a public return value. */
export interface OwnedJupiterHistoricalRetirementContext {
    readonly state: HistoricalReadState;
    readonly operation: SwapOperationRecord;
    readonly material: JupiterV1PreparedMaterial;
    readonly fresh: JupiterV1ResolvedMaterial;
    readonly binding: JupiterV1ExecutionBinding;
    readonly effect: RailSignedEffect;
    readonly projection: HistoricalJupiterProjection;
    readonly activePolicy: ActiveAssetPolicy;
    readonly deadline: string;
}
/** Separate conservative accounting result; this is not a swap receipt or actual-expense proof. */
export interface JupiterHistoricalRetirementPublicResult {
    readonly operationId: string;
    readonly profile: "solana-local";
    readonly status: "retired_unknown";
    readonly retirementRecordHash: string;
    readonly accountingAt: string;
    readonly conservativeNativeAmount: "6000000";
    readonly additionalAdmissionNativeAmount: "5000000";
    readonly effectAt: null;
    readonly actualNativeFee: null;
    readonly transactionOutcome: "unknown";
    readonly transactionMayHaveBeenSubmitted: true;
    readonly idempotentRecovered: boolean;
}
/** Assertion only: no wire/material getter, callback, DTO issuer or caller-selected phase. */
export declare function claimOwnedJupiterRetirementScope(token: OwnedJupiterHistoricalRetirementAuthority, context: OwnedJupiterHistoricalRetirementContext): Promise<void>;
/** C2 must call at every canonical-read, policy and commit seam while the original fixed locks remain held. */
export declare function assertOwnedJupiterRetirementScope(token: OwnedJupiterHistoricalRetirementAuthority, context: OwnedJupiterHistoricalRetirementContext): Promise<void>;
/** Production-owned entry: only a root and exact fixed operation can be selected; custody/consumer are hardcoded. */
export declare function executeJupiterHistoricalRetirement(operationId: string, root: string): Promise<JupiterHistoricalRetirementPublicResult>;
export {};
