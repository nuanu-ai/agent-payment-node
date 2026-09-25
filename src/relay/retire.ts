/** Explicit local retirement of an untouched prepared Relay quote. */
import { ApnError } from "../errors.js";
import { allowlistProfileHash } from "../allowlist-policy-overlay.js";
import { AssetUsageLedger } from "../asset-usage-ledger.js";
import { OperationService } from "../operation-service.js";
import { RelayRetirementRepository, RelayUnsignedOperationRepository, publicRelayUnsignedOperation } from "../relay-unsigned-operation.js";
import type { ClockPort } from "../ports.js";
import { StateStore } from "../state.js";
import { RelayEffectJournalRepository } from "./effect-journal.js";

export class RelayRetireService {
  constructor(private readonly state: StateStore, private readonly clock: ClockPort) {}

  async retire(input: { readonly profile: string; readonly operationId: string }) {
    if (input.profile !== "default" || !/^[a-f0-9]{64}$/u.test(input.operationId))
      throw new ApnError("APN_INVALID_INPUT", "Relay retirement requires the default profile and an operation ID.");
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
      const retirements = new RelayRetirementRepository(this.state.root);
      const existing = await retirements.load(op);
      // Any effect intent, including a pending journal, makes local retirement unsafe.
      if (await new RelayEffectJournalRepository(this.state.root).load(profileHash, input.operationId) !== null ||
          await new AssetUsageLedger(this.state.root).hasMatchingRelayReservation(op.sourceAccount, op.policyDigest, op.amountAtomic)) {
        throw new ApnError("APN_OPERATION_BLOCKED", "Relay retirement is refused because effect or usage state exists.");
      }
      if (existing !== null) return publicRelayUnsignedOperation(op, existing);
      const now = this.clock.now();
      if (!Number.isFinite(now.getTime())) throw new ApnError("APN_INVALID_INPUT", "Relay retirement clock is invalid.");
      return publicRelayUnsignedOperation(op, await retirements.persistLocked(op, now.toISOString()));
    });
  }
}
