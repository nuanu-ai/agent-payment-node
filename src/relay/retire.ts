/** Explicit local retirement of an untouched prepared Relay quote. */
import { ApnError } from "../errors.js";
import { allowlistProfileHash } from "../allowlist-policy-overlay.js";
import { AssetUsageLedger } from "../asset-usage-ledger.js";
import { MacOSLoginKeychainSecret, type WrappingSecretPort } from "../macos-keychain.js";
import { OperationService } from "../operation-service.js";
import { RelayRetirementRepository, RelayUnsignedOperationRepository, publicRelayUnsignedOperation } from "../relay-unsigned-operation.js";
import type { ClockPort } from "../ports.js";
import { StateStore } from "../state.js";
import { RelayEffectJournalRepository } from "./effect-journal.js";
import { RelayEncryptedApprovalCustody } from "./approval-effect.js";
import { RELAY_BNB_SOURCE, relayNativeRoute } from "./native-quote.js";

export class RelayRetireService {
  constructor(private readonly state: StateStore, private readonly clock: ClockPort,
    private readonly wrapping: WrappingSecretPort = new MacOSLoginKeychainSecret()) {}

  async retire(input: { readonly profile: string; readonly operationId: string }) {
    if ((input.profile !== "default" && input.profile !== "evm-live-buyer") || !/^[a-f0-9]{64}$/u.test(input.operationId))
      throw new ApnError("APN_INVALID_INPUT", "Relay retirement requires an admitted profile and an operation ID.");
    allowlistProfileHash(input.profile);
    const profileHash = this.state.profileHash(input.profile);
    await this.state.initialize();
    return this.state.withLocks([`profile:${profileHash}`, `operation:${input.operationId}`], async () => {
      const op = await new RelayUnsignedOperationRepository(this.state.root).loadOperation(profileHash, input.operationId);
      if (op === null) {
        // Distinguish an operation belonging to another profile from one that does not exist.
        await new OperationService(this.state).required(input.operationId);
        throw new ApnError("APN_OPERATION_BLOCKED", "The operation is not a prepared Relay quote for this profile.");
      }
      if (input.profile === "evm-live-buyer") {
        let route: ReturnType<typeof relayNativeRoute> | null = null;
        try { route = relayNativeRoute(op.recipient); } catch { /* outside the buyer native lanes */ }
        if (route === null || op.nativeQuote === undefined || op.quote !== undefined ||
          op.sourceChainId !== 56 || op.destinationChainId !== route.chainId ||
          op.sourceAccount.toLowerCase() !== RELAY_BNB_SOURCE.toLowerCase() ||
          op.nativeQuote.routeReference !== route.reference ||
          op.policyDigest === undefined || op.policyRevision === undefined) {
          throw new ApnError("APN_OPERATION_BLOCKED", "Relay retirement requires an exact buyer native quote.");
        }
      }
      if (input.profile === "default" && op.nativeQuote !== undefined) {
        throw new ApnError("APN_OPERATION_BLOCKED", "Default Relay retirement requires its Ethereum USDC quote.");
      }
      const retirements = new RelayRetirementRepository(this.state.root);
      const existing = await retirements.load(op);
      // Any effect intent, including a pending journal, makes local retirement unsafe.
      if (await new RelayEffectJournalRepository(this.state.root).load(profileHash, input.operationId) !== null) {
        throw new ApnError("APN_OPERATION_BLOCKED", "Relay retirement is refused because an effect journal exists.");
      }
      return new RelayEncryptedApprovalCustody(this.state, this.wrapping).withNoMaterial(op, async () =>
        new AssetUsageLedger(this.state.root).withNoMatchingRelayReservation(op.sourceAccount, op.policyDigest,
          op.amountAtomic, async () => {
            if (existing !== null) return publicRelayUnsignedOperation(op, existing);
            const now = this.clock.now();
            if (!Number.isFinite(now.getTime())) throw new ApnError("APN_INVALID_INPUT", "Relay retirement clock is invalid.");
            return publicRelayUnsignedOperation(op, await retirements.persistLocked(op, now.toISOString()));
          }, input.profile === "evm-live-buyer" ? 56 : 1), input.profile);
    });
  }
}
