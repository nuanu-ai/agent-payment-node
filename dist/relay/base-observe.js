/** Base observation and idempotent finalized source reconciliation; no signer or sender is reachable. */
import { ApnError } from "../errors.js";
import { getAddress } from "viem";
import { AssetUsageLedger, assetUsageReservationId } from "../asset-usage-ledger.js";
import { RelayRetirementRepository, RelayUnsignedOperationRepository } from "../relay-unsigned-operation.js";
import { proveRelayBaseDestination } from "./destination-proof.js";
import { RelayEffectJournalRepository } from "./effect-journal.js";
import { verifyDepositObservation } from "./deposit-effect.js";
import { RelayKeylessStatusService } from "./status.js";
import { ETHEREUM_USDC } from "./quote.js";
export class RelayBaseObserveService {
    state;
    destinationInvocation;
    status;
    source;
    usage;
    usedInvocations = new WeakSet();
    constructor(state, destinationInvocation, status = new RelayKeylessStatusService(state), source, usage = new AssetUsageLedger(state.root)) {
        this.state = state;
        this.destinationInvocation = destinationInvocation;
        this.status = status;
        this.source = source;
        this.usage = usage;
    }
    async reconcileFinalizedSource(op, sourceHash) {
        return this.state.withLocks([`relay-base-source-reconcile:${op.operationId}`], async () => {
            const effects = new RelayEffectJournalRepository(this.state.root);
            let journal = await effects.load(op.profileHash, op.operationId);
            if (journal === null || journal.effects[0].phase !== "confirmed")
                return false;
            const deposit = journal.effects[1];
            if (deposit.attempt?.attemptNumber !== 1 || deposit.attempt.transactionHash !== sourceHash ||
                !["submitting", "tx_known", "confirmed"].includes(deposit.phase))
                return false;
            const identity = { account: getAddress(op.sourceAccount), chain: "eip155:1",
                asset: { kind: "token", identifier: ETHEREUM_USDC } };
            const reservationId = assetUsageReservationId(identity, `relay-execute:${op.operationId}`);
            const reservation = await this.usage.load(identity, reservationId);
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
                await this.usage.transition({ ...identity, reservationId,
                    policyDigest: op.policyDigest, state: "finalized", outcomeDigest: journal.integrityHash, now: at,
                    expectedCurrentStates: ["submitted"] });
            return true;
        });
    }
    async observe(operationId) {
        if (!/^[a-f0-9]{64}$/u.test(operationId))
            throw new ApnError("APN_INVALID_INPUT", "Relay Base observe requires an operation ID.");
        const op = await new RelayUnsignedOperationRepository(this.state.root).findOperation(operationId);
        if (op === null)
            throw new ApnError("APN_OPERATION_NOT_FOUND", "Relay operation was not found.");
        if (await new RelayRetirementRepository(this.state.root).load(op) !== null)
            throw new ApnError("APN_OPERATION_BLOCKED", "Relay operation is retired.");
        if (op.sourceChainId !== 1 || op.destinationChainId !== 8453 || op.quote?.routeReference !== "ethereum-usdc-base-eth-v1")
            throw new ApnError("APN_OPERATION_BLOCKED", "Relay Base observe requires a saved Base route.");
        const result = (state, reason, providerStatus = null, destinationProof = null, sourceFinalized = false, providerStatusBound = false, sourceUsageFinalized = false, sourceDepositHash = null) => ({
            operationId, state, reason, providerStatus, destinationProof, sourceFinalized, providerStatusBound,
            sourceUsageFinalized, sourceDepositHash,
            causalLinkCryptographicallyProven: false, paidAcceptance: false,
            operationalAcceptance: state === "operational_acceptance",
        });
        const journal = await new RelayEffectJournalRepository(this.state.root).load(op.profileHash, operationId);
        const deposit = journal?.effects[1];
        const sourceHash = journal?.effects[0].phase === "confirmed" &&
            deposit?.attempt?.attemptNumber === 1 &&
            ["submitting", "tx_known", "confirmed"].includes(deposit.phase)
            ? deposit.attempt.transactionHash : null;
        let sourceFinalized = false;
        if (sourceHash && this.source) {
            try {
                const observation = await this.source.finalizedDeposit(sourceHash);
                sourceFinalized = observation !== null && verifyDepositObservation(op, sourceHash, observation) === "confirmed";
            }
            catch {
                sourceFinalized = false;
            }
        }
        const usageBound = sourceFinalized && sourceHash ? await this.reconcileFinalizedSource(op, sourceHash) : false;
        if (op.statusLocator === undefined)
            return result("prepared_waiting", "status_locator_missing");
        let provider;
        try {
            provider = await this.status.status(operationId);
        }
        catch {
            return result("provider_candidate_unproven", "provider_status_unavailable_or_ambiguous");
        }
        const sourceBound = sourceHash !== null && sourceHash !== undefined && provider.inTxHashes.includes(sourceHash.toLowerCase());
        if (!provider.chainIdentityObserved || provider.txHashes.length !== 1)
            return result("provider_candidate_unproven", "provider_chain_or_candidate_ambiguous", provider.status, null, sourceFinalized, sourceBound);
        const destination = this.destinationInvocation();
        if (this.usedInvocations.has(destination))
            throw new ApnError("APN_RPC_BUDGET_EXCEEDED", "Relay Base observe requires a fresh RPC budget.");
        this.usedInvocations.add(destination);
        const proof = await proveRelayBaseDestination(op, provider.txHashes, destination);
        if (proof.status !== "recipient_credit_proven")
            return result("provider_candidate_unproven", proof.reason, provider.status, proof, sourceFinalized, sourceBound);
        if (sourceFinalized && sourceBound && usageBound && provider.status === "success" &&
            proof.proof.method === "verified_relay_router_event_balance")
            return result("operational_acceptance", "source_finalized_provider_bound_safe_base_recipient_credit", provider.status, proof, true, true, true, sourceHash);
        return result("recipient_credit_observed", "safe_base_native_credit_without_complete_source_binding", provider.status, proof, sourceFinalized, sourceBound, usageBound, sourceHash ?? null);
    }
}
//# sourceMappingURL=base-observe.js.map