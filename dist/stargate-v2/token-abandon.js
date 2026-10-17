import { ApnError } from "../errors.js";
import { STARGATE_TOKEN_TRANSITIONS, transition } from "./token-journal.js";
/**
 * R4 exit 3, the last resort: the owner closes a token Stargate journal that no proof decided, once its prepare expiry
 * passed (no new effect is signed after it), with TTY consent. The journal becomes `abandoned_unknown` and the operation
 * index releases the account; the usage ledger stays as it is (charged). Nothing is signed: a signed approval, send or
 * cleanup may still land, and a residual allowance may remain, which the consent states.
 */
export async function abandonStargateV2Token(id, journal, approve, now) {
    const initial = await required(journal, id);
    if (initial.phase === "abandoned_unknown")
        return initial;
    eligible(initial, now());
    const pending = [initial.approvalTransactionHash, initial.transactionHash, initial.cleanupTransactionHash].filter(hash => hash !== undefined);
    await approve({ operationId: id, fingerprint: initial.integrityHash, profile: initial.profile, providerId: "local", walletAddress: initial.owner,
        recipient: initial.recipient, amountAtomic: initial.amountAtomic, amountDecimal: initial.amountAtomic, chainLabel: "eip155:10",
        assetLabel: `USDC ${initial.sourceToken}`, unit: "atomic units",
        outcomeNote: `Financial outcome: UNKNOWN (phase ${initial.phase}).${pending.length === 0 ? "" : ` Signed transaction(s) ${pending.join(", ")} may still land.`}` +
            " An allowance to the Stargate pool may remain; the usage hold stays charged." });
    return await journal.withOwnerLock(initial.owner, async () => await journal.withLock(id, async () => {
        const current = await required(journal, id);
        if (current.phase === "abandoned_unknown")
            return current;
        if (current.integrityHash !== initial.integrityHash) {
            throw new ApnError("APN_STATE_BUSY", "The Stargate token journal changed while the abandonment was confirmed; run it again.", { reason: "stargate_token_abandon_changed" });
        }
        const abandoned = transition(current, "abandoned_unknown", "owner_abandoned_unknown", now());
        await journal.save(abandoned);
        return abandoned;
    }));
}
function eligible(op, at) {
    if (STARGATE_TOKEN_TRANSITIONS[op.phase].length === 0) {
        throw new ApnError("APN_OPERATION_BLOCKED", "The Stargate token journal is already terminal; there is nothing to abandon.", { reason: "operation_already_terminal" });
    }
    // A pending ledger transition is settled by `apn stargate token status` first, so the abandoned journal keeps a settled hold.
    if (at < Date.parse(op.expiresAt) || op.usageTarget !== undefined) {
        throw new ApnError("APN_OPERATION_BLOCKED", "Only a token Stargate journal past its prepare expiry, with no pending ledger step, can be abandoned.", { reason: "stargate_token_abandon_not_eligible", expiresAt: op.expiresAt });
    }
}
async function required(journal, id) {
    const op = await journal.load(id);
    if (op === null)
        throw new ApnError("APN_OPERATION_NOT_FOUND", "Stargate token operation was not found.");
    return op;
}
//# sourceMappingURL=token-abandon.js.map