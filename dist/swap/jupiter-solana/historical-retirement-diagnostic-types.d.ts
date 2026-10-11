import type { JupiterFutureInvalidityReason } from "./canonical-future-invalidity.js";
export type HistoricalRetirementStage = "frame" | "custody_authentication" | "signed_material_verification" | "canonical_proof" | "accounting_admission" | "publication";
export interface HistoricalRetirementDiagnostic {
    readonly stage: HistoricalRetirementStage;
    readonly reason: JupiterFutureInvalidityReason | "stage_refused";
}
/** Closed public constants only; never inspect or stringify an exception. */
export declare function safeCanonicalRetirementReason(reason: unknown): JupiterFutureInvalidityReason | "stage_refused";
