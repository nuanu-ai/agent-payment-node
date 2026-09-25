/** Saved-operation Arbitrum source observation. No wallet, signer, send, or destination assertion. */
import type { Hex } from "viem";
import { hashObject } from "../canonical.js";
import { ApnError } from "../errors.js";
import { RelayRetirementRepository, RelayUnsignedOperationRepository, type RelayUnsignedOperation } from "../relay-unsigned-operation.js";
import type { StateStore } from "../state.js";
import { ArbitrumSourceEffectJournalRepository, type ArbitrumEffectRole,
  type ArbitrumSourceEffectJournal } from "./arbitrum-source-effect-journal.js";
import { RelayArbitrumSourceFinalityObserver, type RelayArbitrumExpectedEffect,
  type RelayArbitrumSourceProof } from "./arbitrum-source-finality.js";

const HASH = /^[a-f0-9]{64}$/u;
const observable = new Set(["submitting", "submitted", "unknown_finality"]);
const same = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();
function blocked(reason: string): never {
  throw new ApnError("APN_OPERATION_BLOCKED", "Relay Arbitrum source observation is blocked.", { reason });
}
function corrupt(reason: string): never {
  throw new ApnError("APN_STATE_CORRUPT", "Relay Arbitrum source observation has inconsistent saved state.", { reason });
}
function expected(op: RelayUnsignedOperation, j: ArbitrumSourceEffectJournal,
  role: ArbitrumEffectRole): RelayArbitrumExpectedEffect {
  const index = role === "approval" ? 0 : 1;
  const effect = j.effects[index];
  if (!effect || !observable.has(effect.phase) && effect.phase !== "confirmed" ||
    effect.attempt?.transactionHash === null || effect.attempt?.transactionHash === undefined)
    blocked("hash_bound_effect_required");
  const raw = op.arbitrumDraft?.rawQuote as { steps?: Array<{ items?: Array<{ data?: {
    to: string; data: Hex; value: string } }> }> } | undefined;
  const envelope = raw?.steps?.[index]?.items?.[0]?.data;
  if (envelope === undefined || !/^0x[a-f0-9]{64}$/u.test(effect.attempt.transactionHash)) corrupt("saved_envelope_or_hash");
  return { transactionHash: effect.attempt.transactionHash as Hex, from: op.sourceAccount,
    to: envelope.to, data: envelope.data, valueWei: BigInt(envelope.value) };
}
function boundProof(proof: RelayArbitrumSourceProof, role: ArbitrumEffectRole,
  chosen: RelayArbitrumExpectedEffect, approval: RelayArbitrumExpectedEffect | null): boolean {
  return proof.sourceChainId === 42161 && proof.proofClass === "canonical_safe_source_receipts" &&
    proof.destinationDeliveryProven === false && proof.causalLinkCryptographicallyProven === false &&
    proof.paidAcceptance === false && same(proof.deposit.transactionHash, chosen.transactionHash) &&
    (role === "approval" ? proof.approval === null : approval === null ? proof.approval === null :
      proof.approval !== null && same(proof.approval.transactionHash, approval.transactionHash));
}
export interface RelayArbitrumSourceObservePorts {
  readonly operation?: (operationId: string) => Promise<RelayUnsignedOperation | null>;
  readonly journal?: (profileHash: string, operationId: string) => Promise<ArbitrumSourceEffectJournal | null>;
  readonly transition?: (profileHash: string, operationId: string, expectedHash: string,
    role: ArbitrumEffectRole, proofDigest: string, verify: (input: {
      operation: RelayUnsignedOperation; journal: ArbitrumSourceEffectJournal; role: ArbitrumEffectRole;
      outcome: "confirmed" | "failed"; proofDigest: string }) => Promise<boolean>) => Promise<ArbitrumSourceEffectJournal>;
}
export class RelayArbitrumSourceObserveService {
  constructor(private readonly state: StateStore, private readonly observer: Pick<RelayArbitrumSourceFinalityObserver, "observe">,
    private readonly ports: RelayArbitrumSourceObservePorts = {}) {}

  async observe(operationId: string) {
    if (!HASH.test(operationId)) throw new ApnError("APN_INVALID_INPUT", "Relay Arbitrum observe requires an operation ID.");
    const op = await (this.ports.operation?.(operationId) ??
      new RelayUnsignedOperationRepository(this.state.root).findOperation(operationId));
    if (op === null) throw new ApnError("APN_OPERATION_NOT_FOUND", "Relay operation was not found.");
    if (op.operationId !== operationId || op.sourceChainId !== 42161 || op.destinationChainId !== 1 ||
      op.arbitrumDraft === undefined || op.arbitrumDraft.executionAdmitted !== false) blocked("exact_saved_arbitrum_route");
    if (await new RelayRetirementRepository(this.state.root).load(op) !== null) blocked("operation_retired");
    const repository = new ArbitrumSourceEffectJournalRepository(this.state.root);
    const journal = await (this.ports.journal?.(op.profileHash, operationId) ?? repository.load(op.profileHash, operationId));
    const output = (state: "source_effect_not_recorded" | "observation_only" | "source_proof_pending" |
      "approval_source_confirmed" | "approval_skipped" | "deposit_source_confirmed", reason: string,
      proof: RelayArbitrumSourceProof | null = null) => ({ operationId, state, reason,
      approvalPhase: journal?.effects[0].phase ?? null, depositPhase: journal?.effects[1].phase ?? null,
      sourceProof: proof === null ? null : { ...proof,
        approval: state === "approval_source_confirmed" ? proof.deposit : proof.approval,
        deposit: state === "approval_source_confirmed" ? null : proof.deposit },
      sourceFinalized: state === "deposit_source_confirmed",
      destinationDeliveryProven: false as const, causalLinkCryptographicallyProven: false as const,
      paidAcceptance: false as const, executionAdmitted: false as const, nextActions: [] as const });
    if (journal === null) return output("source_effect_not_recorded", "source_effect_not_recorded");
    if (journal.operationIntegrityHash !== op.integrityHash || journal.quoteDigest !== op.quoteDigest ||
      journal.orderId !== op.arbitrumDraft.orderId) corrupt("journal_operation_binding");
    const [approvalEffect, depositEffect] = journal.effects;
    if (depositEffect.phase === "confirmed") return output("deposit_source_confirmed", "saved_deposit_source_confirmation");
    if (approvalEffect.phase === "approval_skipped" && depositEffect.phase === "pending") return output("approval_skipped",
      "canonical_allowance_observed_deposit_recheck_required");
    const role: ArbitrumEffectRole = ["confirmed", "approval_skipped"].includes(approvalEffect.phase) ? "deposit" : "approval";
    const current = role === "approval" ? approvalEffect : depositEffect;
    if (!observable.has(current.phase)) return output(role === "deposit" && approvalEffect.phase === "confirmed" ? "approval_source_confirmed" : "observation_only",
      role === "deposit" ? "deposit_effect_not_submitting" : "approval_effect_not_submitting");
    const chosen = expected(op, journal, role);
    const approval = role === "deposit" && approvalEffect.phase === "confirmed" ? expected(op, journal, "approval") : null;
    // The standalone observer owns the persisted 24-POST cap, 750 ms pacing, and no-429-retry policy.
    const proof = await this.observer.observe(chosen, approval ?? undefined);
    if (proof === null || !boundProof(proof, role, chosen, approval))
      return output("source_proof_pending", "canonical_safe_source_proof_unavailable");
    const proofDigest = hashObject(proof);
    const verify = async (input: { operation: RelayUnsignedOperation; journal: ArbitrumSourceEffectJournal;
      role: ArbitrumEffectRole; outcome: "confirmed" | "failed"; proofDigest: string }) =>
      input.operation.integrityHash === op.integrityHash && input.journal.integrityHash === journal.integrityHash &&
      input.role === role && input.outcome === "confirmed" && input.proofDigest === proofDigest &&
      input.journal.effects[role === "approval" ? 0 : 1].attempt?.transactionHash === chosen.transactionHash &&
      boundProof(proof, role, chosen, approval);
    const next = await (this.ports.transition?.(op.profileHash, operationId, journal.integrityHash, role, proofDigest, verify) ??
      new ArbitrumSourceEffectJournalRepository(this.state.root, verify).transition(op.profileHash, operationId,
        journal.integrityHash, { kind: "record_verified_observation", role, outcome: "confirmed", proofDigest }));
    if (next.effects[role === "approval" ? 0 : 1].phase !== "confirmed" ||
      next.effects[role === "approval" ? 0 : 1].attempt?.observationDigest !== proofDigest) corrupt("transition_result");
    return { ...output(role === "approval" ? "approval_source_confirmed" : "deposit_source_confirmed",
      "canonical_safe_source_receipt", proof), approvalPhase: next.effects[0].phase, depositPhase: next.effects[1].phase };
  }
}
