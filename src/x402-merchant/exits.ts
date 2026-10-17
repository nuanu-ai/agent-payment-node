import { formatUnits, type Hex } from "viem";
import { AssetUsageLedger, assetUsageReservationId, type AssetUsageIdentity } from "../asset-usage-ledger.js";
import { canonicalJson, hashObject, isPlainRecord } from "../canonical.js";
import { ApnError } from "../errors.js";
import { evmAddressLock } from "../evm-address-ownership.js";
import { provesUnlanded, readEvmUnlandedEvidence } from "../evm-unlanded-proof.js";
import type { OperationAbandonApprovalPort } from "../operation-abandon-approval.js";
import { SecureStateStore } from "../secure-state-store.js";
import type { StateStore } from "../state.js";
import { canonicalOperationId } from "../transfer-policy.js";
import { merchantMove, type MerchantExit, type MerchantOperation } from "./model.js";
import { merchantNativeUsageIdentity, merchantNativeUsageKey, merchantUsageIdentity, merchantUsageKey } from "./owner.js";
import { refuse } from "./protocol.js";
import { MerchantRepository } from "./repository.js";
import type { MerchantRpcPort } from "./rpc.js";
import { merchantTerms } from "./terms.js";

/** The locks every command that changes one merchant payment holds. */
export function merchantLocks(profileHash: string, operationId: string, idempotencyHash: string, payer: string): string[] {
  return [`profile:${profileHash}`, `operation:${operationId}`, `operation:idempotency:${idempotencyHash}`, evmAddressLock(payer)];
}
const OPEN_ATTEMPTS: readonly MerchantOperation["state"][] = ["signing_started", "submission_started", "unknown_finality"];

/** The durable fences approve writes around custody: the SIGN claim, the sealed signed bytes, the SEND claim and a retirement. */
class MerchantFences extends SecureStateStore {
  async read(o: MerchantOperation): Promise<{ readonly sign: boolean; readonly signed: Hex | null; readonly retired: boolean }> {
    const id = o.operationId, claim = (effect: "sign" | "send", txHash: unknown) => {
      const body = { schemaVersion: "apn.merchant-effect-claim.v1", operationId: id, profileHash: o.profileHash, fingerprint: o.fingerprint, effect, txHash };
      return { ...body, claimDigest: hashObject(body) };
    };
    const [sign, send, material, retired] = await Promise.all([`merchant-effect-claims/${id}.sign.json`, `merchant-effect-claims/${id}.send.json`,
      `merchant-material/${id}.json`, `merchant-retirement/${id}.json`].map(async path => await this.readJson(path)));
    if (sign !== null && canonicalJson(sign) !== canonicalJson(claim("sign", null))) refuse("merchant_exit_fence_binding");
    const hashes = [send === null ? null : isPlainRecord(send) && canonicalJson(send) === canonicalJson(claim("send", send.txHash)) ? send.txHash : undefined,
      material === null ? null : isPlainRecord(material) && material.schemaVersion === "apn.merchant-material.v1" && material.operationId === id &&
        material.profileHash === o.profileHash && material.fingerprint === o.fingerprint ? material.txHash : undefined].filter(h => h !== null);
    if (hashes.some(h => typeof h !== "string" || !/^0x[0-9a-f]{64}$/u.test(h)) || new Set(hashes).size > 1) refuse("merchant_exit_fence_binding");
    return { sign: sign !== null, signed: (hashes[0] as Hex | undefined) ?? null, retired: retired !== null };
  }
}

/**
 * The exits of a merchant payment that holds no payment receipt (phase 4c R4). Proof first, with no consent: a payment
 * never signed, or whose signature never left a process that died before sealing it, ends `failed_before_effect` once
 * its local deadline passed (custody refuses to sign after it); a signed transaction ends `failed_proven_superseded`
 * once another transaction took its nonce at the finalized tag and the node knows neither it nor a receipt. Both
 * release the payment's holds. When no proof decides, the owner's TTY consent ends it `abandoned_unknown` with both
 * holds still charged. Nothing here signs, sends or delivers.
 */
export class MerchantExits {
  private readonly records: MerchantRepository;
  private readonly fences: MerchantFences;
  private readonly ledger: AssetUsageLedger;
  constructor(private readonly state: StateStore, private readonly rpc: MerchantRpcPort, private readonly now: () => Date) {
    this.records = new MerchantRepository(state.root); this.fences = new MerchantFences(state.root); this.ledger = new AssetUsageLedger(state.root);
  }

  /** The proven exit of an attempt without a receipt, or null while none is proven (nothing changes). The caller holds merchantLocks. */
  async settle(o: MerchantOperation): Promise<MerchantOperation | null> { return (await this.decide(o)).next; }

  /** `landed`: the node holds a receipt for the attempt's transaction, so observation (not an exit) records its outcome. */
  private async decide(o: MerchantOperation): Promise<{ readonly next: MerchantOperation | null; readonly landed: boolean }> {
    const open = { next: null, landed: false };
    if (o.terminal || o.receipt !== null || o.state !== "prepared" && !OPEN_ATTEMPTS.includes(o.state)) return open;
    const fence = await this.fences.read(o);
    // A retirement tombstone belongs to retire-unsent, which finishes that attempt itself.
    if (fence.retired) return open;
    if (o.submissionAttempts === 0 && fence.signed === null) {
      // Custody signs only under the SIGN claim, sealing is the only durable copy of signed bytes, and the wire comes after
      // the durable submission fence: nothing of this attempt ever left the process.
      if (this.now().toISOString() < o.expiresAt) return open;
      return { next: await this.finish(o, "failed_before_effect", { reason: fence.sign ? "signature_never_left_process" : "never_signed" }), landed: false };
    }
    const hash = o.txHash ?? fence.signed!;
    const evidence = await readEvmUnlandedEvidence(async calls => await this.rpc.batch(calls), 4326, merchantTerms(o).payer, hash);
    if (!provesUnlanded(evidence, o.envelope.nonce)) return { next: null, landed: evidence.receiptFound };
    return { next: await this.finish(o, "failed_proven_superseded", { reason: "finalized_nonce_superseded", finalizedNonce: evidence.finalizedNonce,
      transactionHash: hash }), landed: false };
  }

  async abandon(idInput: string, consent: OperationAbandonApprovalPort): Promise<MerchantOperation> {
    const found = await this.required(idInput);
    return await this.state.withLocks(merchantLocks(found.profileHash, found.operationId, found.idempotencyHash, found.custody.walletAddress), async () => {
      const o = await this.required(found.operationId);
      if (o.state === "abandoned_unknown") return o;
      if (o.terminal) throw blocked(o, "operation_already_terminal", "The merchant payment is already terminal; there is nothing to abandon.", "status");
      let decided: { readonly next: MerchantOperation | null; readonly landed: boolean } = { next: null, landed: false };
      // A proof ends the attempt without consent; an unreachable chain leaves the owner's consent as the exit.
      try { decided = await this.decide(o); } catch (error) { if (!(error instanceof ApnError)) throw error; }
      if (decided.next !== null) return decided.next;
      if (decided.landed) throw blocked(o, "merchant_abandon_receipt_exists", "The payment's transaction has a receipt: observe records its outcome.", "observe");
      if (o.signingAttempts !== 1 || !OPEN_ATTEMPTS.includes(o.state)) {
        throw blocked(o, "merchant_abandon_not_unknown", o.receipt === null
          ? "An unsigned merchant payment needs no abandon: observe closes it once its deadline passed."
          : "The merchant payment is finalized; observe --deliver retries delivery with the same proof.", o.receipt === null ? "observe" : "deliver");
      }
      if (this.now().toISOString() < o.expiresAt) throw blocked(o, "merchant_abandon_before_deadline", "The merchant payment can be abandoned only after its deadline.", "observe");
      const t = merchantTerms(o);
      await consent.approve({ operationId: o.operationId, fingerprint: o.fingerprint, profile: o.profile, providerId: t.mechanism.provider, walletAddress: t.payer,
        recipient: t.payee, amountAtomic: t.amount, amountDecimal: formatUnits(BigInt(t.amount), t.asset.decimals), chainLabel: t.chain,
        assetLabel: `${t.asset.symbol} (${t.token})`, unit: t.asset.symbol,
        outcomeNote: `Financial outcome: UNKNOWN. ${o.txHash === null ? "A signed transfer may exist; APN never sent it." : `Transaction ${o.txHash} may still land.`} The payment and fee holds stay charged.` });
      const next = merchantMove(o, "abandoned_unknown", this.now().toISOString(), { exit: { reason: "owner_abandoned" } });
      await this.records.persist(next);
      return next;
    });
  }

  /** Holds first (a retry after a crash repeats the same outcome digest), then the terminal record. */
  private async finish(o: MerchantOperation, state: "failed_before_effect" | "failed_proven_superseded", exit: MerchantExit): Promise<MerchantOperation> {
    const t = merchantTerms(o), outcomeDigest = hashObject({ kind: `merchant_${state}`, operationId: o.operationId, fingerprint: o.fingerprint });
    const holds: [AssetUsageIdentity, string, string][] = [[merchantUsageIdentity(t), merchantUsageKey(o.operationId), t.amount]];
    if (o.effectBinding !== undefined) holds.push([merchantNativeUsageIdentity(t), merchantNativeUsageKey(o.operationId), o.effectBinding.nativeAmountAtomic]);
    for (const [identity, key, amount] of holds) {
      const reservationId = assetUsageReservationId(identity, key), r = await this.ledger.load(identity, reservationId);
      if (r === null) continue;
      if (r.policyDigest !== o.policy.digest || r.rail !== "x402" || r.amountAtomic !== amount) refuse("merchant_exit_hold_binding");
      // Nothing was paid and no fee was spent: a hold never marked as possibly spent is released as unsubmitted.
      const target = r.state === "reserved" || state === "failed_before_effect" ? "released_unsubmitted" : "failed_confirmed_revert";
      if (r.state === target && r.outcomeDigest === outcomeDigest) continue;
      if (r.state !== "reserved" && r.state !== "unknown_finality") refuse("merchant_exit_hold_binding");
      await this.ledger.transition({ ...identity, reservationId, policyDigest: r.policyDigest, state: target, expectedCurrentStates: [r.state], outcomeDigest, now: this.now() });
    }
    const next = merchantMove(o, state, this.now().toISOString(), { exit });
    await this.records.persist(next);
    return next;
  }

  private async required(id: string): Promise<MerchantOperation> {
    const o = await this.records.findOperation(canonicalOperationId(id));
    if (o === null) throw new ApnError("APN_OPERATION_NOT_FOUND", "Merchant operation was not found.");
    return o;
  }
}

function blocked(o: MerchantOperation, reason: string, message: string, next: "status" | "observe" | "deliver"): ApnError {
  const id = o.operationId;
  return new ApnError("APN_OPERATION_BLOCKED", message, { operationId: id, state: o.state, reason, nextActions: [next === "status"
    ? `apn operation status --operation ${id}` : `apn x402 merchant observe --operation ${id}${next === "deliver" ? " --deliver" : ""}`] });
}
