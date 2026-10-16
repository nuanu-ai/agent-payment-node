import { ArbitrumSourceEffectJournalRepository } from "./arbitrum-source-effect-journal.js";
import { RelayEffectJournalRepository } from "./effect-journal.js";
import { RelayNativeSourceJournalRepository } from "./native-source.js";
/** Each lane records a finality-proven revert as `failed`; nothing is resent after it, and its usage hold is released. */
export async function relaySourceTerminal(root, op) {
    if (op.arbitrumDraft !== undefined) {
        const journal = await new ArbitrumSourceEffectJournalRepository(root).load(op.profileHash, op.operationId);
        if (journal === null)
            return null;
        if (journal.effects[1].phase === "confirmed")
            return { state: "source_confirmed", journalIntegrityHash: journal.integrityHash };
        return journal.effects.some(effect => effect.phase === "failed")
            ? { state: "failed_confirmed_revert", journalIntegrityHash: journal.integrityHash } : null;
    }
    if (op.nativeQuote !== undefined) {
        const journal = await new RelayNativeSourceJournalRepository(root).load(op);
        if (journal?.phase === "confirmed")
            return { state: "source_confirmed", journalIntegrityHash: journal.integrityHash };
        return journal?.phase === "failed" ? { state: "failed_confirmed_revert", journalIntegrityHash: journal.integrityHash } : null;
    }
    const journal = await new RelayEffectJournalRepository(root).load(op.profileHash, op.operationId);
    if (journal === null)
        return null;
    if (journal.effects[1].phase === "confirmed")
        return { state: "source_confirmed", journalIntegrityHash: journal.integrityHash };
    return journal.effects.some(effect => effect.phase === "failed")
        ? { state: "failed_confirmed_revert", journalIntegrityHash: journal.integrityHash } : null;
}
//# sourceMappingURL=lifecycle.js.map