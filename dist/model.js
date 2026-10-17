/** Every state a direct transfer record (local or provider) may hold. */
export const DIRECT_OPERATION_STATES = [
    "awaiting_approval", "started", "provider_pending", "provider_acknowledged", "evidence_pending", "ambiguous_effect",
    "signed_not_submitted", "submitted_pending", "unknown_finality", "abandoned_unknown", "completed", "failed_before_effect",
    "failed_provider_rejected", "failed_confirmed_revert", "failed_proven_superseded",
];
/** The outcomes of a local direct transfer; its record's `terminal` flag must equal membership (evm-direct.ts). */
export const LOCAL_DIRECT_TERMINAL_STATES = [
    "completed", "failed_before_effect", "failed_confirmed_revert", "failed_proven_superseded", "abandoned_unknown",
];
/** The outcomes of a provider direct transfer; its record's `terminal` flag must equal membership (state-integrity.ts). */
export const PROVIDER_DIRECT_TERMINAL_STATES = [
    "abandoned_unknown", "completed", "failed_before_effect", "failed_provider_rejected", "failed_confirmed_revert",
];
//# sourceMappingURL=model.js.map