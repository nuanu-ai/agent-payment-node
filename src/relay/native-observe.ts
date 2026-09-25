/** Read-only network reconciliation of a previously dispatched Relay native deposit. */
import { getAddress, type Hex } from "viem";
import { AssetUsageLedger, assetUsageReservationId } from "../asset-usage-ledger.js";
import { evmAddressLock, assertExclusiveEvmOwner } from "../evm-address-ownership.js";
import { ApnError } from "../errors.js";
import type { ClockPort } from "../ports.js";
import type { RelayUnsignedOperation } from "../relay-unsigned-operation.js";
import type { StateStore } from "../state.js";
import type { RelayDepositObservation } from "./deposit-effect.js";
import { proveRelayNativeDestination, type RelayBnbProofPorts } from "./destination-proof.js";
import { RelayNativeSourceJournalRepository } from "./native-source.js";
import { relayNativeRoute, verifySavedRelayNativeQuote } from "./native-quote.js";
import type { RelaySourceFinalityPorts, RelayObserveResult, RelayObserveState } from "./observe.js";
import { RelayKeylessStatusService } from "./status.js";

const same = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();
function blocked(reason: string): never { throw new ApnError("APN_OPERATION_BLOCKED", "Relay native observation is blocked.", { reason }); }

/** Source inclusion is required to match the signed, saved native deposit envelope. */
export function verifyRelayNativeSourceObservation(op: RelayUnsignedOperation, hash: string,
  observation: RelayDepositObservation): "confirmed" | "failed" {
  const tx = observation.transaction, receipt = observation.receipt, deposit = op.nativeQuote!.deposit;
  if (!same(tx.hash, hash) || !same(receipt.transactionHash, hash) || tx.chainId !== 56 ||
    !same(tx.from, op.sourceAccount) || !same(tx.to ?? "", deposit.to) ||
    !same(tx.input, deposit.data) || tx.value !== BigInt(deposit.value) ||
    !same(receipt.blockHash, observation.canonicalBlockHash) || receipt.blockNumber < 0n ||
    !/^0x[0-9a-fA-F]{64}$/u.test(receipt.blockHash)) blocked("source_transaction_binding");
  return receipt.status === "success" ? "confirmed" : "failed";
}

export class RelayNativeObserveService {
  private readonly usedInvocations = new WeakSet<RelayBnbProofPorts>();
  constructor(private readonly state: StateStore, private readonly source: RelaySourceFinalityPorts,
    private readonly destinationInvocation: (chainId: 137 | 143) => RelayBnbProofPorts,
    private readonly status = new RelayKeylessStatusService(state),
    private readonly clock: ClockPort = { now: () => new Date() }) {}

  private result(operationId: string, state: RelayObserveState, reason: string, sourceFinalized = false,
    providerStatus: string | null = null, providerStatusBound = false,
    destinationProof: Awaited<ReturnType<typeof proveRelayNativeDestination>> | null = null): RelayObserveResult {
    return { operationId, state, reason, sourceFinalized, providerStatus, providerStatusBound, destinationProof,
      causalLinkCryptographicallyProven: false, paidAcceptance: false,
      operationalAcceptance: state === "operational_acceptance" };
  }

  async observe(op: RelayUnsignedOperation): Promise<RelayObserveResult> {
    const route = relayNativeRoute(op.sourceAccount, op.recipient);
    if (op.profileHash !== this.state.profileHash(route.profile) || op.destinationChainId !== route.chainId ||
      op.nativeQuote?.routeReference !== route.reference || op.statusLocator === undefined)
      blocked("saved_native_route_or_owner");
    try { await verifySavedRelayNativeQuote(op.nativeQuote); } catch { blocked("saved_native_quote_authority"); }
    await this.state.withLocks([evmAddressLock(op.sourceAccount)], async () => {
      await assertExclusiveEvmOwner(this.state, op.sourceAccount, op.profileHash);
      const profile = await this.state.loadProviderProfile(op.profileHash);
      if (profile !== null && !same(profile.public_address, op.sourceAccount)) blocked("provider_owner_changed");
      const wallet = await this.state.loadWallet(op.profileHash);
      if (wallet === null || !same(wallet.address, op.sourceAccount)) blocked("public_wallet_changed");
    });
    const journals = new RelayNativeSourceJournalRepository(this.state.root);
    let journal = await journals.load(op);
    if (journal === null) return this.result(op.operationId, "prepared_waiting", "source_journal_missing");
    if (["pending", "signing_started", "sealed"].includes(journal.phase))
      return this.result(op.operationId, "deposit_pending", `deposit_${journal.phase}`);
    if (journal.phase === "failed_before_effect") return this.result(op.operationId, "source_unproven", "no_source_effect");
    if (journal.transactionHash === null) blocked("source_hash_missing");
    const hash = journal.transactionHash;
    let source: RelayDepositObservation | null;
    try { source = await this.source.finalizedDeposit(hash as Hex); }
    catch { return this.result(op.operationId, "source_unproven", "source_rpc_unavailable"); }
    if (source === null) return this.result(op.operationId, "source_unproven", "source_not_finalized_or_noncanonical");
    let outcome: "confirmed" | "failed";
    try { outcome = verifyRelayNativeSourceObservation(op, hash, source); }
    catch { return this.result(op.operationId, "source_unproven", "source_transaction_binding_failed"); }
    if (journal.phase !== "submitting" && journal.phase !== outcome) blocked("source_journal_receipt_conflict");
    const usage = new AssetUsageLedger(this.state.root);
    const identity = { account: getAddress(op.sourceAccount), chain: "eip155:56",
      asset: { kind: "native" as const, identifier: null } };
    const reservationId = assetUsageReservationId(identity, `relay-native-execute:${op.operationId}`);
    await this.state.withLocks([`relay-native-source:${op.operationId}`, evmAddressLock(op.sourceAccount)], async () => {
      await assertExclusiveEvmOwner(this.state, op.sourceAccount, op.profileHash);
      const profile = await this.state.loadProviderProfile(op.profileHash);
      const wallet = await this.state.loadWallet(op.profileHash);
      if ((profile !== null && !same(profile.public_address, op.sourceAccount)) ||
        wallet === null || !same(wallet.address, op.sourceAccount)) blocked("source_owner_changed");
      journal = await journals.load(op);
      if (journal === null || journal.transactionHash !== hash ||
        (journal.phase !== "submitting" && journal.phase !== outcome)) blocked("source_journal_changed");
      const reserved = await usage.load(identity, reservationId);
      if (reserved === null || reserved.policyDigest !== op.policyDigest || reserved.amountAtomic !== op.amountAtomic ||
        !["reserved", "submitted", "unknown_finality", "finalized", "failed_confirmed_revert"].includes(reserved.state))
        blocked("source_usage_binding");
      if (journal.phase === "submitting") journal = await journals.advance(op, journal.integrityHash, outcome, null, this.clock.now());
      const target = outcome === "confirmed" ? "finalized" : "failed_confirmed_revert";
      if (reserved.state !== target) await usage.transition({ ...identity, reservationId, policyDigest: op.policyDigest!,
        state: target, expectedCurrentStates: ["reserved", "submitted", "unknown_finality"],
        now: this.clock.now(), outcomeDigest: journal.integrityHash });
    });
    if (outcome === "failed") return this.result(op.operationId, "source_unproven", "source_receipt_failed");
    let provider: Awaited<ReturnType<RelayKeylessStatusService["status"]>>;
    try { provider = await this.status.status(op.operationId); }
    catch { return this.result(op.operationId, "source_finalized", "provider_status_unavailable_or_ambiguous", true); }
    const sourceBound = provider.chainIdentityObserved && provider.inTxHashes.length === 1 &&
      same(provider.inTxHashes[0]!, hash);
    if (provider.txHashes.length !== 1) return this.result(op.operationId,
      provider.txHashes.length === 0 ? "source_finalized" : "provider_candidate_unproven",
      provider.txHashes.length === 0 ? "provider_candidate_missing" : "multiple_provider_candidates",
      true, provider.status, sourceBound);
    const destination = this.destinationInvocation(op.destinationChainId as 137 | 143);
    if (this.usedInvocations.has(destination)) throw new ApnError("APN_RPC_BUDGET_EXCEEDED", "Relay native observe requires a fresh destination RPC budget.");
    this.usedInvocations.add(destination);
    const proof = await proveRelayNativeDestination(op, hash, provider.txHashes, destination);
    if (proof.status !== "recipient_credit_proven") return this.result(op.operationId, "provider_candidate_unproven",
      proof.reason, true, provider.status, sourceBound, proof);
    if (provider.status !== "success" || !sourceBound) return this.result(op.operationId, "recipient_credit_observed",
      "provider_success_or_source_binding_unproven", true, provider.status, sourceBound, proof);
    return this.result(op.operationId, "operational_acceptance",
      "source_finalized_provider_success_and_safe_recipient_credit", true, provider.status, true, proof);
  }
}
