import { ApnError } from "../errors.js";
import { RelayRetirementRepository, RelayUnsignedOperationRepository } from "../relay-unsigned-operation.js";
import { verifyDepositObservation } from "./deposit-effect.js";
import { proveRelayBnbDestination } from "./destination-proof.js";
import { RelayEffectJournalRepository } from "./effect-journal.js";
import { RelayKeylessStatusService } from "./status.js";
import { BNB_NATIVE, ETHEREUM_USDC } from "./quote.js";
import { RelayNativeObserveService } from "./native-observe.js";
const OPERATION = /^[a-f0-9]{64}$/u;
/** No signer, send, or retry surface is reachable here. */
export class RelayObserveService {
    state;
    source;
    status;
    native;
    usedBnbInvocations = new WeakSet();
    /** The factory must return a fresh budgeted BNB adapter for each observation. */
    bnbInvocation;
    constructor(state, source, bnbInvocation, status = new RelayKeylessStatusService(state), native) {
        this.state = state;
        this.source = source;
        this.status = status;
        this.native = native;
        this.bnbInvocation = bnbInvocation;
    }
    async observe(operationId) {
        if (!OPERATION.test(operationId))
            throw new ApnError("APN_INVALID_INPUT", "Relay observe requires an operation ID.");
        const op = await new RelayUnsignedOperationRepository(this.state.root).findOperation(operationId);
        if (op === null)
            throw new ApnError("APN_OPERATION_NOT_FOUND", "Relay operation was not found.");
        if (await new RelayRetirementRepository(this.state.root).load(op) !== null)
            throw new ApnError("APN_OPERATION_BLOCKED", "Relay operation is retired.");
        if (op.nativeQuote !== undefined) {
            if (this.native === undefined)
                throw new ApnError("APN_PROVIDER_CAPABILITY_UNAVAILABLE", "Relay native observer is unavailable.");
            return this.native.observe(op);
        }
        const quote = op.quote;
        if (op.sourceChainId !== 1 || op.destinationChainId !== 56 || quote === undefined ||
            op.nativeQuote !== undefined || quote.paymentDetails?.chainId !== "ethereum" ||
            quote.paymentDetails.currency.toLowerCase() !== ETHEREUM_USDC.toLowerCase() ||
            quote.orderData?.output?.chainId !== "bnb" || quote.orderData.output.payments.length !== 1 ||
            quote.orderData.output.payments[0]?.currency.toLowerCase() !== BNB_NATIVE.toLowerCase())
            throw new ApnError("APN_OPERATION_BLOCKED", "Relay observe supports only the saved Ethereum USDC to BNB lane.", { reason: "relay_observe_unsupported_lane" });
        const result = (state, reason, sourceFinalized = false, providerStatus = null, providerStatusBound = false, destinationProof = null) => ({
            operationId, state, reason, sourceFinalized,
            providerStatus, providerStatusBound, destinationProof, causalLinkCryptographicallyProven: false,
            paidAcceptance: false, operationalAcceptance: state === "operational_acceptance",
        });
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
            observation = await this.source.finalizedDeposit(sourceHash);
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
        if (op.statusLocator === undefined)
            return result("source_finalized", "status_locator_missing", true);
        let provider;
        try {
            provider = await this.status.status(operationId);
        }
        catch {
            return result("source_finalized", "provider_status_unavailable_or_ambiguous", true);
        }
        const sourceBound = provider.chainIdentityObserved && provider.inTxHashes.includes(sourceHash.toLowerCase());
        // One candidate fits the strict eight-POST budget. Multiple provider hashes
        // are ambiguous here; selecting one could silently ignore a competing payout.
        if (provider.txHashes.length > 1)
            return result("provider_candidate_unproven", "multiple_provider_candidates", true, provider.status, sourceBound);
        const candidateHashes = provider.txHashes;
        if (candidateHashes.length === 0)
            return result("source_finalized", "provider_candidate_missing", true, provider.status, sourceBound);
        const bnb = this.bnbInvocation();
        if (this.usedBnbInvocations.has(bnb))
            throw new ApnError("APN_RPC_BUDGET_EXCEEDED", "Relay observe requires a fresh BNB RPC budget for each invocation.");
        this.usedBnbInvocations.add(bnb);
        const proof = await proveRelayBnbDestination({ operation: op, sourceDeposit: {
                transactionHash: sourceHash, observation
            }, candidateHashes }, bnb);
        if (proof.status !== "recipient_credit_proven")
            return result("provider_candidate_unproven", proof.reason, true, provider.status, sourceBound, proof);
        if (provider.status !== "success" || !sourceBound)
            return result("recipient_credit_observed", "provider_success_or_source_binding_unproven", true, provider.status, sourceBound, proof);
        return result("operational_acceptance", "source_finalized_provider_success_and_safe_recipient_credit", true, provider.status, true, proof);
    }
}
//# sourceMappingURL=observe.js.map