import type { StateStore } from "../state.js";
import type { MetaMaskGaslessClock } from "./clock.js";
import { mmDispatchIntent } from "./dispatch.js";
import { mmPrivateHash } from "./identity.js";
import { assertMetaMaskGaslessObservable, metaMaskGaslessObservationRoom,
  metaMaskGaslessObservationUnchanged } from "./journal/transitions.js";
import type { MetaMaskGaslessCursor, MetaMaskGaslessMutable, MetaMaskGaslessObservation, MetaMaskGaslessProviderObservation,
  MetaMaskGaslessRpcObservation } from "./model.js";
import { MM_CLOSED_PROVIDER_STATUSES, MM_PROVIDER_STATUSES } from "./model.js";
import { MM_TERMINAL, type MetaMaskGaslessOperationRecord } from "./operation-model.js";
import { metaMaskGaslessOwner } from "./owner.js";
import type { MetaMaskGaslessProviderPort, MetaMaskGaslessRpcFactory, MetaMaskGaslessRpcPort } from "./ports.js";
import { mmClassify, mmFail, mmFailure, type MetaMaskGaslessFailure, type MetaMaskGaslessFailureReason } from "./reasons.js";
import { mmExact, mmHex, mmIso } from "./validation.js";

export type MetaMaskGaslessSave = (op: MetaMaskGaslessOperationRecord, patch: Partial<MetaMaskGaslessMutable>,
  at: string) => Promise<MetaMaskGaslessOperationRecord>;
export interface MetaMaskGaslessStep {
  readonly operation: MetaMaskGaslessOperationRecord;
  /** Explicitly transient; never part of the stored operation or its receipt. */
  readonly warning?: MetaMaskGaslessFailure;
  /** A nonterminal result read after only the reserved terminal slot was left; reported, never saved. */
  readonly unsaved?: { readonly observation: MetaMaskGaslessObservation; readonly cursor: MetaMaskGaslessCursor };
}
/** An owner-named observation RPC with the environment variable that named it. */
export interface MetaMaskGaslessObserver {
  readonly rpc: MetaMaskGaslessRpcPort;
  readonly environmentName: string;
}
export interface MetaMaskGaslessProviderRead {
  readonly hint: MetaMaskGaslessProviderObservation | null;
  readonly failure: MetaMaskGaslessFailureReason | null;
}
export function metaMaskGaslessProviderObservation(value: unknown,
  op: MetaMaskGaslessOperationRecord): MetaMaskGaslessProviderObservation {
  const p = mmExact(value, ["observedAt", "requestIdHash", "status", "txHash"], "mm_gasless_evidence_invalid");
  mmIso(p.observedAt, "mm_gasless_evidence_invalid");
  if (p.requestIdHash !== mmPrivateHash("request-id", op.intent.requestId) ||
    !(MM_PROVIDER_STATUSES as readonly string[]).includes(String(p.status))) mmFail("mm_gasless_evidence_invalid");
  if (p.txHash !== null) mmHex(p.txHash, 32, "mm_gasless_evidence_invalid");
  return p as unknown as MetaMaskGaslessProviderObservation;
}

export class MetaMaskGaslessObservationService {
  constructor(private readonly state: StateStore, private readonly rpcFor: MetaMaskGaslessRpcFactory,
    private readonly provider: MetaMaskGaslessProviderPort, private readonly clock: MetaMaskGaslessClock,
    private readonly save: MetaMaskGaslessSave, private readonly observer?: MetaMaskGaslessObserver) {}

  async run(op: MetaMaskGaslessOperationRecord, submitted?: MetaMaskGaslessProviderRead): Promise<MetaMaskGaslessStep> {
    if (op.terminal || op.submissionAttempts !== 1) return { operation: op };
    try {
      this.clock.check(op);
      assertMetaMaskGaslessObservable(op);
      const result = submitted ?? await this.readProvider(op);
      this.clock.check(op, result.hint === null ? [] : [result.hint.observedAt]);
      const providerObservation = this.retainProvider(op, result.hint);
      let chain: MetaMaskGaslessRpcObservation;
      try {
        const rpc = this.observer?.rpc ?? this.rpcFor(op.intent.request.chainId);
        // Any endpoint of the chain may observe; it proves the frozen safe anchor before any evidence counts.
        if (rpc.chainId !== op.intent.request.chainId) mmFail("mm_gasless_rpc_binding");
        chain = await rpc.observe(mmDispatchIntent(op), op.cursor, providerObservation);
        chain = { ...chain, observation: { ...chain.observation, ...this.source() } };
        this.clock.check(op, [chain.observation.observedAt,
          ...(chain.settlement === null ? [] : [chain.settlement.observedAt])]);
      } catch (error) {
        const classified = mmClassify(error, "mm_gasless_rpc_unavailable").reason;
        if (classified === "mm_gasless_clock") throw error;
        const invalid = ["mm_gasless_rpc_binding", "mm_gasless_evidence_invalid"].includes(classified);
        const reason = invalid ? classified : "mm_gasless_rpc_unavailable";
        const at = new Date(this.clock.check(op)).toISOString();
        chain = { cursor: op.cursor, settlement: null, observation: {
          observedAt: at, phase: invalid ? "invalid" : "unavailable",
          reason, candidateTxHash: op.observation?.candidateTxHash ?? null, transactionBlock: null,
          finalityBlock: null, evidenceHash: null, ...this.source(),
        } };
      }
      // An unavailable request cannot discard a previously independently usable locator.
      if (chain.observation.phase === "unavailable" && chain.observation.candidateTxHash === null &&
        op.observation?.candidateTxHash !== null && op.observation?.candidateTxHash !== undefined) {
        chain = { ...chain, observation: { ...chain.observation, candidateTxHash: op.observation.candidateTxHash } };
      }
      const patch = this.decide(op, chain, providerObservation, result.failure);
      const at = new Date(this.clock.check(op, [chain.observation.observedAt,
        ...(providerObservation === null ? [] : [providerObservation.observedAt])])).toISOString();
      if (metaMaskGaslessObservationUnchanged(op, patch)) return { operation: op };
      // Full history never blocks a read or the terminal transition; it only stops saving nonterminal results.
      if (!MM_TERMINAL.includes(patch.state ?? op.state) && !metaMaskGaslessObservationRoom(op)) {
        return { operation: op, warning: mmFailure("mm_gasless_record_capacity"),
          unsaved: { observation: chain.observation, cursor: chain.cursor } };
      }
      return { operation: await this.save(op, patch, at) };
    } catch (error) {
      const failure = mmClassify(error, "mm_gasless_internal");
      if (failure.reason === "mm_gasless_clock" || failure.reason === "mm_gasless_record_capacity") {
        return { operation: op, warning: failure };
      }
      throw error;
    }
  }

  private source() {
    const observer = this.observer;
    return observer === undefined ? {} : { source: { environmentName: observer.environmentName,
      endpointOrigin: observer.rpc.endpointOrigin, endpointHash: observer.rpc.endpointHash } };
  }

  private async readProvider(op: MetaMaskGaslessOperationRecord): Promise<MetaMaskGaslessProviderRead> {
    try {
      await metaMaskGaslessOwner(this.state, op.intent.profile, op.intent.binding); this.clock.check(op);
      const hint = await this.state.withLocks(["provider-session:metamask-agent-wallet"], async () => {
        this.clock.check(op);
        const value = await this.provider.observe(mmDispatchIntent(op)); this.clock.check(op);
        return metaMaskGaslessProviderObservation(value, op);
      });
      this.clock.check(op, [hint.observedAt]);
      return { hint, failure: null };
    } catch (error) {
      const reason = mmClassify(error, "mm_gasless_provider_unavailable").reason;
      if (reason === "mm_gasless_clock") throw error;
      this.clock.check(op);
      return { hint: null, failure: reason };
    }
  }

  private retainProvider(op: MetaMaskGaslessOperationRecord,
    current: MetaMaskGaslessProviderObservation | null): MetaMaskGaslessProviderObservation | null {
    const previousHash = op.providerObservation?.txHash ?? null;
    if (current !== null) return { ...current, txHash: current.txHash ?? previousHash };
    if (op.providerObservation === null) return null;
    // A closed provider job is final: a failed read (an expired session included) cannot replace what it said.
    if (closedProvider(op.providerObservation)) return op.providerObservation;
    return { observedAt: new Date(this.clock.check(op)).toISOString(),
      requestIdHash: mmPrivateHash("request-id", op.intent.requestId), status: "unavailable", txHash: previousHash };
  }

  private decide(op: MetaMaskGaslessOperationRecord, chain: MetaMaskGaslessRpcObservation,
    provider: MetaMaskGaslessProviderObservation | null, providerFailure: MetaMaskGaslessFailureReason | null): Partial<MetaMaskGaslessMutable> {
    const base = { cursor: chain.cursor, observation: chain.observation, providerObservation: provider };
    if (chain.observation.phase === "success" && chain.settlement !== null) {
      return { ...base, state: "completed", settlement: chain.settlement, failure: null };
    }
    if (chain.settlement !== null || chain.observation.phase === "success") mmFail("mm_gasless_evidence_invalid");
    if (chain.observation.phase === "reverted") {
      return { ...base, state: "failed_effects_pending", failure: mmFailure("mm_gasless_transaction_reverted") };
    }
    if (op.state === "failed_effects_pending") {
      return { ...base, state: "failed_effects_pending", failure: mmFailure("mm_gasless_transaction_reverted") };
    }
    if (["invalid", "reorg", "unavailable"].includes(chain.observation.phase)) {
      if (chain.observation.reason === "mm_gasless_success") mmFail("mm_gasless_evidence_invalid");
      return { ...base, state: "unknown_finality", failure: mmFailure(chain.observation.reason) };
    }
    const usableHint = provider !== null && ["broadcasted", "confirmed"].includes(provider.status) &&
      provider.txHash !== null && provider.txHash === chain.observation.candidateTxHash;
    const closed = provider !== null && closedProvider(provider) ? closedReason(op, provider) : null;
    const reason = closed ?? providerFailure ?? (provider?.status === "awaiting_approval" ? "mm_gasless_provider_approval" :
      provider?.status === "unavailable" ? "mm_gasless_provider_unavailable" : "mm_gasless_pending");
    return { ...base, state: usableHint ? "submitted_pending" : "unknown_finality", failure: mmFailure(reason) };
  }
}

function closedProvider(provider: MetaMaskGaslessProviderObservation): boolean {
  return (MM_CLOSED_PROVIDER_STATUSES as readonly string[]).includes(provider.status);
}

/**
 * MetaMask runs a job EVALUATING, AWAITING_MFA, SIGNING, BROADCASTING, and its own SDK reads DENIED or EXPIRED after
 * AWAITING_MFA as the MFA being rejected, i.e. closed before SIGNING. That is the provider's word, not proof that no
 * signature exists, so the operation stays guarded; only the reason and next action become specific. Every other
 * closed status keeps `mm_gasless_provider_failed`.
 */
function closedReason(op: MetaMaskGaslessOperationRecord,
  provider: MetaMaskGaslessProviderObservation): MetaMaskGaslessFailureReason {
  const awaitedMfa = op.providerObservation?.status === "awaiting_approval" ||
    op.transitions.some(transition => transition.providerObservation?.status === "awaiting_approval");
  return (provider.status === "denied" || provider.status === "expired") && awaitedMfa
    ? "mm_gasless_provider_mfa_rejected" : "mm_gasless_provider_failed";
}
