/** One guarded deposit transaction for a saved Arbitrum USDC Relay operation. */
import { privateKeyToAccount } from "viem/accounts";
import { getAddress, type Hex } from "viem";
import { activeAssetPolicyFromState, type ActiveAssetPolicy } from "../allowlist-active-policy.js";
import { AllowlistPolicyStore } from "../allowlist-policy-store.js";
import { allowlistProfileHash } from "../allowlist-policy-overlay.js";
import { AssetUsageLedger, assetUsageReservationId } from "../asset-usage-ledger.js";
import { EncryptedSmartAccountPermissionStore } from "../encrypted-smart-account-permission-store.js";
import { EncryptedWalletStore } from "../encrypted-wallet-store.js";
import { assertExclusiveEvmOwnerIncludingGrants, evmAddressLock } from "../evm-address-ownership.js";
import { ApnError } from "../errors.js";
import type { WrappingSecretPort } from "../macos-keychain.js";
import { RelayRetirementRepository, RelayUnsignedOperationRepository, type RelayUnsignedOperation } from "../relay-unsigned-operation.js";
import type { StateStore } from "../state.js";
import { ArbitrumSourceEffectJournalRepository, type ArbitrumSourceEffectJournal } from "./arbitrum-source-effect-journal.js";
import { RelayArbitrumDepositPreflightReader } from "./arbitrum-deposit-preflight.js";
import { RELAY_ARBITRUM_USDC } from "./arbitrum-usdc-ethereum-quote.js";
import { RELAY_ARBITRUM_SOURCE_DRAFT_REFERENCE } from "./arbitrum-usdc-source-draft.js";
import { ETHEREUM_DEPOSITORY } from "./quote.js";

const HASH = /^[a-f0-9]{64}$/u;
function blocked(reason: string): never { throw new ApnError("APN_OPERATION_BLOCKED", "Relay Arbitrum deposit dispatch is blocked.", { reason }); }
const same = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();

export interface RelayArbitrumDepositSummary {
  readonly operationId: string; readonly sourceChainId: 42161; readonly destinationChainId: 1;
  readonly owner: string; readonly token: string; readonly spender: string; readonly depositAmountAtomic: string;
  readonly quoteDigest: string; readonly deadline: string; readonly depositNetworkFeeCeilingWei: string;
}
export interface RelayArbitrumDepositSigner { sign(op: RelayUnsignedOperation, nonce: string, journal: ArbitrumSourceEffectJournal): Promise<Hex> }
export interface RelayArbitrumDepositDispatchPorts {
  readonly confirm: (summary: RelayArbitrumDepositSummary) => Promise<boolean>;
  readonly signer: RelayArbitrumDepositSigner;
  readonly send: (raw: Hex) => Promise<Hex>;
  /** Caller holds the allowlist profile lock. Production uses the authenticated policy store. */
  readonly activePolicyUnderLock?: (at: Date) => Promise<ActiveAssetPolicy | null>;
  readonly dailyUsage?: (owner: string, at: Date) => Promise<string>;
  readonly now?: () => Date;
  /** Synthetic seams; production uses the verified durable repositories. */
  readonly operation?: (profileHash: string, operationId: string) => Promise<RelayUnsignedOperation | null>;
  readonly journals?: Pick<ArbitrumSourceEffectJournalRepository,
    "load" | "createUnderLocks" | "beginSigningUnderLocks" | "transitionUnderLocks">;
}

/** Unlocks local custody only after a durable signing marker exists. */
export class LocalRelayArbitrumDepositSigner implements RelayArbitrumDepositSigner {
  private readonly wallets: EncryptedWalletStore;
  constructor(private readonly state: StateStore, wrapping: WrappingSecretPort) {
    this.wallets = new EncryptedWalletStore(state, wrapping);
  }
  async sign(op: RelayUnsignedOperation, nonce: string, journal: ArbitrumSourceEffectJournal): Promise<Hex> {
    if (journal.effects[1].phase !== "signing_started" || !["confirmed", "approval_skipped"].includes(journal.effects[0].phase) ||
      journal.operationIntegrityHash !== op.integrityHash || !/^(0|[1-9][0-9]*)$/u.test(nonce) ||
      BigInt(nonce) > BigInt(Number.MAX_SAFE_INTEGER)) blocked("durable_signing_marker_or_nonce");
    const saved = await new ArbitrumSourceEffectJournalRepository(this.state.root).load(op.profileHash, op.operationId);
    if (saved?.integrityHash !== journal.integrityHash) blocked("signing_marker_changed");
    const wallet = await this.wallets.describe("default");
    if (wallet === null) blocked("encrypted_wallet_missing");
    try {
      if (wallet.identity.profile !== "default" || !same(wallet.identity.address, op.sourceAccount)) blocked("encrypted_wallet_owner");
      const account = privateKeyToAccount(wallet.secret.privateKey);
      if (!same(account.address, op.sourceAccount)) blocked("local_signer_owner");
      const deposit = (op.arbitrumDraft!.rawQuote as { steps: Array<{ items: Array<{ data: {
        to: string; data: string; value: string; gas: string; maxFeePerGas: string; maxPriorityFeePerGas: string } }> }> }).steps[1]!.items[0]!.data;
      if (!same(deposit.to, ETHEREUM_DEPOSITORY) || deposit.value !== "0" ||
        BigInt(deposit.gas) * BigInt(deposit.maxFeePerGas) > BigInt(op.depositNetworkFeeCeilingWei!)) blocked("deposit_envelope");
      return await account.signTransaction({ type: "eip1559", chainId: 42161, to: deposit.to as Hex,
        data: deposit.data as Hex, value: 0n, nonce: Number(BigInt(nonce)), gas: BigInt(deposit.gas),
        maxFeePerGas: BigInt(deposit.maxFeePerGas), maxPriorityFeePerGas: BigInt(deposit.maxPriorityFeePerGas), accessList: [] });
    } finally { this.wallets.clear(wallet.secret); }
  }
}

export class RelayArbitrumDepositDispatchService {
  private readonly journals: Pick<ArbitrumSourceEffectJournalRepository,
    "load" | "createUnderLocks" | "beginSigningUnderLocks" | "transitionUnderLocks">;
  private readonly permissions: EncryptedSmartAccountPermissionStore;
  private readonly usage: AssetUsageLedger;
  constructor(private readonly state: StateStore,
    private readonly reader: Pick<RelayArbitrumDepositPreflightReader, "read">,
    private readonly ports: RelayArbitrumDepositDispatchPorts,
    wrapping: WrappingSecretPort) {
    this.journals = ports.journals ?? new ArbitrumSourceEffectJournalRepository(state.root);
    this.permissions = new EncryptedSmartAccountPermissionStore(state, wrapping);
    this.usage = new AssetUsageLedger(state.root);
  }
  private now(): Date {
    const at = this.ports.now?.() ?? new Date();
    if (!(at instanceof Date) || !Number.isFinite(at.getTime())) blocked("invalid_clock");
    return at;
  }
  private async owner(op: RelayUnsignedOperation): Promise<void> {
    await assertExclusiveEvmOwnerIncludingGrants(this.state, this.permissions, op.sourceAccount, op.profileHash);
    const profile = await this.state.loadProviderProfile(op.profileHash);
    if (profile !== null && !same(profile.public_address, op.sourceAccount)) blocked("provider_owner_changed");
    const wallet = await this.state.loadWallet(op.profileHash);
    if (wallet !== null && !same(wallet.address, op.sourceAccount)) blocked("public_wallet_owner_changed");
  }
  private async snapshot(op: RelayUnsignedOperation, active: ActiveAssetPolicy) {
    const at = this.now();
    await this.owner(op);
    if (active.digest !== op.policyDigest || active.revision !== op.policyRevision ||
      !same(active.accounts.evm ?? "", op.sourceAccount)) blocked("active_owner_policy_required");
    const usage = await (this.ports.dailyUsage?.(op.sourceAccount, at) ?? this.dailyUsageExcludingOwn(op, at));
    return this.reader.read(op, active, op.sourceAccount, usage, at, () => this.now());
  }
  private usageIdentity(op: RelayUnsignedOperation) {
    return { account: getAddress(op.sourceAccount), chain: "eip155:42161",
      asset: { kind: "token" as const, identifier: RELAY_ARBITRUM_USDC } };
  }
  private reservationId(op: RelayUnsignedOperation) {
    return assetUsageReservationId(this.usageIdentity(op), `relay-arbitrum-approval:${op.operationId}`);
  }
  private async dailyUsageExcludingOwn(op: RelayUnsignedOperation, at: Date): Promise<string> {
    const { snapshot, reservation } = await this.usage.usageWithReservation(
      this.usageIdentity(op), this.reservationId(op), at);
    const own = reservation !== null && !["failed_before_effect", "failed_confirmed_revert"].includes(reservation.state) &&
      reservation.reservedAt.slice(0, 10) === at.toISOString().slice(0, 10) ? BigInt(op.amountAtomic) : 0n;
    if (BigInt(snapshot.amountAtomic) < own || reservation !== null &&
      (reservation.amountAtomic !== op.amountAtomic || reservation.policyDigest !== op.policyDigest))
      blocked("usage_reservation_changed");
    return (BigInt(snapshot.amountAtomic) - own).toString();
  }
  private async reserve(op: RelayUnsignedOperation, active: ActiveAssetPolicy): Promise<void> {
    const at = this.now();
    if (active.digest !== op.policyDigest || active.revision !== op.policyRevision ||
      !same(active.accounts.evm ?? "", op.sourceAccount)) blocked("active_policy_changed_before_lease");
    const reservation = await this.usage.reserve({ ...this.usageIdentity(op), registry: active.registry,
      rail: "bridge", mechanism: { provider: "relay", reference: RELAY_ARBITRUM_SOURCE_DRAFT_REFERENCE },
      amountAtomic: op.amountAtomic, idempotencyKey: `relay-arbitrum-approval:${op.operationId}`, now: at });
    if (!["reserved", "submitted"].includes(reservation.state) || reservation.policyDigest !== op.policyDigest) blocked("usage_lease_unavailable");
  }
  private result(op: RelayUnsignedOperation, journal: ArbitrumSourceEffectJournal | null, state: string, reason: string) {
    return { operationId: op.operationId, state, reason, approvalPhase: journal?.effects[0].phase ?? null,
      depositPhase: journal?.effects[1].phase ?? null,
      transactionHash: journal?.effects[1].attempt?.transactionHash ?? null,
      journalIntegrityHash: journal?.integrityHash ?? null,
      depositDispatched: ["submitting", "submitted", "unknown_finality", "confirmed"].includes(journal?.effects[1].phase ?? ""),
      destinationDeliveryProven: false as const, paidAcceptance: false as const };
  }
  private async lockedPolicy(): Promise<ActiveAssetPolicy | null> {
    const at = this.now();
    return this.ports.activePolicyUnderLock === undefined ? activeAssetPolicyFromState(
      await new AllowlistPolicyStore(this.state.root).readUnderProfileLock("default"), at) :
      this.ports.activePolicyUnderLock(at);
  }
  async execute(profile: string, operationId: string) {
    if (profile !== "default" || !HASH.test(operationId))
      throw new ApnError("APN_INVALID_INPUT", "Relay Arbitrum deposit requires default profile and an operation ID.");
    const profileHash = this.state.profileHash(profile);
    const op = await (this.ports.operation?.(profileHash, operationId) ??
      new RelayUnsignedOperationRepository(this.state.root).loadOperation(profileHash, operationId));
    if (op === null) throw new ApnError("APN_OPERATION_NOT_FOUND", "Relay Arbitrum operation was not found.");
    if (op.arbitrumDraft === undefined || op.sourceChainId !== 42161 || op.destinationChainId !== 1 ||
      op.arbitrumDraft.executionAdmitted !== false) blocked("exact_saved_arbitrum_route_required");
    if (await new RelayRetirementRepository(this.state.root).load(op) !== null) blocked("operation_retired");
    const previous = await this.journals.load(profileHash, operationId);
    if (previous !== null && (previous.effects[1].phase !== "pending"))
      return this.result(op, previous, "observation_only", "deposit_effect_already_started");
    if (previous === null || !["confirmed", "approval_skipped"].includes(previous.effects[0].phase))
      blocked("approval_not_confirmed_or_verified_skipped");
    const summary: RelayArbitrumDepositSummary = { operationId, sourceChainId: 42161, destinationChainId: 1,
      owner: op.sourceAccount, token: RELAY_ARBITRUM_USDC, spender: ETHEREUM_DEPOSITORY,
      depositAmountAtomic: op.amountAtomic, quoteDigest: op.quoteDigest, deadline: op.deadline,
      depositNetworkFeeCeilingWei: op.depositNetworkFeeCeilingWei! };
    if (!await this.ports.confirm(summary)) blocked("foreground_authorization_declined");
    // No terminal wait occurs under a policy lock. Every effect-side lock is then acquired together
    // in SecureStateStore's profile -> operation -> remaining-key order.
    return this.state.withLocks([`profile:${profileHash}`, `profile:${allowlistProfileHash("default")}`,
      `operation:${operationId}`, `relay-arbitrum-effect:${operationId}`,
      `relay-arbitrum-approval-execute:${operationId}`, evmAddressLock(op.sourceAccount)], async () => {
      if (await new RelayRetirementRepository(this.state.root).load(op) !== null) blocked("operation_retired");
      let journal = await this.journals.load(profileHash, operationId);
      if (journal !== null && (journal.effects[1].phase !== "pending"))
        return this.result(op, journal, "observation_only", "deposit_effect_already_started");
      if (journal === null || !["confirmed", "approval_skipped"].includes(journal.effects[0].phase))
        blocked("approval_not_confirmed_or_verified_skipped");
      const firstPolicy = await this.lockedPolicy();
      if (firstPolicy === null) blocked("active_owner_policy_required");
      const first = await this.snapshot(op, firstPolicy);
      if (!first.readOnlyConditionsSatisfied) blocked(`preflight:${first.reasons.join(",")}`);
      // A second canonical read closes the gap between owner consent and the irreversible marker.
      const freshPolicy = await this.lockedPolicy();
      if (freshPolicy === null) blocked("active_owner_policy_required");
      const fresh = await this.snapshot(op, freshPolicy);
      if (!fresh.readOnlyConditionsSatisfied ||
        fresh.confirmedNonce !== fresh.pendingNonce) blocked("deposit_preflight_changed");

      await this.reserve(op, freshPolicy);
      journal = await this.journals.beginSigningUnderLocks(profileHash, operationId, journal.integrityHash, "deposit", this.now().toISOString());
      let raw: Hex;
      try { raw = await this.ports.signer.sign(op, fresh.confirmedNonce, journal); }
      catch { return this.result(op, journal, "observation_only", "signing_outcome_uncertain"); }
      journal = await this.journals.transitionUnderLocks(profileHash, operationId, journal.integrityHash,
        { kind: "seal_signed", role: "deposit", rawTransaction: raw, nonce: fresh.confirmedNonce });
      // Re-read the authenticated policy head under the same profile lock and keep it until the send settles.
      const finalPolicy = await this.lockedPolicy();
      if (finalPolicy === null || finalPolicy.digest !== op.policyDigest ||
        finalPolicy.revision !== op.policyRevision || !same(finalPolicy.accounts.evm ?? "", op.sourceAccount))
        return this.result(op, journal, "observation_only", "active_policy_revoked_or_changed");
      try {
        const final = await this.snapshot(op, finalPolicy);
        if (!final.readOnlyConditionsSatisfied ||
          final.confirmedNonce !== fresh.confirmedNonce || final.pendingNonce !== fresh.confirmedNonce ||
          this.now().getTime() - Date.parse(final.observedAt) > 30_000) blocked("pre_send_conditions_changed");
      } catch { return this.result(op, journal, "observation_only", "pre_send_conditions_unavailable"); }
      await this.owner(op);
      journal = await this.journals.transitionUnderLocks(profileHash, operationId, journal.integrityHash,
        { kind: "mark_submitting", role: "deposit", at: this.now().toISOString() });
      const expectedHash = journal.effects[1].attempt!.transactionHash;
      let outcome: "accepted" | "uncertain" = "uncertain";
      try { if (await this.ports.send(raw) === expectedHash) outcome = "accepted"; }
      catch { /* A transport error, including HTTP 429, leaves one ambiguous send. */ }
      journal = await this.journals.transitionUnderLocks(profileHash, operationId, journal.integrityHash,
        { kind: "record_send", role: "deposit", outcome });
      await this.usage.transition({ ...this.usageIdentity(op), reservationId: this.reservationId(op),
        policyDigest: op.policyDigest!, state: outcome === "accepted" ? "submitted" : "unknown_finality",
        expectedCurrentStates: ["reserved", "submitted"], now: this.now() });
      return this.result(op, journal, outcome === "accepted" ? "deposit_submitted" : "observation_only",
        outcome === "accepted" ? "single_send_accepted" : "single_send_uncertain");
    });
  }
}
