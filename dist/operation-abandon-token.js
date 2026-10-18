import { ApnError } from "./errors.js";
/**
 * R4 exit 3, the last resort for a token operation no proof decided (Stargate token bridge, Uniswap token swap): once
 * its own deadline passed (nothing new is signed after it), the owner's TTY consent closes it `abandoned_unknown` and
 * the operation index releases the account; the usage ledger stays as it is (charged). Nothing is signed: a signed
 * approval, send or cleanup may still land, and a residual allowance may remain, which the consent states. The record is
 * re-read under its lock and must not have changed while the owner confirmed.
 */
export async function abandonTokenOperation(operationId, subject, approve) {
    const required = async () => {
        const record = await subject.load();
        if (record === null)
            throw new ApnError("APN_OPERATION_NOT_FOUND", subject.missing);
        return record;
    };
    const initial = await required();
    if (initial.phase === "abandoned_unknown")
        return initial;
    if (subject.terminal(initial)) {
        throw new ApnError("APN_OPERATION_BLOCKED", `The ${subject.noun} is already terminal; there is nothing to abandon.`, { reason: "operation_already_terminal" });
    }
    const refusal = subject.refusal(initial);
    if (refusal !== null)
        throw refusal;
    const facts = subject.facts(initial);
    await approve({ operationId, fingerprint: initial.integrityHash, profile: initial.profile, providerId: "local", walletAddress: facts.walletAddress,
        recipient: facts.recipient, amountAtomic: facts.amountAtomic, amountDecimal: facts.amountAtomic, chainLabel: facts.chainLabel,
        assetLabel: facts.assetLabel, unit: "atomic units",
        outcomeNote: `Financial outcome: UNKNOWN (phase ${initial.phase}).${facts.pending.length === 0 ? "" : ` Signed transaction(s) ${facts.pending.join(", ")} may still land.`}` +
            ` An allowance to ${facts.allowanceTo} may remain; the usage hold stays charged.` });
    return await subject.withLock(initial, async () => {
        const current = await required();
        if (current.phase === "abandoned_unknown")
            return current;
        if (current.integrityHash !== initial.integrityHash) {
            throw new ApnError("APN_STATE_BUSY", `The ${subject.noun} changed while the abandonment was confirmed; run it again.`, { reason: subject.changedReason });
        }
        return await subject.close(current);
    });
}
//# sourceMappingURL=operation-abandon-token.js.map