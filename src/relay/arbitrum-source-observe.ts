/** Saved-operation Arbitrum source observation. No wallet, signer, send, or destination assertion. */
import { getAddress, type Hex } from "viem";
import { hashObject } from "../canonical.js";
import { AssetUsageLedger, assetUsageReservationId } from "../asset-usage-ledger.js";
import { ApnError } from "../errors.js";
import { allowlistProfileHash } from "../allowlist-policy-overlay.js";
import { RelayRetirementRepository, RelayUnsignedOperationRepository, type RelayUnsignedOperation } from "../relay-unsigned-operation.js";
import type { StateStore } from "../state.js";
import { ArbitrumSourceEffectJournalRepository, type ArbitrumEffectEvent, type ArbitrumEffectRole,
  type ArbitrumSourceEffectJournal } from "./arbitrum-source-effect-journal.js";
import { RelayArbitrumSourceFinalityObserver, type RelayArbitrumExpectedEffect, type RelayArbitrumNeverLandedProof,
  type RelayArbitrumRevertProof, type RelayArbitrumSourceProof } from "./arbitrum-source-finality.js";
import { RELAY_ARBITRUM_USDC } from "./arbitrum-usdc-ethereum-quote.js";

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
  readonly operation?: (profileHash: string, operationId: string) => Promise<RelayUnsignedOperation | null>;
  readonly journal?: (profileHash: string, operationId: string) => Promise<ArbitrumSourceEffectJournal | null>;
  readonly transition?: (profileHash: string, operationId: string, expectedHash: string,
    role: ArbitrumEffectRole, proofDigest: string, verify: (input: {
      operation: RelayUnsignedOperation; journal: ArbitrumSourceEffectJournal; role: ArbitrumEffectRole;
      outcome: "confirmed" | "failed" | "never_landed"; proofDigest: string }) => Promise<boolean>,
    outcome: "confirmed" | "failed" | "never_landed") => Promise<ArbitrumSourceEffectJournal>;
  /** Synthetic seam; production finalizes the shared usage reservation from the saved safe source proof. */
  readonly finalizeUsage?: (operation: RelayUnsignedOperation, proofDigest: string) => Promise<void>;
  /** Synthetic seam for unverified fences (mark_submitting, record_send); production uses the CAS journal repository. */
  readonly advance?: (profileHash: string, operationId: string, expectedHash: string, event: ArbitrumEffectEvent) => Promise<ArbitrumSourceEffectJournal>;
  /** Synthetic seam; production releases the shared usage reservation after a safe source revert proof. */
  readonly releaseRevertedUsage?: (operation: RelayUnsignedOperation, proofDigest: string) => Promise<void>;
}
function boundRevert(proof: RelayArbitrumRevertProof, chosen: RelayArbitrumExpectedEffect): boolean {
  return proof.sourceChainId === 42161 && proof.proofClass === "canonical_safe_source_revert" &&
    same(proof.reverted.transactionHash, chosen.transactionHash);
}
export class RelayArbitrumSourceObserveService {
  constructor(private readonly state: StateStore,
    private readonly observer: Pick<RelayArbitrumSourceFinalityObserver, "observe" | "observeRevert" | "observeUnsent">,
    private readonly ports: RelayArbitrumSourceObservePorts = {}) {}

  private async finalizeUsage(op: RelayUnsignedOperation, journal: ArbitrumSourceEffectJournal): Promise<void> {
    const proofDigest = journal.effects[1].attempt?.observationDigest;
    if (journal.effects[1].phase !== "confirmed" || !proofDigest || !HASH.test(proofDigest) ||
      journal.operationIntegrityHash !== op.integrityHash) corrupt("deposit_source_proof_required_for_usage");
    if (this.ports.finalizeUsage !== undefined) return this.ports.finalizeUsage(op, proofDigest);
    const identity = { account: getAddress(op.sourceAccount), chain: "eip155:42161",
      asset: { kind: "token" as const, identifier: RELAY_ARBITRUM_USDC } };
    await new AssetUsageLedger(this.state.root).transition({ ...identity,
      reservationId: assetUsageReservationId(identity, `relay-arbitrum-approval:${op.operationId}`),
      policyDigest: op.policyDigest!, state: "finalized", outcomeDigest: proofDigest,
      expectedCurrentStates: ["reserved", "submitted", "unknown_finality", "finalized"], now: new Date() });
  }

  /** Bytes already known on chain count as an uncertain send: the principal hold stays counted. */
  private async holdUncertainSend(op: RelayUnsignedOperation): Promise<void> {
    const identity = { account: getAddress(op.sourceAccount), chain: "eip155:42161",
      asset: { kind: "token" as const, identifier: RELAY_ARBITRUM_USDC } };
    const ledger = new AssetUsageLedger(this.state.root), reservationId = assetUsageReservationId(identity, `relay-arbitrum-approval:${op.operationId}`);
    if ((await ledger.load(identity, reservationId))?.state !== "reserved") return;
    await ledger.transition({ ...identity, reservationId, policyDigest: op.policyDigest!, state: "unknown_finality",
      expectedCurrentStates: ["reserved"], now: new Date() });
  }
  /** A reverted or never-landed approval or deposit moved no principal: the hold is released, never counted as spent. */
  private async releaseRevertedUsage(op: RelayUnsignedOperation, proofDigest: string): Promise<void> {
    if (this.ports.releaseRevertedUsage !== undefined) return this.ports.releaseRevertedUsage(op, proofDigest);
    const identity = { account: getAddress(op.sourceAccount), chain: "eip155:42161",
      asset: { kind: "token" as const, identifier: RELAY_ARBITRUM_USDC } };
    const ledger = new AssetUsageLedger(this.state.root), reservationId = assetUsageReservationId(identity, `relay-arbitrum-approval:${op.operationId}`);
    const current = await ledger.load(identity, reservationId);
    if (current === null || current.state === "failed_confirmed_revert" || current.state === "failed_before_effect") return;
    await ledger.transition({ ...identity, reservationId, policyDigest: op.policyDigest!,
      state: current.state === "reserved" ? "failed_before_effect" : "failed_confirmed_revert", outcomeDigest: proofDigest,
      expectedCurrentStates: ["reserved", "submitted", "unknown_finality"], now: new Date() });
  }

  /** The operation is found only under the caller's explicit profile (OWNR 4.1). */
  async observe(profile: string, operationId: string) {
    if (!HASH.test(operationId)) throw new ApnError("APN_INVALID_INPUT", "Relay Arbitrum observe requires an operation ID.");
    allowlistProfileHash(profile);
    const profileHash = this.state.profileHash(profile);
    const op = await (this.ports.operation?.(profileHash, operationId) ??
      new RelayUnsignedOperationRepository(this.state.root).loadOperation(profileHash, operationId));
    if (op === null) throw new ApnError("APN_OPERATION_NOT_FOUND", "Relay operation was not found for this profile.");
    if (op.operationId !== operationId || op.profileHash !== profileHash || op.sourceChainId !== 42161 || op.destinationChainId !== 1 ||
      op.arbitrumDraft === undefined || op.arbitrumDraft.executionAdmitted !== false) blocked("exact_saved_arbitrum_route");
    if (await new RelayRetirementRepository(this.state.root).load(op) !== null) blocked("operation_retired");
    const repository = new ArbitrumSourceEffectJournalRepository(this.state.root);
    const journal = await (this.ports.journal?.(op.profileHash, operationId) ?? repository.load(op.profileHash, operationId));
    const output = (state: "source_effect_not_recorded" | "observation_only" | "source_proof_pending" |
      "approval_source_confirmed" | "approval_skipped" | "deposit_source_confirmed" | "source_effect_reverted" |
      "source_effect_never_landed", reason: string,
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
    const failed = journal.effects.find(e => e.phase === "failed");
    if (failed !== undefined) {
      await this.releaseRevertedUsage(op, failed.attempt!.observationDigest!);
      return output("source_effect_reverted", `${failed.role}_reverted_at_safe_finality`);
    }
    const abandoned = journal.effects.find(e => e.phase === "abandoned_unsent");
    if (abandoned !== undefined) {
      await this.releaseRevertedUsage(op, abandoned.attempt!.observationDigest!);
      return output("source_effect_never_landed", `${abandoned.role}_signed_bytes_never_land`);
    }
    if (depositEffect.phase === "confirmed") {
      await this.finalizeUsage(op, journal);
      return output("deposit_source_confirmed", "saved_deposit_source_confirmation");
    }
    if (approvalEffect.phase === "approval_skipped" && depositEffect.phase === "pending") return output("approval_skipped",
      "canonical_allowance_observed_deposit_recheck_required");
    const role: ArbitrumEffectRole = ["confirmed", "approval_skipped"].includes(approvalEffect.phase) ? "deposit" : "approval";
    const current = role === "approval" ? approvalEffect : depositEffect;
    if (current.phase === "sealed") {
      // Signed bytes that never crossed `submitting`: resumable unless another transaction consumed their nonce at safe depth.
      const sealed = { transactionHash: current.attempt!.transactionHash as Hex, from: op.sourceAccount, nonce: BigInt(current.attempt!.nonce!) };
      const { outcome, proof: dead } = await this.observer.observeUnsent(sealed);
      if (outcome === "never_lands" && dead !== null && same(dead.transactionHash, sealed.transactionHash) && dead.signedNonce === current.attempt!.nonce &&
        dead.sourceChainId === 42161 && dead.proofClass === "canonical_safe_nonce_consumed") return this.recordNeverLanded(op, journal, role, dead, output);
      if (outcome !== "own_transaction_known") return output("observation_only", `${role}_signed_unsent_resumable`);
      // The node already knows these exact bytes: never send them again; fence them as an uncertain send and observe.
      const advance = this.ports.advance ?? ((profileHash: string, id: string, expected: string, event: ArbitrumEffectEvent) =>
        new ArbitrumSourceEffectJournalRepository(this.state.root).transition(profileHash, id, expected, event));
      let fenced = await advance(op.profileHash, operationId, journal.integrityHash, { kind: "mark_submitting", role, at: new Date().toISOString() });
      fenced = await advance(op.profileHash, operationId, fenced.integrityHash, { kind: "record_send", role, outcome: "uncertain" });
      await this.holdUncertainSend(op);
      return { ...output("observation_only", `${role}_signed_bytes_known_on_chain_observe_only`),
        approvalPhase: fenced.effects[0].phase, depositPhase: fenced.effects[1].phase };
    }
    if (!observable.has(current.phase)) return output(role === "deposit" && approvalEffect.phase === "confirmed" ? "approval_source_confirmed" : "observation_only",
      role === "deposit" ? "deposit_effect_not_submitting" : "approval_effect_not_submitting");
    const chosen = expected(op, journal, role);
    const approval = role === "deposit" && approvalEffect.phase === "confirmed" ? expected(op, journal, "approval") : null;
    // The standalone observer owns the persisted 24-POST cap, 750 ms pacing, and no-429-retry policy.
    const proof = await this.observer.observe(chosen, approval ?? undefined);
    if (proof === null) {
      const reverted = await this.observer.observeRevert(chosen);
      if (reverted !== null && boundRevert(reverted, chosen)) return this.recordRevert(op, journal, role, chosen, reverted, output);
    }
    if (proof === null || !boundProof(proof, role, chosen, approval))
      return output("source_proof_pending", "canonical_safe_source_proof_unavailable");
    const proofDigest = hashObject(proof);
    const verify = async (input: { operation: RelayUnsignedOperation; journal: ArbitrumSourceEffectJournal;
      role: ArbitrumEffectRole; outcome: "confirmed" | "failed" | "never_landed"; proofDigest: string }) =>
      input.operation.integrityHash === op.integrityHash && input.journal.integrityHash === journal.integrityHash &&
      input.role === role && input.outcome === "confirmed" && input.proofDigest === proofDigest &&
      input.journal.effects[role === "approval" ? 0 : 1].attempt?.transactionHash === chosen.transactionHash &&
      boundProof(proof, role, chosen, approval);
    const next = await (this.ports.transition?.(op.profileHash, operationId, journal.integrityHash, role, proofDigest, verify, "confirmed") ??
      new ArbitrumSourceEffectJournalRepository(this.state.root, verify).transition(op.profileHash, operationId,
        journal.integrityHash, { kind: "record_verified_observation", role, outcome: "confirmed", proofDigest }));
    if (next.effects[role === "approval" ? 0 : 1].phase !== "confirmed" ||
      next.effects[role === "approval" ? 0 : 1].attempt?.observationDigest !== proofDigest) corrupt("transition_result");
    if (role === "deposit") await this.finalizeUsage(op, next);
    return { ...output(role === "approval" ? "approval_source_confirmed" : "deposit_source_confirmed",
      "canonical_safe_source_receipt", proof), approvalPhase: next.effects[0].phase, depositPhase: next.effects[1].phase };
  }
  private async recordRevert<T>(op: RelayUnsignedOperation, journal: ArbitrumSourceEffectJournal, role: ArbitrumEffectRole,
    chosen: RelayArbitrumExpectedEffect, reverted: RelayArbitrumRevertProof,
    output: (state: "source_effect_reverted", reason: string) => T): Promise<T> {
    const proofDigest = hashObject(reverted);
    const verify = async (input: { operation: RelayUnsignedOperation; journal: ArbitrumSourceEffectJournal;
      role: ArbitrumEffectRole; outcome: "confirmed" | "failed" | "never_landed"; proofDigest: string }) =>
      input.operation.integrityHash === op.integrityHash && input.journal.integrityHash === journal.integrityHash &&
      input.role === role && input.outcome === "failed" && input.proofDigest === proofDigest &&
      input.journal.effects[role === "approval" ? 0 : 1].attempt?.transactionHash === chosen.transactionHash &&
      boundRevert(reverted, chosen);
    const next = await (this.ports.transition?.(op.profileHash, op.operationId, journal.integrityHash, role, proofDigest, verify, "failed") ??
      new ArbitrumSourceEffectJournalRepository(this.state.root, verify).transition(op.profileHash, op.operationId,
        journal.integrityHash, { kind: "record_verified_observation", role, outcome: "failed", proofDigest }));
    const effect = next.effects[role === "approval" ? 0 : 1];
    if (effect.phase !== "failed" || effect.attempt?.observationDigest !== proofDigest) corrupt("revert_transition_result");
    await this.releaseRevertedUsage(op, proofDigest);
    return output("source_effect_reverted", `${role}_reverted_at_safe_finality`);
  }
  private async recordNeverLanded<T>(op: RelayUnsignedOperation, journal: ArbitrumSourceEffectJournal, role: ArbitrumEffectRole,
    proof: RelayArbitrumNeverLandedProof, output: (state: "source_effect_never_landed", reason: string) => T): Promise<T> {
    const proofDigest = hashObject(proof), index = role === "approval" ? 0 : 1;
    const verify = async (input: { operation: RelayUnsignedOperation; journal: ArbitrumSourceEffectJournal;
      role: ArbitrumEffectRole; outcome: "confirmed" | "failed" | "never_landed"; proofDigest: string }) =>
      input.operation.integrityHash === op.integrityHash && input.journal.integrityHash === journal.integrityHash &&
      input.role === role && input.outcome === "never_landed" && input.proofDigest === proofDigest &&
      input.journal.effects[index].phase === "sealed" && input.journal.effects[index].attempt?.transactionHash === proof.transactionHash;
    const next = await (this.ports.transition?.(op.profileHash, op.operationId, journal.integrityHash, role, proofDigest, verify, "never_landed") ??
      new ArbitrumSourceEffectJournalRepository(this.state.root, verify).transition(op.profileHash, op.operationId,
        journal.integrityHash, { kind: "record_never_landed", role, proofDigest }));
    if (next.effects[index].phase !== "abandoned_unsent" || next.effects[index].attempt?.observationDigest !== proofDigest) corrupt("never_landed_transition_result");
    await this.releaseRevertedUsage(op, proofDigest);
    return output("source_effect_never_landed", `${role}_signed_bytes_never_land`);
  }
}
