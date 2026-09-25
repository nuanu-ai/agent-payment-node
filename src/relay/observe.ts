/** Read-only cross-chain evidence for one saved Ethereum USDC to BNB Relay operation. */
import type { Hex } from "viem";
import { ApnError } from "../errors.js";
import { RelayRetirementRepository, RelayUnsignedOperationRepository } from "../relay-unsigned-operation.js";
import type { StateStore } from "../state.js";
import { verifyDepositObservation, type RelayDepositObservation } from "./deposit-effect.js";
import { proveRelayBnbDestination, type RelayBnbProofPorts, type RelayBnbProofResult } from "./destination-proof.js";
import { RelayEffectJournalRepository } from "./effect-journal.js";
import { RelayKeylessStatusService } from "./status.js";

const OPERATION = /^[a-f0-9]{64}$/u;
export interface RelaySourceFinalityPorts {
  /** A fresh, canonical, finalized Ethereum observation. At most three physical RPC POSTs. */
  finalizedDeposit(hash: Hex): Promise<RelayDepositObservation | null>;
}
export type RelayObserveState = "prepared_waiting" | "approval_pending" | "deposit_pending" |
  "source_unproven" | "source_finalized" | "provider_candidate_unproven" |
  "recipient_credit_observed" | "operational_acceptance";

export interface RelayObserveResult {
  readonly operationId: string;
  readonly requestId: string | null;
  readonly state: RelayObserveState;
  readonly reason: string;
  readonly sourceFinalized: boolean;
  readonly providerStatus: string | null;
  readonly providerStatusBound: boolean;
  readonly destinationProof: RelayBnbProofResult | null;
  readonly causalLinkCryptographicallyProven: false;
  readonly paidAcceptance: false;
  readonly operationalAcceptance: boolean;
}

/** No signer, wallet, send, journal mutation, or retry surface is reachable here. */
export class RelayObserveService {
  constructor(private readonly state: StateStore, private readonly source: RelaySourceFinalityPorts,
    private readonly bnb: RelayBnbProofPorts,
    private readonly status = new RelayKeylessStatusService(state)) {}

  async observe(operationId: string): Promise<RelayObserveResult> {
    if (!OPERATION.test(operationId)) throw new ApnError("APN_INVALID_INPUT", "Relay observe requires an operation ID.");
    const op = await new RelayUnsignedOperationRepository(this.state.root).findOperation(operationId);
    if (op === null) throw new ApnError("APN_OPERATION_NOT_FOUND", "Relay operation was not found.");
    if (await new RelayRetirementRepository(this.state.root).load(op) !== null)
      throw new ApnError("APN_OPERATION_BLOCKED", "Relay operation is retired.");
    const result = (state: RelayObserveState, reason: string, sourceFinalized = false,
      providerStatus: string | null = null, providerStatusBound = false,
      destinationProof: RelayBnbProofResult | null = null): RelayObserveResult => ({
      operationId, requestId: op.statusLocator?.requestId ?? null, state, reason, sourceFinalized,
      providerStatus, providerStatusBound, destinationProof, causalLinkCryptographicallyProven: false,
      paidAcceptance: false, operationalAcceptance: state === "operational_acceptance",
    });
    const journal = await new RelayEffectJournalRepository(this.state.root).load(op.profileHash, operationId);
    if (journal === null) return result("prepared_waiting", "source_journal_missing");
    const approval = journal.effects[0], deposit = journal.effects[1];
    if (approval.phase !== "confirmed") return result("approval_pending", `approval_${approval.phase}`);
    if (deposit.phase === "pending" || deposit.attempt?.transactionHash === null)
      return result("deposit_pending", `deposit_${deposit.phase}`);
    const sourceHash = deposit.attempt?.transactionHash;
    if (sourceHash === undefined) return result("deposit_pending", "deposit_hash_missing");
    let observation: RelayDepositObservation | null;
    try { observation = await this.source.finalizedDeposit(sourceHash as Hex); }
    catch { return result("source_unproven", "source_rpc_unavailable"); }
    if (observation === null) return result("source_unproven", "source_not_finalized_or_noncanonical");
    try {
      if (verifyDepositObservation(op, sourceHash as Hex, observation) !== "confirmed")
        return result("source_unproven", "source_receipt_failed");
    } catch { return result("source_unproven", "source_receipt_binding_failed"); }
    if (op.statusLocator === undefined) return result("source_finalized", "status_locator_missing", true);
    let provider: Awaited<ReturnType<RelayKeylessStatusService["status"]>>;
    try { provider = await this.status.status(operationId); }
    catch { return result("source_finalized", "provider_status_unavailable_or_ambiguous", true); }
    const sourceBound = provider.chainIdentityObserved && provider.inTxHashes.includes(sourceHash.toLowerCase());
    // One candidate fits the strict eight-POST budget. Multiple provider hashes
    // are ambiguous here; selecting one could silently ignore a competing payout.
    if (provider.txHashes.length > 1) return result("provider_candidate_unproven", "multiple_provider_candidates",
      true, provider.status, sourceBound);
    const candidateHashes = provider.txHashes;
    if (candidateHashes.length === 0) return result("source_finalized", "provider_candidate_missing", true,
      provider.status, sourceBound);
    const proof = await proveRelayBnbDestination({ operation: op, sourceDeposit: {
      transactionHash: sourceHash, observation }, candidateHashes }, this.bnb);
    if (proof.status !== "recipient_credit_proven") return result("provider_candidate_unproven", proof.reason,
      true, provider.status, sourceBound, proof);
    if (provider.status !== "success" || !sourceBound) return result("recipient_credit_observed",
      "provider_success_or_source_binding_unproven", true, provider.status, sourceBound, proof);
    return result("operational_acceptance", "source_finalized_provider_success_and_safe_recipient_credit",
      true, provider.status, true, proof);
  }
}
