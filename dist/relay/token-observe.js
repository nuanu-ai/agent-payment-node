import { AssetUsageLedger } from "../asset-usage-ledger.js";
import { ApnError } from "../errors.js";
import { verifyDepositObservation } from "./deposit-effect.js";
import { RelayDestinationClaimRepository } from "./destination-claim.js";
import { proveRelayTokenDestination } from "./destination-proof.js";
import { RelayEffectJournalRepository } from "./effect-journal.js";
import { reconcileRelayFinalizedSource } from "./source-reconcile.js";
import { RelayKeylessStatusService } from "./status.js";
import { verifySavedRelayTokenQuote } from "./token-quote.js";
const same = (a, b) => a.toLowerCase() === b.toLowerCase();
export class RelayTokenObserveService {
    state;
    source;
    destination;
    status;
    usage;
    usedInvocations = new WeakSet();
    /** Each factory returns a fresh budgeted reader for the named chain: the source chain, then the destination chain. */
    constructor(state, source, destination, status = new RelayKeylessStatusService(state), usage = new AssetUsageLedger(state.root)) {
        this.state = state;
        this.source = source;
        this.destination = destination;
        this.status = status;
        this.usage = usage;
    }
    /** The caller loaded `op` under its explicit profile and checked its retirement marker. */
    async observe(op) {
        const operationId = op.operationId;
        const result = (state, reason, sourceFinalized = false, providerStatus = null, providerStatusBound = false, destinationProof = null) => ({
            operationId, state, reason, sourceFinalized, providerStatus, providerStatusBound, destinationProof,
            causalLinkCryptographicallyProven: false, paidAcceptance: false, operationalAcceptance: state === "operational_acceptance"
        });
        if (op.tokenQuote === undefined || op.statusLocator === undefined)
            throw new ApnError("APN_OPERATION_BLOCKED", "Relay token observation requires a saved token-route quote.", { reason: "relay_observe_unsupported_lane" });
        let route;
        try {
            route = await verifySavedRelayTokenQuote(op.tokenQuote);
        }
        catch {
            throw new ApnError("APN_OPERATION_BLOCKED", "Relay token observation is blocked.", { reason: "saved_token_quote_authority" });
        }
        if (op.sourceChainId !== route.source.chainId || op.destinationChainId !== route.destination.chainId)
            throw new ApnError("APN_OPERATION_BLOCKED", "Relay token observation is blocked.", { reason: "saved_token_route_binding" });
        const journal = await new RelayEffectJournalRepository(this.state.root).load(op.profileHash, operationId);
        if (journal === null)
            return result("prepared_waiting", "source_journal_missing");
        const approval = journal.effects[0], deposit = journal.effects[1];
        if (approval.phase !== "confirmed")
            return result("approval_pending", `approval_${approval.phase}`);
        if (deposit.phase === "pending" || deposit.attempt?.transactionHash === null)
            return result("deposit_pending", `deposit_${deposit.phase}`);
        const sourceHash = deposit.attempt?.transactionHash;
        if (sourceHash === undefined)
            return result("deposit_pending", "deposit_hash_missing");
        let observation;
        try {
            observation = await this.source(route.source.chainId).finalizedDeposit(sourceHash);
        }
        catch {
            return result("source_unproven", "source_rpc_unavailable");
        }
        if (observation === null)
            return result("source_unproven", "source_not_finalized_or_noncanonical");
        try {
            if (verifyDepositObservation(op, sourceHash, observation) !== "confirmed")
                return result("source_unproven", "source_receipt_failed");
        }
        catch {
            return result("source_unproven", "source_receipt_binding_failed");
        }
        // The final deposit closes the source attempt (journal confirmed, hold finalized) whatever the destination shows.
        const sourceSettled = await reconcileRelayFinalizedSource(this.state, this.usage, op, sourceHash) || deposit.phase === "confirmed";
        let provider;
        try {
            provider = await this.status.statusOf(op);
        }
        catch {
            return result("source_finalized", "provider_status_unavailable_or_ambiguous", true);
        }
        const sourceBound = provider.chainIdentityObserved && provider.inTxHashes.length === 1 && same(provider.inTxHashes[0], sourceHash);
        if (provider.txHashes.length !== 1)
            return result(provider.txHashes.length === 0 ? "source_finalized" : "provider_candidate_unproven", provider.txHashes.length === 0 ? "provider_candidate_missing" : "multiple_provider_candidates", true, provider.status, sourceBound);
        const destination = this.destination(route.destination.chainId);
        if (this.usedInvocations.has(destination))
            throw new ApnError("APN_RPC_BUDGET_EXCEEDED", "Relay token observe requires a fresh destination RPC budget.");
        this.usedInvocations.add(destination);
        const proof = await proveRelayTokenDestination(op, sourceHash, provider.txHashes, destination);
        if (proof.status !== "recipient_credit_proven")
            return result("provider_candidate_unproven", proof.reason, true, provider.status, sourceBound, proof);
        if (provider.status !== "success" || !sourceBound)
            return result("recipient_credit_observed", "provider_success_or_source_binding_unproven", true, provider.status, sourceBound, proof);
        if (!sourceSettled)
            return result("recipient_credit_observed", "source_journal_unreconciled", true, provider.status, true, proof);
        // One payout accepts one operation (create-only claim), as on every other Relay lane.
        try {
            await new RelayDestinationClaimRepository(this.state.root).claimTokenRoute(op, sourceHash, proof.proof);
        }
        catch {
            return result("provider_candidate_unproven", "destination_payout_claim_conflict", true, provider.status, true, proof);
        }
        return result("operational_acceptance", "source_final_provider_success_and_safe_recipient_credit", true, provider.status, true, proof);
    }
}
//# sourceMappingURL=token-observe.js.map