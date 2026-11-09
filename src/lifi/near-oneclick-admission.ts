/** Owner allowlist admission and the shared usage hold of one NEAR 1Click source deposit. */
import { getAddress } from "viem";
import { loadActiveAssetPolicyRegistry, type ActiveAssetPolicy } from "../allowlist-active-policy.js";
import { assertRecipientAdmitted } from "../allowlist-recipient-pins.js";
import { bridgeMechanismAdmitted, evaluateAssetPolicy } from "../asset-policy-registry.js";
import { AssetUsageLedger, assetUsageReservationId, type AssetUsageIdentity, type AssetUsageReservation,
  type AssetUsageState } from "../asset-usage-ledger.js";
import { hashObject } from "../canonical.js";
import type { StateStore } from "../state.js";
import { oneClickRecordLane, type OneClickSourceRecord } from "./near-oneclick-source-journal.js";
import type { OneClickLane } from "./near-oneclick-lanes.js";
import { bridgeFailure } from "./validation.js";

/** One exact bridge mechanism per lane: an owner admits each lane on its own, with its own cap and recipient pin. */
export function oneClickMechanism(lane: Pick<OneClickLane, "id">): Readonly<{ provider: "near-1click"; reference: string }> {
  return Object.freeze({ provider: "near-1click" as const, reference: `${lane.id}.v1` });
}
/** The payer's origin asset: Base USDC on the Base lane, Ethereum ETH on the Ethereum lanes. */
export function oneClickUsageIdentity(lane: OneClickLane, payer: string): AssetUsageIdentity {
  const asset = lane.origin.kind === "native" ? { kind: "native" as const, identifier: null }
    : { kind: "token" as const, identifier: getAddress(lane.origin.token ?? "") };
  return { account: getAddress(payer), chain: `eip155:${lane.origin.chainId}`, asset };
}
const usageKey = (operationId: string) => `oneclick-source:${operationId}`;
function refused(reason: string): never { return bridgeFailure("APN_ALLOWLIST_REFUSED", `oneclick_source_${reason}`, {}); }

/** The deposit principal is held against the payer's origin-asset bridge caps from before signing until its outcome. */
export class OneClickSourceAdmission {
  private readonly ledger: AssetUsageLedger;
  private readonly identity: AssetUsageIdentity;
  private readonly mechanism: ReturnType<typeof oneClickMechanism>;
  private policyDigest: string | null = null;
  /** `recipient` is the TRON or Solana destination recipient; an owner recipient pin must list it (OD-1). */
  constructor(private readonly state: StateStore, private readonly profile: string, lane: OneClickLane, payer: string,
    private readonly amountAtomic: string, private readonly operationId: string, private readonly recipient: string,
    private readonly now: () => Date) {
    this.ledger = new AssetUsageLedger(state.root);
    this.identity = oneClickUsageIdentity(lane, payer);
    this.mechanism = oneClickMechanism(lane);
  }
  private async active(): Promise<ActiveAssetPolicy> {
    const active = await loadActiveAssetPolicyRegistry({ state: this.state, clock: { now: this.now } }, this.profile);
    if (active === null || active.accounts.evm === undefined || getAddress(active.accounts.evm) !== this.identity.account) {
      refused("active_owner_policy_required");
    }
    return active;
  }
  /** Read-only, before the quote: policy account, the origin asset's bridge rail, this lane's mechanism, caps and pin. */
  async admit(): Promise<void> {
    await this.evaluate(await this.active(), (await this.ledger.usage(this.identity, this.now())).amountAtomic);
  }
  private async evaluate(active: ActiveAssetPolicy, dailyUsageAtomic: string): Promise<void> {
    const at = this.now();
    const admission = evaluateAssetPolicy(active.registry, { chain: this.identity.chain, asset: this.identity.asset, rail: "bridge",
      mechanism: this.mechanism, amountAtomic: this.amountAtomic, dailyUsageAtomic, asOfDate: at.toISOString().slice(0, 10), asOf: at.toISOString() });
    if (!bridgeMechanismAdmitted(admission, this.mechanism)) refused("mechanism_not_admitted");
    assertRecipientAdmitted({ admission, mechanism: this.mechanism, recipient: this.recipient });
  }
  /** After consent and before signing: the active policy and its pin again; the ledger checks the caps atomically. */
  async reserve(): Promise<void> {
    const active = await this.active(); await this.evaluate(active, "0");
    const reservation = await this.ledger.reserve({ ...this.identity, registry: active.registry, rail: "bridge", mechanism: this.mechanism,
      amountAtomic: this.amountAtomic, idempotencyKey: usageKey(this.operationId), now: this.now() });
    if (reservation.state !== "reserved") refused("usage_hold_unavailable");
    this.policyDigest = reservation.policyDigest;
  }
  /** Nothing was sealed, so the signature never left this process: the hold is released without counting. */
  async releaseBeforeEffect(): Promise<void> {
    if (this.policyDigest === null) return;
    await this.ledger.transition({ ...this.identity, reservationId: assetUsageReservationId(this.identity, usageKey(this.operationId)),
      policyDigest: this.policyDigest, state: "failed_before_effect", expectedCurrentStates: ["reserved"], now: this.now(),
      outcomeDigest: hashObject({ kind: "oneclick_source_unsealed", operationId: this.operationId }) });
  }
}

export interface OneClickUsage { readonly reservationId: string; readonly state: AssetUsageState; readonly amountAtomic: string }
type Step = Exclude<AssetUsageState, "reserved">;
const OPEN: readonly AssetUsageState[] = ["reserved", "submitted", "unknown_finality"];

/**
 * The ledger path a journal phase proves, from each open hold state. An unsigned or sealed record proves nothing yet (an
 * unsigned one past its deadline is released by `releaseUnsignedOneClickUsage`); a sent one is `submitted`, an
 * ambiguous one `unknown_finality`; a safe receipt finalizes the spend or confirms the revert; a source proven never to
 * land releases it.
 */
function path(record: OneClickSourceRecord, from: AssetUsageState): readonly Step[] {
  switch (record.phase) {
    case "submitting": case "unknown_finality": return from === "unknown_finality" ? [] : ["unknown_finality"];
    case "submitted_pending": return from === "reserved" ? ["submitted"] : [];
    case "source_observed":
      if (record.sourceReceiptStatus === "success") return ["finalized"];
      return from === "reserved" ? ["submitted", "failed_confirmed_revert"] : ["failed_confirmed_revert"];
    case "failed_proven_superseded": return from === "submitted" ? ["unknown_finality", "released_unsubmitted"] : ["released_unsubmitted"];
    default: return [];
  }
}

/**
 * Brings this operation's hold to the state its journal proves, idempotently. Records written before 1Click held usage
 * have no hold and are left alone; a hold whose principal is not this deposit's is never touched.
 */
export async function settleOneClickUsage(root: string, record: OneClickSourceRecord, now: Date): Promise<OneClickUsage | null> {
  const identity = oneClickUsageIdentity(oneClickRecordLane(record), record.payer), ledger = new AssetUsageLedger(root);
  const reservationId = assetUsageReservationId(identity, usageKey(record.operationId));
  let hold: AssetUsageReservation | null = await ledger.load(identity, reservationId);
  if (hold === null) return null;
  if (OPEN.includes(hold.state) && hold.amountAtomic === record.amountInAtomic) {
    const outcomeDigest = hashObject({ kind: "oneclick_source_outcome", operationId: record.operationId, phase: record.phase,
      receiptHash: record.sourceReceiptHash, finalizedNonceAtomic: record.finalizedNonceAtomic ?? null });
    for (const state of path(record, hold.state)) {
      const terminal = !OPEN.includes(state);
      hold = await ledger.transition({ ...identity, reservationId, policyDigest: hold.policyDigest, state, expectedCurrentStates: [hold.state],
        now, ...(terminal ? { outcomeDigest } : {}) });
    }
  }
  return { reservationId, state: hold.state, amountAtomic: hold.amountAtomic };
}

/** An unsigned record past its effective deadline can never be sealed (the journal refuses it): its hold is released. */
export async function releaseUnsignedOneClickUsage(root: string, record: OneClickSourceRecord, now: Date): Promise<void> {
  const identity = oneClickUsageIdentity(oneClickRecordLane(record), record.payer), ledger = new AssetUsageLedger(root);
  const reservationId = assetUsageReservationId(identity, usageKey(record.operationId));
  const hold = await ledger.load(identity, reservationId);
  if (hold === null || hold.state !== "reserved" || hold.amountAtomic !== record.amountInAtomic) return;
  await ledger.transition({ ...identity, reservationId, policyDigest: hold.policyDigest, state: "failed_before_effect",
    expectedCurrentStates: ["reserved"], now, outcomeDigest: hashObject({ kind: "oneclick_source_unsealed", operationId: record.operationId }) });
}
