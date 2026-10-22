import { randomBytes } from "node:crypto";
import { canonicalJson, domainHash, sha256 } from "../canonical.js";
import { AssetUsageLedger } from "../asset-usage-ledger.js";
import type { ChainWalletStoragePort } from "../direct-rail-ports.js";
import { ApnError } from "../errors.js";
import { railConflictDomain, conflictDomainKey } from "../operation-conflict-domain.js";
import { admitOperation } from "../operation-index/admission.js";
import type { HttpPort } from "../ports.js";
import { readSolanaBlockHeight, type SolanaRpcPort } from "../solana/rpc.js";
import { canonicalIdempotencyKey } from "../transfer-policy.js";
import { canonicalProfile } from "../wallet-policy.js";
import { evaluateX402Solana, followX402SolanaUsage, payeeAdmitted, x402SolanaOwnerRow, x402SolanaUsageIdentity, x402SolanaUsageKey } from "./admission.js";
import { bindX402SolanaLifetime, readX402SolanaAccounts } from "./chain.js";
import { X402_SOLANA_APPROVAL_WINDOW_MS, X402_SOLANA_COMPUTE_UNIT_LIMIT, X402_SOLANA_COMPUTE_UNIT_PRICE_MICROLAMPORTS, X402_SOLANA_FAMILY,
  X402_SOLANA_MECHANISM, X402_SOLANA_ALLOWLIST_CHAIN, X402_SOLANA_NETWORK, X402_SOLANA_NONCE_BYTES } from "./constants.js";
import { readSolanaChallenge, requireSolanaRpcUrl, sendSolanaPayment, solanaPaymentHeader } from "./http.js";
import { newX402SolanaRecord, transitionX402Solana, type X402SolanaRecord } from "./model.js";
import { observeX402SolanaPayment } from "./observe.js";
import { refuseNativeSol, selectSolanaOffer } from "./offer.js";
import { X402SolanaRepository } from "./repository.js";
import { signX402Solana, x402SolanaAccount, x402SolanaMessageTerms } from "./signing.js";
import { assertSolanaUnattendedBalance, requireSolanaPolicy, solanaPolicyBinding } from "./policy.js";
import type { ProfilePolicyPort, ProfilePolicyRecord } from "../profile-policy.js";

export interface X402SolanaPorts {
  readonly accounts: ChainWalletStoragePort;
  readonly http: HttpPort;
  /** Built only from an explicit APN_SOLANA_RPC_URL; absent for commands that read nothing from the chain. */
  readonly rpc?: SolanaRpcPort;
  readonly now: () => Date;
  /** The owner's encrypted profile x402 policy store (Solana binding per mint); only read here, never changed. */
  readonly policy?: ProfilePolicyPort;
}
export interface X402SolanaPayRequest { readonly profile: string; readonly url: string; readonly mint: string; readonly maxAmountAtomic: string; readonly idempotencyKey: string }

export class X402SolanaService {
  readonly records: X402SolanaRepository;
  constructor(private readonly root: string, private readonly ports: X402SolanaPorts) { this.records = new X402SolanaRepository(root); }

  private now(): Date { return new Date(Math.floor(this.ports.now().getTime() / 1000) * 1000); }
  private rpc(): SolanaRpcPort {
    if (this.ports.rpc === undefined) requireSolanaRpcUrl(undefined);
    return this.ports.rpc!;
  }
  private policyPort(): ProfilePolicyPort {
    if (this.ports.policy === undefined) throw new ApnError("APN_INTERNAL", "The profile policy store is not installed.");
    return this.ports.policy;
  }
  /** The owner's policy of this payment's mint, unchanged since prepare (a lowered or replaced policy refuses here). */
  private async currentPolicy(record: X402SolanaRecord): Promise<ProfilePolicyRecord> {
    const policy = await requireSolanaPolicy(this.policyPort(), await solanaPolicyBinding(this.ports.accounts, record.profile, record.terms.mint));
    if (policy.integrityHash !== record.terms.policy.integrityHash) {
      throw new ApnError("APN_PROFILE_DRIFT", "The owner's Solana x402 policy changed after preparation; this payment cannot continue. " +
        "Observe it once it expires (that releases the account), then prepare a new payment.",
        { reason: "x402_solana_policy_changed", nextActions: [`apn x402 solana observe --operation ${record.operationId}`] });
    }
    return policy;
  }
  private async locked<T>(id: string, action: (current: X402SolanaRecord) => Promise<T>): Promise<T> {
    return await this.records.withLocks([`operation:${id}`], async () => await action(await this.records.required(id)));
  }
  private async write(record: X402SolanaRecord, next: Parameters<typeof transitionX402Solana>[1]): Promise<X402SolanaRecord> {
    return await this.records.persistLocked(transitionX402Solana(record, next));
  }

  /** Freeze one admitted payment (or replay the one this key already names); nothing is reserved or signed here. */
  async prepare(input: X402SolanaPayRequest): Promise<X402SolanaRecord> {
    const profile = canonicalProfile(input.profile), key = canonicalIdempotencyKey(input.idempotencyKey);
    const profileHash = this.records.profileHash(profile);
    const operationId = domainHash("apn.x402-solana.operation-id.v1", canonicalJson({ profileHash, key }));
    const requestHash = domainHash("apn.x402-solana.request.v1", canonicalJson({ profileHash, url: input.url, mint: input.mint, maxAmountAtomic: input.maxAmountAtomic }));
    await this.records.ready();
    const saved = await this.records.find(operationId);
    if (saved !== null) return replay(saved, requestHash);
    const account = await x402SolanaAccount(this.ports.accounts, profile);
    const rpc = this.rpc(), now = this.now();
    // The unpaid challenge first: a native SOL offer is outside the scheme whatever the owner admitted.
    const challenge = await readSolanaChallenge(this.ports.http, input.url);
    refuseNativeSol(challenge.accepts, input.mint);
    const policy = await requireSolanaPolicy(this.policyPort(), await solanaPolicyBinding(this.ports.accounts, profile, input.mint));
    const owner = await x402SolanaOwnerRow(this.root, profile, account.address, input.mint, now);
    // The explicit maximum, the owner's unattended per-payment cap and the allowlist per-payment cap: the smallest binds.
    const cap = [BigInt(input.maxAmountAtomic), BigInt(policy.maxX402AmountAtomic), BigInt(owner.caps.maximumPerTransferAtomic)]
      .reduce((low, value) => value < low ? value : low);
    const offer = selectSolanaOffer({ accepts: challenge.accepts, mint: input.mint, payer: account.address, capAtomic: cap,
      payeeAdmitted: (payee) => payeeAdmitted(owner, payee, now) });
    const idempotencyHash = sha256(`idempotency\0x402-solana.v1\0${profileHash}\0${key}`);
    return await this.records.withLocks([`profile:${profileHash}`, `operation:${operationId}`], async () => {
      const existing = await this.records.find(operationId);
      if (existing !== null) return replay(existing, requestHash);
      // The account claim is written before any chain read, and dropped when no record is written.
      return await admitOperation(this.records, { family: X402_SOLANA_FAMILY, profileHash, operationId, idempotencyHash, requestHash },
        [{ key: conflictDomainKey(railConflictDomain("solana", account.address)) }], async () => {
          const usage = await new AssetUsageLedger(this.root).usage(x402SolanaUsageIdentity({ payer: account.address, mint: input.mint }), now);
          evaluateX402Solana(owner, offer.amountAtomic, usage.amountAtomic, now);
          const read = await readX402SolanaAccounts(rpc, { payer: account.address, payee: offer.payee, mint: input.mint,
            decimals: owner.row.decimals, amountAtomic: offer.amountAtomic });
          assertSolanaUnattendedBalance(policy, read.balanceAtomic);
          return await this.records.persistLocked(newX402SolanaRecord({ operationId, profile, profileHash, idempotencyHash, requestHash, terms: {
            url: challenge.url, origin: challenge.origin, urlHash: challenge.urlHash, challengeHash: challenge.challengeHash,
            resourceCanonicalJson: challenge.resourceCanonicalJson, offerIndex: offer.index, offerCanonicalJson: offer.declaredCanonicalJson,
            offerHash: offer.offerHash, network: X402_SOLANA_NETWORK, chain: X402_SOLANA_ALLOWLIST_CHAIN, payer: account.address, mint: input.mint,
            symbol: owner.row.symbol, decimals: owner.row.decimals, sourceTokenAccount: read.sourceTokenAccount, payee: offer.payee,
            destinationTokenAccount: read.destinationTokenAccount, feePayer: offer.feePayer, amountAtomic: offer.amountAtomic,
            maxAmountAtomic: input.maxAmountAtomic, computeUnitLimit: X402_SOLANA_COMPUTE_UNIT_LIMIT,
            computeUnitPriceMicroLamports: X402_SOLANA_COMPUTE_UNIT_PRICE_MICROLAMPORTS,
            // The spec's Memo: exactly the seller's declared memo, else a random nonce that keeps equal payments distinct.
            memo: offer.memo ?? randomBytes(X402_SOLANA_NONCE_BYTES).toString("hex"), memoSource: offer.memo === null ? "nonce" : "seller",
            admission: { policyDigest: owner.active.digest, policyRevision: owner.active.revision, registryVersion: owner.active.registry.registryVersion,
              activationDigest: owner.active.activationDigest, maximumPerTransferAtomic: owner.caps.maximumPerTransferAtomic, dailyLimitAtomic: owner.caps.dailyLimitAtomic },
            policy: { integrityHash: policy.integrityHash, maxBalanceAtomic: policy.maxBalanceUsdcAtomic, maxX402AmountAtomic: policy.maxX402AmountAtomic },
            preparedAt: now.toISOString(), expiresAt: new Date(now.getTime() + X402_SOLANA_APPROVAL_WINDOW_MS).toISOString(),
          } }));
        });
    });
  }

  /**
   * Continue the payment once: after the owner's decision on a `prepared` payment, bind a fresh lifetime (simulated),
   * take the usage hold, sign, mark the exposure and send the single paid request. A payment already exposed is never
   * sent again; one signed and not exposed is sent only while its lifetime is still open.
   */
  async pay(operationId: string): Promise<X402SolanaRecord> {
    let record = await this.records.required(operationId);
    if (record.terminal || record.state === "exposed") return record;
    if (record.state === "prepared") {
      if (this.now().getTime() >= Date.parse(record.terms.expiresAt)) return (await this.observe(operationId)).record;
      record = await this.locked(operationId, async (current) => {
        if (current.state !== "prepared" || this.now().getTime() >= Date.parse(current.terms.expiresAt)) blocked("The prepared Solana payment changed or expired.");
        await this.assertOwnerUnchanged(current);
        const policy = await this.currentPolicy(current);
        const bound = await bindX402SolanaLifetime(this.rpc(), { ...x402SolanaMessageTerms(current.terms), payee: current.terms.payee });
        // The overfunded-wallet guard of unattended x402 holds again on the fresh read, before anything is reserved or signed.
        assertSolanaUnattendedBalance(policy, bound.balanceAtomic);
        const { unsignedPayload: _unsigned, balanceAtomic: _balance, ...lifetime } = bound;
        return await this.write(current, { state: "reserving", at: this.now().toISOString(), reason: "lifetime_bound_and_simulated",
          lifetime: { ...lifetime, boundAt: this.now().toISOString() } });
      });
    }
    if (record.state === "reserving") {
      await this.assertOwnerUnchanged(record);
      await this.currentPolicy(record);
      const active = (await x402SolanaOwnerRow(this.root, record.profile, record.terms.payer, record.terms.mint, this.now())).active;
      const lease = await new AssetUsageLedger(this.root).reserve({ ...x402SolanaUsageIdentity(record.terms), registry: active.registry, rail: "x402",
        mechanism: X402_SOLANA_MECHANISM, amountAtomic: record.terms.amountAtomic, idempotencyKey: x402SolanaUsageKey(operationId), now: this.now() })
        .catch(async (error: unknown) => {
          // Nothing was signed under `reserving` (signed bytes are persisted only by the next transition): the payment ends here.
          await this.locked(operationId, async (current) => current.state !== "reserving" ? current :
            await this.write(current, { state: "failed_before_effect", at: this.now().toISOString(), reason: "usage_reservation_refused" }));
          throw error;
        });
      if (lease.state !== "reserved") blocked("The Solana x402 usage hold already crossed a durable transition.");
      const signed = await signX402Solana(this.ports.accounts, record);
      record = await this.locked(operationId, async (current) => {
        if (current.state !== "reserving") blocked("The Solana payment changed while it was being signed.");
        return await this.write(current, { state: "signed", at: this.now().toISOString(), reason: "payer_signed_locally", signed,
          lease: { reservationId: lease.reservationId, reservationDigest: lease.reservationDigest } });
      });
    }
    if (record.state !== "signed") return record;
    // The lifetime must still be open at the confirmed height before the single exposure; past it the bytes can never land.
    const height = await readSolanaBlockHeight(this.rpc(), "confirmed");
    if (height >= BigInt(record.lifetime!.lastValidBlockHeight)) {
      throw new ApnError("APN_REPREPARE_REQUIRED", "The signed Solana payment's blockhash expired before it was sent; observe releases it.",
        { reason: "x402_solana_lifetime_expired", nextActions: [`apn x402 solana observe --operation ${operationId}`] });
    }
    const header = solanaPaymentHeader(record.terms, record.signed!.rawPayload);
    record = await this.locked(operationId, async (current) => {
      if (current.state !== "signed") blocked("The Solana payment changed before it was sent.");
      return await this.write(current, { state: "exposed", at: this.now().toISOString(), reason: "paid_request_started",
        exposure: { at: this.now().toISOString(), paymentHeaderHash: domainHash("apn.x402.payment-header.v1", Buffer.from(header, "ascii")) } });
    });
    await followX402SolanaUsage(this.root, record, this.now());
    const response = await sendSolanaPayment(this.ports.http, record.terms, header, () => this.now());
    return await this.locked(operationId, async (current) => current.state !== "exposed" || current.response !== null ? current :
      await this.write(current, { state: "exposed", at: this.now().toISOString(), reason: "paid_request_answered", response }));
  }

  /**
   * One bounded observation. An exposed payment is settled, failed on chain or proven never to land (R4); an unexposed one
   * ends without effect once its approval window or bound lifetime has passed. Otherwise nothing changes.
   */
  async observe(operationId: string): Promise<{ readonly record: X402SolanaRecord; readonly pending: string | null }> {
    const record = await this.records.required(operationId);
    if (record.terminal) { await followX402SolanaUsage(this.root, record, this.now()); return { record, pending: null }; }
    const result = await this.observation(record);
    if (typeof result === "string") { await followX402SolanaUsage(this.root, record, this.now()); return { record, pending: result }; }
    const next = await this.locked(operationId, async (current) =>
      current.integrityHash !== record.integrityHash ? current : await this.write(current, result));
    await followX402SolanaUsage(this.root, next, this.now());
    return { record: next, pending: null };
  }

  /** The transition one observation proves, or why nothing is proven yet. */
  private async observation(record: X402SolanaRecord): Promise<Parameters<typeof transitionX402Solana>[1] | string> {
    const at = this.now().toISOString();
    if (record.state === "prepared") {
      return this.now().getTime() >= Date.parse(record.terms.expiresAt) ? { state: "failed_before_effect", at, reason: "approval_window_expired" }
        : "awaiting_owner_approval";
    }
    const lifetime = record.lifetime!;
    if (record.state === "reserving" || record.state === "signed") {
      const height = await readSolanaBlockHeight(this.rpc(), "finalized");
      return height > BigInt(lifetime.lastValidBlockHeight) ? { state: "failed_before_effect", at, reason: "lifetime_expired_unexposed" }
        : "signed_not_sent_lifetime_open";
    }
    const observed = await observeX402SolanaPayment(this.rpc(), { ...x402SolanaMessageTerms(record.terms), payee: record.terms.payee,
      messageBase64: lifetime.messageBase64, payerSignature: record.signed!.payerSignature, lastValidBlockHeight: lifetime.lastValidBlockHeight,
      floorSlot: lifetime.floorSlot, ...(record.response?.settlementHint === undefined ? {} : { hint: record.response.settlementHint }), now: this.now() });
    if (observed.outcome === "pending") return observed.reason;
    if (observed.outcome === "expired_unlanded") return { state: "expired_unlanded", at, reason: "finalized_lifetime_passed_unlanded", unlanded: observed.unlanded };
    return observed.settlement.success ? { state: "settled", at, reason: "finalized_exact_transfer", settlement: observed.settlement }
      : { state: "failed_onchain", at, reason: "finalized_transaction_failed", settlement: observed.settlement };
  }

  private async assertOwnerUnchanged(record: X402SolanaRecord): Promise<void> {
    const owner = await x402SolanaOwnerRow(this.root, record.profile, record.terms.payer, record.terms.mint, this.now());
    const frozen = record.terms.admission;
    if (owner.active.digest !== frozen.policyDigest || owner.active.revision !== frozen.policyRevision || owner.active.activationDigest !== frozen.activationDigest) {
      throw new ApnError("APN_ALLOWLIST_REFUSED", "The active owner allowlist policy changed after preparation; this payment cannot continue. " +
        "Observe it once it expires (that releases the account), then prepare a new payment.",
        { reason: "allowlist_policy_changed", rail: "x402", nextActions: [`apn x402 solana observe --operation ${record.operationId}`] });
    }
  }
}

function replay(saved: X402SolanaRecord, requestHash: string): X402SolanaRecord {
  if (saved.requestHash !== requestHash) throw new ApnError("APN_IDEMPOTENCY_CONFLICT", "The idempotency key names a different Solana x402 payment.");
  return saved;
}
function blocked(message: string): never { throw new ApnError("APN_OPERATION_BLOCKED", message); }
