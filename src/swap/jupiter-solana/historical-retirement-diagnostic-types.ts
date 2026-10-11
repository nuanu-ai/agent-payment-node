import type { JupiterFutureInvalidityReason } from "./canonical-future-invalidity.js";

export type HistoricalRetirementStage = "frame" | "custody_authentication" | "signed_material_verification" | "canonical_proof" | "accounting_admission" | "publication";
export interface HistoricalRetirementDiagnostic { readonly stage: HistoricalRetirementStage; readonly reason: JupiterFutureInvalidityReason | "stage_refused" }
const REASONS: readonly string[] = ["invalid_input", "invalid_signed_wire", "unsupported_message_version", "unsigned_wire", "unresolved_alt_program", "durable_nonce", "ambiguous_nonce_instruction", "quote_lifetime_mismatch", "rpc_identity_invalid", "rpc_proof_failed", "read_budget_exhausted", "deadline_exceeded", "caller_aborted", "wrong_genesis", "empty_or_missing_history", "archive_data_missing", "birth_not_found", "duplicate_birth_match", "finalized_history_mismatch", "malformed_rpc_result", "reanchor_failed", "processing_age_not_exceeded", "quote_lifetime_not_exceeded", "blockhash_still_valid", "signature_status_reported"];
/** Closed public constants only; never inspect or stringify an exception. */
export function safeCanonicalRetirementReason(reason: unknown): JupiterFutureInvalidityReason | "stage_refused" {
  return typeof reason === "string" && REASONS.includes(reason) ? reason as JupiterFutureInvalidityReason : "stage_refused";
}
