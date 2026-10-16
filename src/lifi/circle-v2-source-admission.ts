/** Owner allowlist admission and usage hold for the Base USDC -> Solana CCTP V2 source burn (OWNR-17). */
import { getAddress } from "viem";
import { hashObject } from "../canonical.js";
import { loadActiveAssetPolicyRegistry } from "../allowlist-active-policy.js";
import { bridgeMechanismAdmitted, evaluateAssetPolicy } from "../asset-policy-registry.js";
import { assertRecipientAdmitted } from "../allowlist-recipient-pins.js";
import { AssetUsageLedger, assetUsageReservationId, type AssetUsageIdentity } from "../asset-usage-ledger.js";
import type { StateStore } from "../state.js";
import { bridgeFailure } from "./validation.js";

export const CIRCLE_V2_BASE_SOLANA_MECHANISM = Object.freeze({ provider: "circle-cctp-v2", reference: "circle-v2-base-solana-withfees.v1" });
const BASE_USDC = getAddress("0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913");

function refused(reason: string): never { return bridgeFailure("APN_ALLOWLIST_REFUSED", `circle_v2_source_${reason}`); }

/** The burned principal is held against the payer's Base USDC bridge cap from before signing until settled. */
export class CircleV2SourceAdmission {
  private readonly ledger: AssetUsageLedger;
  private readonly identity: AssetUsageIdentity;
  private readonly reservationId: string;
  private policyDigest: string | null = null;
  /** `recipient` is the Solana wallet that owns the destination USDC account; an owner recipient pin must list it (OD-1). */
  constructor(private readonly state: StateStore, private readonly profile: string, payer: string,
    private readonly amountAtomic: string, private readonly operationId: string, private readonly now: () => Date, private readonly recipient: string) {
    this.ledger = new AssetUsageLedger(state.root);
    this.identity = { account: getAddress(payer), chain: "eip155:8453", asset: { kind: "token", identifier: BASE_USDC } };
    this.reservationId = assetUsageReservationId(this.identity, this.key());
  }
  private key() { return `circle-v2-base-source:${this.operationId}`; }
  private async active() {
    const active = await loadActiveAssetPolicyRegistry({ state: this.state, clock: { now: this.now } }, this.profile);
    if (active === null || active.accounts.evm?.toLowerCase() !== this.identity.account.toLowerCase()) refused("active_owner_policy_required");
    return active;
  }
  /** Read-only admission before the owner is asked: policy account, Base USDC bridge rail, CCTP mechanism and caps. */
  async admit(): Promise<void> { const at = this.now(); await this.evaluate(await this.active(), (await this.ledger.usage(this.identity, at)).amountAtomic); }
  private async evaluate(active: Awaited<ReturnType<CircleV2SourceAdmission["active"]>>, dailyUsageAtomic: string): Promise<void> {
    const at = this.now();
    const admission = evaluateAssetPolicy(active.registry, { chain: this.identity.chain, asset: this.identity.asset, rail: "bridge",
      mechanism: CIRCLE_V2_BASE_SOLANA_MECHANISM, amountAtomic: this.amountAtomic, dailyUsageAtomic,
      asOfDate: at.toISOString().slice(0, 10), asOf: at.toISOString() });
    if (!bridgeMechanismAdmitted(admission, CIRCLE_V2_BASE_SOLANA_MECHANISM)) refused("mechanism_not_admitted");
    assertRecipientAdmitted({ admission, mechanism: CIRCLE_V2_BASE_SOLANA_MECHANISM, recipient: this.recipient });
  }
  /** After consent and before signing: the ledger re-evaluates the active policy and caps atomically. */
  async reserve(): Promise<void> {
    // Mechanism and recipient pin of the admission row; the ledger reservation checks the caps (a replayed hold is not counted twice).
    const active = await this.active(); await this.evaluate(active, "0");
    const reservation = await this.ledger.reserve({ ...this.identity, registry: active.registry, rail: "bridge",
      mechanism: CIRCLE_V2_BASE_SOLANA_MECHANISM, amountAtomic: this.amountAtomic, idempotencyKey: this.key(), now: this.now() });
    if (reservation.state !== "reserved") refused("usage_hold_unavailable");
    this.policyDigest = reservation.policyDigest;
  }
  /** Nothing was signed: the hold is released without counting. */
  async releaseBeforeEffect(): Promise<void> {
    if (this.policyDigest === null) return;
    await this.transition("failed_before_effect", ["reserved"]);
  }
  /** The one send was accepted or is ambiguous: the principal stays counted as spent. */
  async followSend(state: "submitted" | "unknown_finality"): Promise<void> {
    await this.transition(state, ["reserved"]);
  }
  private async transition(state: "failed_before_effect" | "submitted" | "unknown_finality", expected: readonly ("reserved")[]) {
    if (this.policyDigest === null) refused("usage_hold_missing");
    await this.ledger.transition({ ...this.identity, reservationId: this.reservationId, policyDigest: this.policyDigest, state,
      expectedCurrentStates: [...expected], now: this.now(),
      ...(state === "failed_before_effect" ? { outcomeDigest: hashObject({ kind: "circle_v2_base_source_no_signature", operationId: this.operationId }) } : {}) });
  }
}
