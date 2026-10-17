import { ArbitrumSourceEffectJournalRepository } from "./arbitrum-source-effect-journal.js";
import { RelayEffectJournalRepository } from "./effect-journal.js";
import { RelayNativeSourceJournalRepository } from "./native-source-journal.js";
const NATIVE_OUTCOMES = { confirmed: "source_confirmed",
    failed: "failed_confirmed_revert", failed_before_effect: "failed_before_effect", abandoned_unsent: "failed_before_effect" };
/** The native lane's outcome by its journal phase: every phase with no transition out is one (failed_before_effect: nothing signed). */
export function relayNativeSourceOutcome(phase) { return NATIVE_OUTCOMES[phase] ?? null; }
/** A two-effect lane (approval, then deposit): a confirmed deposit, or either effect never landed or reverted. */
export function relayEffectsOutcome(effects) {
    if (effects[1]?.phase === "confirmed")
        return "source_confirmed";
    if (effects.some(effect => effect.phase === "abandoned_unsent"))
        return "failed_before_effect";
    return effects.some(effect => effect.phase === "failed") ? "failed_confirmed_revert" : null;
}
/** Each lane records a finality-proven revert as `failed`; nothing is resent after it, and its usage hold is released. */
export async function relaySourceTerminal(root, op) {
    const journal = op.arbitrumDraft !== undefined ? await new ArbitrumSourceEffectJournalRepository(root).load(op.profileHash, op.operationId)
        : op.nativeQuote !== undefined ? await new RelayNativeSourceJournalRepository(root).load(op)
            : await new RelayEffectJournalRepository(root).load(op.profileHash, op.operationId);
    if (journal === null)
        return null;
    const state = "effects" in journal ? relayEffectsOutcome(journal.effects) : relayNativeSourceOutcome(journal.phase);
    return state === null ? null : { state, journalIntegrityHash: journal.integrityHash };
}
//# sourceMappingURL=lifecycle.js.map