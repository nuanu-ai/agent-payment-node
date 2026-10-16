/** Explicit local retirement of an untouched prepared Relay quote, or owner abandonment of a token route whose
 * only sent effect is a confirmed approval. Nothing in flight, signed-but-unsent or already proven is retired here. */
import { ApnError } from "../errors.js";
import { getAddress } from "viem";
import { allowlistProfileHash } from "../allowlist-policy-overlay.js";
import { AssetUsageLedger, assetUsageReservationId } from "../asset-usage-ledger.js";
import { evmAddressLock } from "../evm-address-ownership.js";
import { MacOSLoginKeychainSecret, type WrappingSecretPort } from "../macos-keychain.js";
import { OperationService } from "../operation-service.js";
import { RelayRetirementRepository, RelayUnsignedOperationRepository, publicRelayUnsignedOperation, type RelayUnsignedOperation } from "../relay-unsigned-operation.js";
import type { ClockPort } from "../ports.js";
import { StateStore } from "../state.js";
import { RelayNativeSourceJournalRepository } from "./native-source-journal.js";
import { RelayEncryptedApprovalCustody } from "./approval-effect.js";
import { RelayEncryptedDepositCustody } from "./deposit-effect.js";
import { relayNativeRouteByReference } from "./native-routes.js";
import { relayAbandonSummary, relayRetireSource, releaseRelayHold, type RelayAbandonConsentPort, type RelayRetireSource } from "./retire-source.js";
export { TtyRelayAbandonConfirmation } from "./retire-source.js";

export class RelayRetireService {
  constructor(private readonly state: StateStore, private readonly clock: ClockPort,
    private readonly wrapping: WrappingSecretPort = new MacOSLoginKeychainSecret(),
    /** Required only to abandon a route after its confirmed approval; without it that case is refused. */
    private readonly abandon?: RelayAbandonConsentPort) {}

  /** Any profile retires its own operations: the operation is found only under `profileHash(profile)` (other profiles'
   * operations are invisible), and the owner lock is taken on the operation's own recorded source account (OWNR-08). */
  async retire(input: { readonly profile: string; readonly operationId: string }) {
    if (!/^[a-f0-9]{64}$/u.test(input.operationId))
      throw new ApnError("APN_INVALID_INPUT", "Relay retirement requires a profile and an operation ID.");
    allowlistProfileHash(input.profile);
    const profileHash = this.state.profileHash(input.profile);
    await this.state.initialize();
    const operations = new RelayUnsignedOperationRepository(this.state.root);
    const found = await operations.loadOperation(profileHash, input.operationId);
    if (found === null) {
      // Distinguish an operation belonging to another profile from one that does not exist.
      await new OperationService(this.state).required(input.operationId);
      throw new ApnError("APN_OPERATION_BLOCKED", "The operation is not a prepared Relay quote for this profile.");
    }
    // Owner consent to abandon is taken before any lock; the locked pass re-proves the same source journal.
    const consented = await this.abandonConsent(profileHash, input.operationId);
    return this.state.withLocks([`profile:${profileHash}`, `operation:${input.operationId}`,
      `relay-native-source:${input.operationId}`, evmAddressLock(found.sourceAccount)], async () => {
      const op = await operations.loadOperation(profileHash, input.operationId);
      // Prepared operations are create-only; the reload under the lock must be the same record.
      if (op === null || op.integrityHash !== found.integrityHash)
        throw new ApnError("APN_STATE_CORRUPT", "Relay operation changed during retirement.");
      if (op.nativeQuote === undefined) return this.retireTokenLane(op, input.profile, consented);
      const route = relayNativeRouteByReference(op.nativeQuote.routeReference);
      if (route === null || op.quote !== undefined || op.sourceChainId !== route.sourceChainId ||
        op.destinationChainId !== route.chainId || op.policyDigest === undefined || op.policyRevision === undefined) {
        throw new ApnError("APN_OPERATION_BLOCKED", "Relay retirement requires an exact saved native quote.");
      }
      const retirements = new RelayRetirementRepository(this.state.root);
      const existing = await retirements.load(op);
      if (op.nativeQuote !== undefined && await new RelayNativeSourceJournalRepository(this.state.root).hasEffectClaim(op))
        throw new ApnError("APN_OPERATION_BLOCKED", "Relay retirement is refused because a permanent native effect claim exists.");
      const nativeJournal = op.nativeQuote !== undefined
        ? await new RelayNativeSourceJournalRepository(this.state.root).load(op) : null;
      if (nativeJournal !== null && nativeJournal.phase !== "failed_before_effect") {
        throw new ApnError("APN_OPERATION_BLOCKED", "Relay retirement is refused because a native source journal exists.");
      }
      const nativeReservationId = nativeJournal === null ? undefined : assetUsageReservationId({
        account: getAddress(op.sourceAccount), chain: `eip155:${op.sourceChainId}`, asset: { kind: "native", identifier: null },
      }, `relay-native-execute:${op.operationId}`);
      if (nativeReservationId !== undefined &&
        (await new AssetUsageLedger(this.state.root).load({ account: getAddress(op.sourceAccount),
          chain: `eip155:${op.sourceChainId}`, asset: { kind: "native", identifier: null } }, nativeReservationId))?.state !== "failed_before_effect") {
        throw new ApnError("APN_OPERATION_BLOCKED", "Relay retirement requires a reconciled no-effect native usage reservation.");
      }
      return new RelayEncryptedApprovalCustody(this.state, this.wrapping, input.profile).withNoMaterial(op, async () =>
        new AssetUsageLedger(this.state.root).withNoMatchingRelayReservation(op.sourceAccount, op.policyDigest,
          op.amountAtomic, async () => {
            if (existing !== null) return publicRelayUnsignedOperation(op, existing);
            const now = this.clock.now();
            if (!Number.isFinite(now.getTime())) throw new ApnError("APN_INVALID_INPUT", "Relay retirement clock is invalid.");
            return publicRelayUnsignedOperation(op, await retirements.persistLocked(op, now.toISOString()));
          }, op.sourceChainId as 1 | 56 | 8453, nativeReservationId));
    });
  }
  private async abandonConsent(profileHash: string, operationId: string): Promise<string | null> {
    const op = await new RelayUnsignedOperationRepository(this.state.root).loadOperation(profileHash, operationId);
    if (op === null || op.nativeQuote !== undefined || await new RelayRetirementRepository(this.state.root).load(op) !== null) return null;
    const source = await relayRetireSource(this.state.root, op);
    if (source.kind !== "approval_only") return null;
    if (this.abandon === undefined) throw new ApnError("APN_OPERATION_BLOCKED", "Relay abandonment after an approval requires foreground owner consent.");
    if (!await this.abandon.confirm(relayAbandonSummary(op, source)))
      throw new ApnError("APN_OPERATION_BLOCKED", "Relay abandonment was declined.", { reason: "foreground_authorization_declined" });
    return source.journalIntegrityHash;
  }

  /** Ethereum and Arbitrum token lanes. The principal hold is released only after the source state is re-proven. */
  private async retireTokenLane(op: RelayUnsignedOperation, profile: string, consented: string | null) {
    const retirements = new RelayRetirementRepository(this.state.root), existing = await retirements.load(op);
    if (existing !== null) return publicRelayUnsignedOperation(op, existing);
    const source: RelayRetireSource = await relayRetireSource(this.state.root, op);
    if (source.kind === "approval_only" && source.journalIntegrityHash !== consented)
      throw new ApnError("APN_OPERATION_BLOCKED", "The Relay source journal changed after owner consent.");
    const now = this.clock.now();
    if (!Number.isFinite(now.getTime())) throw new ApnError("APN_INVALID_INPUT", "Relay retirement clock is invalid.");
    const persist = async () => publicRelayUnsignedOperation(op, await retirements.persistLocked(op, now.toISOString()));
    const custody = new RelayEncryptedApprovalCustody(this.state, this.wrapping, profile);
    if (source.kind === "approval_only") {
      // The confirmed approval's own signed slot may remain; deposit bytes may not. The held profile and operation
      // locks exclude any deposit signing marker, and a retired operation refuses every later journal transition.
      if (op.arbitrumDraft === undefined && await new RelayEncryptedDepositCustody(this.state, this.wrapping, profile).load(op) !== null)
        throw new ApnError("APN_OPERATION_BLOCKED", "Relay abandonment is refused because signed deposit bytes exist.");
      await releaseRelayHold(this.state.root, op, source, now); return persist();
    }
    if (op.arbitrumDraft !== undefined) { await releaseRelayHold(this.state.root, op, source, now); return persist(); }
    return custody.withNoMaterial(op, async () => {
      await releaseRelayHold(this.state.root, op, source, now);
      return new AssetUsageLedger(this.state.root).withNoMatchingRelayReservation(op.sourceAccount, op.policyDigest,
        op.amountAtomic, persist, 1, source.hold.reservationId);
    });
  }
}
