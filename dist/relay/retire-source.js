/** What a Relay retirement may close: an untouched quote, or an abandoned route whose only sent effect is a confirmed approval. */
import { getAddress } from "viem";
import { hashObject } from "../canonical.js";
import { ApnError } from "../errors.js";
import { AssetUsageLedger, assetUsageReservationId } from "../asset-usage-ledger.js";
import { exactChainConsent } from "../tty-approval.js";
import { approvalCode } from "../approval-code.js";
import { ArbitrumSourceEffectJournalRepository } from "./arbitrum-source-effect-journal.js";
import { RELAY_ARBITRUM_USDC } from "./arbitrum-usdc-ethereum-quote.js";
import { RelayEffectJournalRepository } from "./effect-journal.js";
import { ETHEREUM_DEPOSITORY, ETHEREUM_USDC } from "./quote.js";
function blocked(reason) {
    throw new ApnError("APN_OPERATION_BLOCKED", "Relay retirement is refused for this source effect state.", { reason });
}
function hold(op) {
    const arbitrum = op.arbitrumDraft !== undefined;
    const identity = { account: getAddress(op.sourceAccount), chain: arbitrum ? "eip155:42161" : "eip155:1",
        asset: { kind: "token", identifier: arbitrum ? RELAY_ARBITRUM_USDC : ETHEREUM_USDC } };
    return { identity, reservationId: assetUsageReservationId(identity, `${arbitrum ? "relay-arbitrum-approval" : "relay-execute"}:${op.operationId}`) };
}
/** Token lanes only (Ethereum and Arbitrum). A signing marker, signed bytes, an unresolved send or a recorded
 * outcome is never retired here: those stay resumable, observable or are already terminal by proof. */
export async function relayRetireSource(root, op) {
    if (op.arbitrumDraft !== undefined) {
        const journal = await new ArbitrumSourceEffectJournalRepository(root).load(op.profileHash, op.operationId);
        if (journal === null || journal.effects.every(effect => effect.phase === "pending"))
            return { kind: "untouched", hold: hold(op), journalIntegrityHash: journal?.integrityHash ?? null };
        const [approval, deposit] = journal.effects;
        if (["confirmed", "approval_skipped"].includes(approval.phase) && deposit.phase === "pending")
            return { kind: "approval_only", hold: hold(op), journalIntegrityHash: journal.integrityHash };
        return blocked("source_effect_started_or_terminal");
    }
    const journal = await new RelayEffectJournalRepository(root).load(op.profileHash, op.operationId);
    if (journal === null || journal.effects.every(effect => effect.phase === "pending" && effect.attempt === null))
        return { kind: "untouched", hold: hold(op), journalIntegrityHash: journal?.integrityHash ?? null };
    if (journal.effects[0].phase === "confirmed" && journal.effects[1].phase === "pending" && journal.effects[1].attempt === null)
        return { kind: "approval_only", hold: hold(op), journalIntegrityHash: journal.integrityHash };
    return blocked("source_effect_started_or_terminal");
}
/** Release the principal hold: nothing moved the principal. Unknown or foreign hold states refuse. */
export async function releaseRelayHold(root, op, source, at) {
    const ledger = new AssetUsageLedger(root), current = await ledger.load(source.hold.identity, source.hold.reservationId);
    if (current === null || current.state === "failed_before_effect" || current.state === "released_unsubmitted" ||
        current.state === "failed_confirmed_revert" && current.consumedAtomic === undefined)
        return;
    const target = source.kind === "untouched" ? (current.state === "reserved" ? "failed_before_effect" : blocked("usage_hold_not_releasable")) :
        current.state === "reserved" || current.state === "unknown_finality" ? "released_unsubmitted" :
            current.state === "submitted" ? "failed_confirmed_revert" : blocked("usage_hold_not_releasable");
    await ledger.transition({ ...source.hold.identity, reservationId: source.hold.reservationId, policyDigest: op.policyDigest,
        state: target, expectedCurrentStates: [current.state], now: at,
        outcomeDigest: hashObject({ kind: "relay_retirement_hold_release", operationId: op.operationId, source: source.kind,
            journalIntegrityHash: source.journalIntegrityHash }) });
}
export function relayAbandonSummary(op, source) {
    return { operationId: op.operationId, sourceChainId: op.sourceChainId, sourceAccount: op.sourceAccount,
        token: op.arbitrumDraft !== undefined ? RELAY_ARBITRUM_USDC : ETHEREUM_USDC, spender: ETHEREUM_DEPOSITORY,
        approvedAtomic: op.amountAtomic, journalIntegrityHash: source.journalIntegrityHash };
}
/** Fresh foreground consent to abandon a route after its approval: the deposit is never sent afterwards. */
export class TtyRelayAbandonConfirmation {
    options;
    constructor(options = {}) {
        this.options = options;
    }
    async confirm(summary) {
        try {
            await exactChainConsent([
                "Agent Payment Node Relay route abandonment",
                `Operation: ${summary.operationId}`,
                `Source chain: eip155:${summary.sourceChainId}; account ${summary.sourceAccount}`,
                `The confirmed approval of ${summary.approvedAtomic} atomic of ${summary.token} to ${summary.spender} stays on chain.`,
                "No deposit is ever sent for this operation after this point; the principal hold is released.",
                `Source journal: ${summary.journalIntegrityHash}`,
            ], approvalCode("bridge", summary.operationId, summary.journalIntegrityHash, "abandon"), new Date(Date.now() + 60_000).toISOString(), this.options);
            return true;
        }
        catch (error) {
            if (error instanceof ApnError && error.code === "APN_NATIVE_REJECTED")
                return false;
            throw error;
        }
    }
}
//# sourceMappingURL=retire-source.js.map