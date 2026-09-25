/** Read-only Base native credit observation. A provider candidate is not an order-causal link. */
import { ApnError } from "../errors.js";
import { RelayRetirementRepository, RelayUnsignedOperationRepository } from "../relay-unsigned-operation.js";
import { proveRelayBaseDestination } from "./destination-proof.js";
import { RelayKeylessStatusService } from "./status.js";
export class RelayBaseObserveService {
    state;
    destinationInvocation;
    status;
    usedInvocations = new WeakSet();
    constructor(state, destinationInvocation, status = new RelayKeylessStatusService(state)) {
        this.state = state;
        this.destinationInvocation = destinationInvocation;
        this.status = status;
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
        const result = (state, reason, providerStatus = null, destinationProof = null) => ({
            operationId, state, reason, providerStatus, destinationProof, sourceFinalized: false,
            causalLinkCryptographicallyProven: false, paidAcceptance: false, operationalAcceptance: false,
        });
        if (op.statusLocator === undefined)
            return result("prepared_waiting", "status_locator_missing");
        let provider;
        try {
            provider = await this.status.status(operationId);
        }
        catch {
            return result("provider_candidate_unproven", "provider_status_unavailable_or_ambiguous");
        }
        if (!provider.chainIdentityObserved || provider.txHashes.length !== 1)
            return result("provider_candidate_unproven", "provider_chain_or_candidate_ambiguous", provider.status);
        const destination = this.destinationInvocation();
        if (this.usedInvocations.has(destination))
            throw new ApnError("APN_RPC_BUDGET_EXCEEDED", "Relay Base observe requires a fresh RPC budget.");
        this.usedInvocations.add(destination);
        const proof = await proveRelayBaseDestination(op, provider.txHashes, destination);
        if (proof.status !== "recipient_credit_proven")
            return result("provider_candidate_unproven", proof.reason, provider.status, proof);
        return result("recipient_credit_observed", "safe_base_native_credit_without_order_causality", provider.status, proof);
    }
}
//# sourceMappingURL=base-observe.js.map