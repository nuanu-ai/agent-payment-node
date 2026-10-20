/** Idempotent reconciliation of a finality-proven Ethereum USDC Relay deposit; no signer or sender is reachable. */
import { getAddress } from "viem";
import { assetUsageReservationId } from "../asset-usage-ledger.js";
import { RelayEffectJournalRepository } from "./effect-journal.js";
import { ETHEREUM_USDC } from "./quote.js";
/**
 * The caller proved `sourceHash` (the deposit's first and only attempt, after a confirmed approval) final and canonical on
 * Ethereum. The deposit journal records it confirmed and the exact submitted usage hold is finalized under that journal,
 * exactly as an observation-only `relay execute` would, without asking the owner to authorize an effect that already
 * happened. Anything else (another hash, an unconfirmed approval, a hold in another state or binding) changes nothing and
 * answers false, so the caller cannot claim more than the saved state supports.
 */
export async function reconcileRelayFinalizedSource(state, usage, op, sourceHash) {
    return state.withLocks([`relay-source-reconcile:${op.operationId}`], async () => {
        const effects = new RelayEffectJournalRepository(state.root);
        let journal = await effects.load(op.profileHash, op.operationId);
        if (journal === null || journal.effects[0].phase !== "confirmed")
            return false;
        const deposit = journal.effects[1];
        if (deposit.attempt?.attemptNumber !== 1 || deposit.attempt.transactionHash !== sourceHash ||
            !["submitting", "confirmed"].includes(deposit.phase))
            return false;
        const identity = { account: getAddress(op.sourceAccount), chain: "eip155:1",
            asset: { kind: "token", identifier: ETHEREUM_USDC } };
        const reservationId = assetUsageReservationId(identity, `relay-execute:${op.operationId}`);
        const reservation = await usage.load(identity, reservationId);
        if (reservation === null || !["submitted", "finalized"].includes(reservation.state) ||
            reservation.policyDigest !== op.policyDigest || reservation.amountAtomic !== op.amountAtomic ||
            reservation.rail !== "bridge" ||
            (reservation.state === "finalized" && (deposit.phase !== "confirmed" ||
                reservation.outcomeDigest !== journal.integrityHash)))
            return false;
        const at = new Date(Math.max(Date.now(), Date.parse(deposit.attempt.markedAt), Date.parse(reservation.updatedAt)));
        if (deposit.phase !== "confirmed")
            journal = await effects.transition(op.profileHash, op.operationId, journal.integrityHash, { kind: "observe", role: "deposit", outcome: "confirmed", at: at.toISOString() });
        if (reservation.state === "submitted")
            await usage.transition({ ...identity, reservationId,
                policyDigest: op.policyDigest, state: "finalized", outcomeDigest: journal.integrityHash, now: at,
                expectedCurrentStates: ["submitted"] });
        return true;
    });
}
//# sourceMappingURL=source-reconcile.js.map