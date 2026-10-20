/** Base observation and idempotent finalized source reconciliation; no signer or sender is reachable. */
import { ApnError } from "../errors.js";
import type { Hex } from "viem";
import { AssetUsageLedger } from "../asset-usage-ledger.js";
import { allowlistProfileHash } from "../allowlist-policy-overlay.js";
import { RelayRetirementRepository, RelayUnsignedOperationRepository } from "../relay-unsigned-operation.js";
import type { StateStore } from "../state.js";
import { proveRelayBaseDestination, type RelayBnbProofPorts } from "./destination-proof.js";
import { RelayEffectJournalRepository } from "./effect-journal.js";
import { verifyDepositObservation } from "./deposit-effect.js";
import type { RelaySourceFinalityPorts } from "./observe.js";
import { reconcileRelayFinalizedSource } from "./source-reconcile.js";
import { RelayKeylessStatusService } from "./status.js";

export class RelayBaseObserveService {
  private readonly usedInvocations = new WeakSet<RelayBnbProofPorts>();
  constructor(private readonly state: StateStore, private readonly destinationInvocation: () => RelayBnbProofPorts,
    private readonly status = new RelayKeylessStatusService(state),
    private readonly source?: RelaySourceFinalityPorts,
    private readonly usage: Pick<AssetUsageLedger, "load" | "transition"> = new AssetUsageLedger(state.root)) {}

  /** The operation is found only under the caller's explicit profile (OWNR 4.1). */
  async observe(profile: string, operationId: string) {
    if (!/^[a-f0-9]{64}$/u.test(operationId)) throw new ApnError("APN_INVALID_INPUT", "Relay Base observe requires an operation ID.");
    allowlistProfileHash(profile);
    const op = await new RelayUnsignedOperationRepository(this.state.root).loadOperation(this.state.profileHash(profile), operationId);
    if (op === null) throw new ApnError("APN_OPERATION_NOT_FOUND", "Relay operation was not found for this profile.");
    if (await new RelayRetirementRepository(this.state.root).load(op) !== null)
      throw new ApnError("APN_OPERATION_BLOCKED", "Relay operation is retired.");
    if (op.sourceChainId !== 1 || op.destinationChainId !== 8453 || op.quote?.routeReference !== "ethereum-usdc-base-eth-v1")
      throw new ApnError("APN_OPERATION_BLOCKED", "Relay Base observe requires a saved Base route.");
    const result = (state: "prepared_waiting" | "provider_candidate_unproven" | "recipient_credit_observed" | "operational_acceptance", reason: string,
      providerStatus: string | null = null, destinationProof: Awaited<ReturnType<typeof proveRelayBaseDestination>> | null = null,
      sourceFinalized = false, providerStatusBound = false, sourceUsageFinalized = false,
      sourceDepositHash: string | null = null) => ({
      operationId, state, reason, providerStatus, destinationProof, sourceFinalized, providerStatusBound,
      sourceUsageFinalized, sourceDepositHash, sourceObservationReason,
      causalLinkCryptographicallyProven: false as const, paidAcceptance: false as const,
      operationalAcceptance: state === "operational_acceptance",
    });
    const journal = await new RelayEffectJournalRepository(this.state.root).load(op.profileHash, operationId);
    const deposit = journal?.effects[1];
    const sourceHash = journal?.effects[0].phase === "confirmed" &&
      deposit?.attempt?.attemptNumber === 1 &&
      ["submitting", "confirmed"].includes(deposit.phase)
      ? deposit.attempt.transactionHash : null;
    // Fixed, non-sensitive reasons distinguish an RPC failure from a pending or
    // mismatched source proof. Never return the RPC error or transaction payload.
    let sourceObservationReason = sourceHash === null ? "source_effect_not_recorded" :
      this.source === undefined ? "source_observer_unavailable" : "source_observation_pending";
    let sourceFinalized = false;
    if (sourceHash && this.source) {
      let observation: Awaited<ReturnType<RelaySourceFinalityPorts["finalizedDeposit"]>>;
      try {
        observation = await this.source.finalizedDeposit(sourceHash as Hex);
      } catch { sourceObservationReason = "source_rpc_unavailable"; observation = null; }
      if (observation !== null) {
        try {
          sourceFinalized = verifyDepositObservation(op, sourceHash as Hex, observation) === "confirmed";
          sourceObservationReason = sourceFinalized ? "source_finalized" : "source_deposit_reverted";
        } catch { sourceObservationReason = "source_identity_mismatch"; }
      }
    }
    const usageBound = sourceFinalized && sourceHash ? await reconcileRelayFinalizedSource(this.state, this.usage, op, sourceHash) : false;
    if (op.statusLocator === undefined) return result("prepared_waiting", "status_locator_missing");
    let provider: Awaited<ReturnType<RelayKeylessStatusService["status"]>>;
    try { provider = await this.status.statusOf(op); }
    catch { return result("provider_candidate_unproven", "provider_status_unavailable_or_ambiguous"); }
    const sourceBound = sourceHash !== null && sourceHash !== undefined && provider.inTxHashes.includes(sourceHash.toLowerCase());
    if (!provider.chainIdentityObserved || provider.txHashes.length !== 1)
      return result("provider_candidate_unproven", "provider_chain_or_candidate_ambiguous", provider.status,
        null, sourceFinalized, sourceBound);
    const destination = this.destinationInvocation();
    if (this.usedInvocations.has(destination)) throw new ApnError("APN_RPC_BUDGET_EXCEEDED", "Relay Base observe requires a fresh RPC budget.");
    this.usedInvocations.add(destination);
    const proof = await proveRelayBaseDestination(op, provider.txHashes, destination);
    if (proof.status !== "recipient_credit_proven") return result("provider_candidate_unproven", proof.reason, provider.status,
      proof, sourceFinalized, sourceBound);
    if (sourceFinalized && sourceBound && usageBound && provider.status === "success" &&
      proof.proof.method === "relay_router_event")
      return result("operational_acceptance", "source_finalized_provider_bound_safe_base_recipient_credit",
        provider.status, proof, true, true, true, sourceHash);
    return result("recipient_credit_observed", "safe_base_native_credit_without_complete_source_binding",
      provider.status, proof, sourceFinalized, sourceBound, usageBound, sourceHash ?? null);
  }
}
