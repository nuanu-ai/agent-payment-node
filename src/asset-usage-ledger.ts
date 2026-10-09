import { JupiterHistoricalRetirementReader } from "./swap/jupiter-solana/historical-retirement-reader.js";
import { historicalRetirementUsage } from "./swap/jupiter-solana/historical-retirement-record.js";
import { cleanup85OperationEnvelope } from "./circle-cleanup85-native-binding.js";
import { assertCleanup85GenericCapacityRelease, cleanup85NativeReservationMarker, sameCleanup85NativeMarker, type Cleanup85NativeReservationMarker } from "./asset-usage-ledger-cleanup85-native.js";
import { AllowlistPolicyStore } from "./allowlist-policy-store.js";
import { activeAssetPolicyFromState } from "./allowlist-active-policy.js";
import { StateStore } from "./state.js";
import { verifiedCleanup85NativeReservation, verifiedCleanup85NativeSettlement, sameCleanup85LedgerOperation, type VerifiedCleanup85NativeReservation, type VerifiedCleanup85NativeSettlement, type Cleanup85NativeActualSettlement } from "./circle-cleanup85-native-ledger-authority.js";
import { MerchantRepository } from "./x402-merchant/repository.js";
import { hashObject } from "./canonical.js";
import { merchantNativeActualFee, type MerchantNativeActualFee } from "./x402-merchant/fee-settlement.js";
import type { MerchantOperation, MerchantReceipt } from "./x402-merchant/model.js";
import { getAddress } from "viem";
import { canonicalJson, domainHash } from "./canonical.js";
import {
  evaluateAssetPolicy,
  validateAssetPolicyRegistry,
  type AssetPolicyRail,
} from "./asset-policy-registry.js";
import { SecureStateStore } from "./secure-state-store.js";

import { ASSET_USAGE_RESERVATION_SCHEMA, ASSET_USAGE_WINDOW, validateAssetUsageReservation,
  expectedStates, assetUsageReservationId, reservationIdFor, seal, assertReplay, assertBucketWindow, assertTransition,
  validateIdentity, exactIdentity, exactAsset, withoutDigest, canonicalAccount, idempotency, atomic, instant, digest, invalid, blocked, corrupt,
} from "./asset-usage-ledger-record.js";
import { Cleanup85NativePublicRecords } from "./circle-cleanup85-native-records.js";
import { DirectPublicEffectJournal } from "./direct-public-effect.js";
import { EvmDirectSubmissionJournal } from "./evm-direct-submission.js";
export { ASSET_USAGE_RESERVATION_SCHEMA, ASSET_USAGE_WINDOW, assetUsageReservationId, validateAssetUsageReservation } from "./asset-usage-ledger-record.js";

export type AssetUsageState =
  | "reserved"
  | "submitted"
  | "unknown_finality"
  | "finalized"
  | "failed_before_effect"
  /** Payment was never submitted and a terminal proof closes any earlier authorization exposure. */
  | "released_unsubmitted"
  /** A sent effect that is proven reverted at a finalized block releases its principal. */
  | "failed_confirmed_revert";

export interface AssetUsageIdentity {
  /** Stable canonical identity for the paying account; aliases must be resolved by the caller. */
  readonly account: string;
  readonly chain: string;
  readonly asset: Readonly<{ kind: "native"; identifier: null } | { kind: "token"; identifier: string }>;
}

export interface AssetUsageReservation extends AssetUsageIdentity {
  readonly schemaVersion: typeof ASSET_USAGE_RESERVATION_SCHEMA;
  readonly reservationId: string;
  readonly idempotencyHash: string;
  readonly policyDigest: string;
  readonly registryVersion: string;
  readonly rail: AssetPolicyRail;
  readonly amountAtomic: string;
  /** Proven asset consumption on a confirmed revert; absent on historical zero-consumption records. */
  readonly consumedAtomic?: string;
  readonly merchantNativeActualFee?: MerchantNativeActualFee;
  readonly cleanup85NativeReservation?: Cleanup85NativeReservationMarker;
  readonly cleanup85NativeActual?: Cleanup85NativeActualSettlement;
  readonly state: AssetUsageState;
  readonly reservedAt: string;
  readonly updatedAt: string;
  /** Set when a finalized effect or proven reverted consumption is charged to a UTC day. */
  readonly effectAt: string | null;
  /** Required terminal proof binding; the proof itself remains in the owning rail. */
  readonly outcomeDigest: string | null;
  readonly reservationDigest: string;
}

export interface AssetUsageReserveInput extends AssetUsageIdentity {
  readonly registry: unknown;
  readonly rail: AssetPolicyRail;
  readonly mechanism?: Readonly<{ provider: string; reference: string }>;
  readonly amountAtomic: string;
  readonly idempotencyKey: string;
  readonly now: Date;
  /** Relay-only recovery: caller has proved no journal, signing marker, custody bytes, or send risk. */
  readonly retryFailedBeforeEffect?: boolean;
}

export interface AssetUsageTransitionInput extends AssetUsageIdentity {
  readonly reservationId: string;
  readonly policyDigest: string;
  readonly state: Exclude<AssetUsageState, "reserved">;
  readonly now: Date;
  readonly outcomeDigest?: string;
  /** Exact asset consumed on a confirmed revert, such as a gasless USDC fee. */
  readonly consumedAtomic?: string;
  /** Optional compare-and-transition guard, checked atomically while the bucket lock is held. */
  readonly expectedCurrentStates?: readonly AssetUsageState[];
}

/** Permit2 production only: caller durably proved no authorization exposure before cancellation. */
export interface CancelUnsubmittedReservationInput extends AssetUsageIdentity {
  readonly chain: "eip155:43114";
  readonly asset: { readonly kind: "token"; readonly identifier: string };
  readonly idempotencyKey: `x402-permit2-production.v2:${string}`;
  readonly policyDigest: string;
  readonly registryVersion: string;
  readonly rail: "x402";
  readonly amountAtomic: string;
  readonly outcomeDigest: string;
  readonly now: Date;
}

export interface AssetUsageSnapshot {
  readonly windowPolicy: typeof ASSET_USAGE_WINDOW;
  readonly windowStart: string;
  readonly windowEnd: string;
  readonly amountAtomic: string;
}

type ReservationBody = Omit<AssetUsageReservation, "reservationDigest">;

/**
 * Durable common usage ledger for all admitted rails. Money-rail owners reserve here while holding
 * no other state lock, then persist their own operation under their existing lock discipline.
 */
export class AssetUsageLedger extends SecureStateStore {
  private initialized: Promise<void> | undefined;

  /** Relay and this ledger hash idempotency keys in separate domains. Hold the
   * exact source asset bucket lock through the caller's retirement write. */
  async withNoMatchingRelayReservation<T>(account: string, policyDigest: string | undefined,
    amountAtomic: string, action: () => Promise<T>, sourceChainId: 1 | 56 | 8453 = 1,
    allowFailedBeforeEffectReservationId?: string): Promise<T> {
    if (policyDigest !== undefined) digest(policyDigest, "Policy digest");
    const identity = validateIdentity(sourceChainId !== 1
      ? { account: getAddress(account), chain: `eip155:${sourceChainId}`, asset: { kind: "native", identifier: null } }
      : { account: getAddress(account), chain: "eip155:1",
        asset: { kind: "token", identifier: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48" } });
    await this.ready();
    return this.withLocks([this.bucketLock(identity)], async () => {
      const records = await this.loadBucket(identity);
      if (records.some(record => record.rail === "bridge" &&
        (policyDigest === undefined || record.policyDigest === policyDigest) && record.amountAtomic === amountAtomic &&
        !(record.reservationId === allowFailedBeforeEffectReservationId && record.state === "failed_before_effect"))) {
        throw blocked("Relay retirement is refused because a matching usage reservation exists.");
      }
      return action();
    });
  }

  async reserve(input: AssetUsageReserveInput): Promise<AssetUsageReservation> { return this.reserveBound(input); }

  async reserveCleanup85Native(authority: VerifiedCleanup85NativeReservation, now: Date): Promise<AssetUsageReservation> {
    const b = verifiedCleanup85NativeReservation(authority, this.root), o = b.operation;
    if (b.reservedAtomic !== "2000000000000" || BigInt(b.signedMaximumDebitAtomic) > BigInt(b.reservedAtomic) ||
      b.idempotencyKey !== `apn.cleanup85-native:${o.operationId}` || b.reservationId !== assetUsageReservationId({account:o.walletAddress,chain:"eip155:42161",asset:{kind:"native",identifier:null}},b.idempotencyKey)) throw blocked("Cleanup85 native reservation binding mismatch.");
    return this.reserveBound({account:o.walletAddress,chain:"eip155:42161",asset:{kind:"native",identifier:null},registry:b.policy.registry,rail:"direct",amountAtomic:b.reservedAtomic,idempotencyKey:b.idempotencyKey,now},authority);
  }

  private async reserveBound(input: AssetUsageReserveInput, authority?: VerifiedCleanup85NativeReservation): Promise<AssetUsageReservation> {
    const cleanup=authority===undefined?undefined:verifiedCleanup85NativeReservation(authority,this.root);
    if(typeof input.idempotencyKey==="string"&&input.idempotencyKey.startsWith("apn.cleanup85-native:")&&cleanup===undefined)throw blocked("Cleanup85 namespace requires root-owned reservation authority.");
    const registry = validateAssetPolicyRegistry(input.registry);
    const at = instant(input.now);
    const initial = evaluateAssetPolicy(registry, {
      chain: input.chain, asset: input.asset, rail: input.rail, ...(input.mechanism === undefined ? {} : { mechanism: input.mechanism }),
      amountAtomic: input.amountAtomic, dailyUsageAtomic: "0", asOfDate: at.slice(0, 10), asOf: at,
    });
    const account = canonicalAccount(initial.chain, input.account, false);
    const idempotencyHash = idempotency(input.idempotencyKey);
    const identity: AssetUsageIdentity = { account, chain: initial.chain, asset: exactAsset(initial.asset) };
    const reservationId = reservationIdFor(identity, idempotencyHash);
    await this.ready();
    return await this.withLocks([this.bucketLock(identity)], async () => {
      const reservations = await this.loadBucket(identity);
      if (cleanup !== undefined) {
        const active=activeAssetPolicyFromState(await new AllowlistPolicyStore(this.root).readUnderProfileLock(cleanup.operation.profile),input.now);
        if(at>=cleanup.authorizationExpiresAt||active===null||active.digest!==cleanup.policy.digest||active.activationDigest!==cleanup.policy.activationDigest||active.revision!==cleanup.policy.revision||!sameCleanup85LedgerOperation(cleanup.operation,await new StateStore(this.root).findOperation(cleanup.operation.operationId)))throw blocked("Cleanup85 durable reservation operation or policy changed.");
      }
      if(cleanup?.unsignedContinuation){
        await new DirectPublicEffectJournal(new StateStore(this.root)).assertUnstarted(cleanup.operation);
        if(await new EvmDirectSubmissionJournal(this.root).exists(cleanup.operation)||await new Cleanup85NativePublicRecords(this.root).load(cleanup.operation.operationId,"material")!==null||reservations.some(entry=>entry.reservationId===reservationId))throw blocked("Cleanup85 unsigned continuation has an existing effect or reservation.");
        verifiedCleanup85NativeReservation(authority!,this.root);
      }
      const existing = reservations.find((entry) => entry.reservationId === reservationId);
      if (existing !== undefined) {
        assertReplay(existing, initial.policyDigest, initial.registryVersion, input.rail, initial.amountAtomic, idempotencyHash);
        if((cleanup===undefined&&existing.cleanup85NativeReservation!==undefined)||(cleanup!==undefined&&!sameCleanup85NativeMarker(existing.cleanup85NativeReservation,cleanup)))throw blocked("Cleanup85 reservation marker replay mismatch.");
        if (input.retryFailedBeforeEffect === true && existing.state === "failed_before_effect") {
          assertBucketWindow(reservations, at);
          const usage = await this.sumBucketUsage(identity, reservations, input.now);
          evaluateAssetPolicy(registry, {
            chain: identity.chain, asset: identity.asset, rail: input.rail, ...(input.mechanism === undefined ? {} : { mechanism: input.mechanism }),
            amountAtomic: initial.amountAtomic, dailyUsageAtomic: usage, asOfDate: at.slice(0, 10), asOf: at,
          });
          const reopened = seal({ ...withoutDigest(existing), state: "reserved", reservedAt: at, updatedAt: at,
            effectAt: null, outcomeDigest: null });
          await this.writeJson(this.recordPath(identity, reservationId), reopened);
          return reopened;
        }
        return existing;
      }
      assertBucketWindow(reservations, at);
      const usage = await this.sumBucketUsage(identity, reservations, input.now);
      evaluateAssetPolicy(registry, {
        chain: identity.chain, asset: identity.asset, rail: input.rail, ...(input.mechanism === undefined ? {} : { mechanism: input.mechanism }),
        amountAtomic: initial.amountAtomic, dailyUsageAtomic: usage, asOfDate: at.slice(0, 10), asOf: at,
      });
      const body: ReservationBody = {
        ...(cleanup===undefined?{}:{cleanup85NativeReservation:cleanup85NativeReservationMarker(cleanup)}),
        schemaVersion: ASSET_USAGE_RESERVATION_SCHEMA,
        reservationId,
        idempotencyHash,
        policyDigest: initial.policyDigest,
        registryVersion: initial.registryVersion,
        ...identity,
        rail: input.rail,
        amountAtomic: initial.amountAtomic,
        state: "reserved",
        reservedAt: at,
        updatedAt: at,
        effectAt: null,
        outcomeDigest: null,
      };
      const record = seal(body);
      await this.writeJson(this.recordPath(identity, reservationId), record, true);
      return record;
    });
  }

  /** Direct pre-private recovery: hold the exact reservation through its durable outcome and release.
   * The callback must not acquire this bucket lock. Its owning profile/operation/custody locks remain held. */
  async releaseDirectReservedAfter<T>(expectedValue: AssetUsageReservation,
    persistOutcome: () => Promise<{ value: T; now: Date; outcomeDigest: string }>): Promise<T> {
    const expected = structuredClone(validateAssetUsageReservation(expectedValue));
    if (expected.cleanup85NativeReservation !== undefined) throw blocked("Cleanup85 native hold requires opaque canonical settlement.");
    if (expected.rail !== "direct" || expected.state !== "reserved") throw blocked("Only an unchanged direct reserve can close a pre-private attempt.");
    const identity = validateIdentity(expected);
    await this.ready();
    return this.withLocks([this.bucketLock(identity)], async () => {
      const value = await this.readJson(this.recordPath(identity, expected.reservationId));
      if (value === null || canonicalJson(validateAssetUsageReservation(value)) !== canonicalJson(expected)) {
        throw blocked("The exact no-private-entry reservation is no longer held unchanged.");
      }
      await assertCleanup85GenericCapacityRelease(this.root,expected);
      const outcome = await persistOutcome();
      const at = instant(outcome.now), outcomeDigest = digest(outcome.outcomeDigest, "Outcome digest");
      if (at < expected.updatedAt) throw blocked("The usage reservation transition cannot move backward in time.");
      const released = seal({ ...withoutDigest(expected), state: "failed_before_effect", updatedAt: at,
        effectAt: null, outcomeDigest });
      await this.writeJson(this.recordPath(identity, expected.reservationId), released);
      return outcome.value;
    });
  }

  async transition(input: AssetUsageTransitionInput): Promise<AssetUsageReservation> {
    const identity = validateIdentity(input);
    const reservationId = digest(input.reservationId, "Reservation id");
    const policyDigest = digest(input.policyDigest, "Policy digest");
    const at = instant(input.now);
    const expectedCurrentStates = input.expectedCurrentStates === undefined
      ? undefined
      : expectedStates(input.expectedCurrentStates);
    await this.ready();
    return await this.withLocks([this.bucketLock(identity)], async () => {
      const bucketRecords = await this.loadBucket(identity, false);
      const retirements = await new JupiterHistoricalRetirementReader(this.root).forBucket(identity, bucketRecords);
      if (retirements.some(record => record.originalOperation.usageLease?.reservationId === reservationId)) {
        throw blocked("A committed Jupiter historical retirement keeps its original reservation immutable.");
      }
      const value = await this.readJson(this.recordPath(identity, reservationId));
      if (value === null) throw blocked("The usage reservation does not exist.");
      const current = validateAssetUsageReservation(value);
      if (current.reservationId !== reservationId || current.policyDigest !== policyDigest ||
          canonicalJson(exactIdentity(current)) !== canonicalJson(identity)) {
        throw blocked("The usage reservation binding does not match the requested transition.");
      }
      if (expectedCurrentStates !== undefined && !expectedCurrentStates.includes(current.state)) {
        throw blocked("The usage reservation is no longer in an expected source state.");
      }
      if (at < current.updatedAt) throw blocked("The usage reservation transition cannot move backward in time.");
      const terminal = input.state === "finalized" || input.state === "failed_before_effect" ||
        input.state === "released_unsubmitted" || input.state === "failed_confirmed_revert";
      if(terminal)await assertCleanup85GenericCapacityRelease(this.root,current);
      const outcomeDigest = terminal ? digest(input.outcomeDigest, "Outcome digest") : null;
      const consumedAtomic = input.consumedAtomic === undefined ? undefined : atomic(input.consumedAtomic, false, true).toString();
      if (consumedAtomic !== undefined && (input.state !== "failed_confirmed_revert" ||
        BigInt(consumedAtomic) > BigInt(current.amountAtomic))) {
        throw blocked("Confirmed-revert consumption exceeds or conflicts with the reservation.");
      }
      if (current.state === input.state) {
        if (current.outcomeDigest !== outcomeDigest || current.consumedAtomic !== consumedAtomic) {
          throw blocked("The idempotent usage transition outcome does not match.");
        }
        return current;
      }
      assertTransition(current.state, input.state);
      const body: ReservationBody = {
        ...withoutDigest(current),
        state: input.state,
        updatedAt: at,
        effectAt: input.state === "finalized" || consumedAtomic !== undefined ? at : null,
        outcomeDigest,
        ...(consumedAtomic === undefined ? {} : { consumedAtomic }),
      };
      const next = seal(body);
      await this.writeJson(this.recordPath(identity, reservationId), next);
      return next;
    });
  }

  /** Exact root-owned cleanup85 cancellation only; public projections are never authority. */
  async settleCleanup85Native(authority: VerifiedCleanup85NativeSettlement, now: Date): Promise<AssetUsageReservation> {
    const {operation:o,settlement:p}=verifiedCleanup85NativeSettlement(authority,this.root);
    const identity:AssetUsageIdentity={account:o.walletAddress,chain:"eip155:42161",asset:{kind:"native",identifier:null}},key=`apn.cleanup85-native:${o.operationId}`;
    const reservationId=assetUsageReservationId(identity,key),at=instant(now);await this.ready();
    return this.withLocks([this.bucketLock(identity)],async()=>{
      if(!sameCleanup85LedgerOperation(o,await new StateStore(this.root).findOperation(o.operationId)))throw blocked("Cleanup85 durable settlement operation changed.");
      const value=await this.readJson(this.recordPath(identity,reservationId));if(value===null)throw blocked("Cleanup85 native hold missing.");
      const current=validateAssetUsageReservation(value);
      const policies=await new AllowlistPolicyStore(this.root).readUnderProfileLock(o.profile),frozen=policies.records.find(row=>row.revision===o.allowlist!.policyRevision);
      if(frozen?.registry.policyDigest!==p.policyDigest||frozen.registry.registryVersion!==current.registryVersion||!policies.entries.some(row=>row.status==="active"&&row.revision===o.allowlist!.policyRevision&&row.entryDigest===o.evm!.cleanup85Cancellation!.activationDigest))throw blocked("Cleanup85 historical reservation policy mismatch.");
      const marker=current.cleanup85NativeReservation;
      if(marker===undefined||marker.fingerprint!==p.fingerprint||marker.requestBinding!==p.requestBinding||marker.envelopeHash!==cleanup85OperationEnvelope(o).envelopeHash||marker.signedMaximumDebitAtomic!==(BigInt(o.economics!.gasLimitAtomic)*BigInt(o.economics!.maxFeePerGasAtomic)+1n).toString()||marker.activationDigest!==o.evm!.cleanup85Cancellation!.activationDigest)throw blocked("Cleanup85 settlement marker changed.");
      if(current.reservationId!==p.nativeReservationId||reservationId!==p.nativeReservationId||current.idempotencyHash!==idempotency(key)||current.rail!=="direct"||current.policyDigest!==p.policyDigest||current.amountAtomic!==p.reservedAtomic||o.allowlist?.policyDigest!==p.policyDigest||o.fingerprint!==p.fingerprint||o.transactionHash!==p.transactionHash||hashObject(o.evm!.cleanup85Cancellation!.request)!==p.requestBinding||at<current.updatedAt)throw blocked("Cleanup85 actual debit hold mismatch.");
      if(current.state==="finalized"){if(current.outcomeDigest!==p.outcomeDigest||canonicalJson(current.cleanup85NativeActual)!==canonicalJson(p))throw blocked("Cleanup85 settlement outcome changed.");return current;}
      if(!["submitted","unknown_finality"].includes(current.state))throw blocked("Cleanup85 native hold not exposed.");
      const next=seal({...withoutDigest(current),state:"finalized",updatedAt:at,effectAt:at,outcomeDigest:p.outcomeDigest,consumedAtomic:p.nativeConsumedAtomic,cleanup85NativeActual:p});await this.writeJson(this.recordPath(identity,reservationId),next);return next;
    });
  }

  /** Finite Mega merchant headroom only: metadata cannot mint this canonical receipt authority. */
  async settleMerchantNativeActualFee(o:MerchantOperation,receipt:MerchantReceipt,now:Date):Promise<AssetUsageReservation> {
    const proof=merchantNativeActualFee(o,receipt),durable=await new MerchantRepository(this.root).findOperation(o.operationId);
    if(durable===null||canonicalJson(durable)!==canonicalJson(o)||durable.submissionAttempts!==1||durable.signingAttempts!==1||durable.txHash!==receipt.transactionHash||durable.receipt===null||canonicalJson(durable.receipt)!==canonicalJson(o.receipt)||!["payment_finalized","delivery_unknown","delivered"].includes(durable.state))throw blocked("Merchant actual fee is not bound to this ledger root durable paid operation.");
    const identity:AssetUsageIdentity={account:o.custody.walletAddress,chain:"eip155:4326",asset:{kind:"native",identifier:null}},key=`apn.merchant-native:${o.operationId}`;
    if(identity.account!=="0x0B4Dd0C3dA001Fa146EEd3f80B01860BEF6B8a14"||o.profile!=="default")throw blocked("Finite merchant native owner mismatch.");
    const reservationId=assetUsageReservationId(identity,key),at=instant(now);await this.ready();
    return this.withLocks([this.bucketLock(identity)],async()=>{
      const value=await this.readJson(this.recordPath(identity,reservationId));if(value===null)throw blocked("Merchant native hold missing.");
      const current=validateAssetUsageReservation(value),outcomeDigest=hashObject(proof);
      if(current.reservationId!==reservationId||current.idempotencyHash!==idempotency(key)||current.rail!=="x402"||current.policyDigest!==o.policy.digest||current.amountAtomic!==proof.reservedFee||at<current.updatedAt||BigInt(proof.actualFee)>BigInt(current.amountAtomic))throw blocked("Merchant actual fee hold mismatch.");
      if(current.state==="finalized"){if(current.outcomeDigest!==outcomeDigest||canonicalJson(current.merchantNativeActualFee)!==canonicalJson(proof))throw blocked("Merchant fee outcome changed.");return current;}
      if(!["submitted","unknown_finality"].includes(current.state))throw blocked("Merchant fee hold not exposed.");
      const next=seal({...withoutDigest(current),state:"finalized",updatedAt:at,effectAt:at,outcomeDigest,consumedAtomic:proof.actualFee,merchantNativeActualFee:proof});await this.writeJson(this.recordPath(identity,reservationId),next);return next;
    });
  }

  /** Atomic cancellation in the existing schema; a delayed reserve can only replay the released row. */
  async cancelUnsubmittedReservation(input: CancelUnsubmittedReservationInput): Promise<AssetUsageReservation> {
    if (input.chain !== "eip155:43114" || input.asset.kind !== "token" ||
        input.asset.identifier !== "0x9702230A8Ea53601f5cD2dc00fDBc13d4dF4A8c7" ||
        input.rail !== "x402" || !/^x402-permit2-production\.v2:[a-f0-9]{64}$/u.test(input.idempotencyKey) ||
        typeof input.registryVersion !== "string" || !/^[a-z0-9][a-z0-9._-]{0,63}$/u.test(input.registryVersion)) {
      throw invalid("Unsigned cancellation is restricted to a frozen Permit2 production lease.");
    }
    const identity = validateIdentity(input), at = instant(input.now), idempotencyHash = idempotency(input.idempotencyKey);
    const reservationId = reservationIdFor(identity, idempotencyHash);
    const policyDigest = digest(input.policyDigest, "Policy digest"), outcomeDigest = digest(input.outcomeDigest, "Outcome digest");
    const amountAtomic = atomic(input.amountAtomic, true, false).toString();
    await this.ready();
    return this.withLocks([this.bucketLock(identity)], async () => {
      const records = await this.loadBucket(identity); assertBucketWindow(records, at);
      const current = records.find(record => record.reservationId === reservationId);
      if (current !== undefined) {
        assertReplay(current, policyDigest, input.registryVersion, input.rail, amountAtomic, idempotencyHash);
        if (at < current.updatedAt) throw blocked("Unsigned cancellation cannot move backward in time.");
        if (current.state === "released_unsubmitted") {
          if (current.outcomeDigest !== outcomeDigest) throw blocked("Unsigned cancellation outcome changed.");
          return current;
        }
        if (current.state !== "reserved" || at < current.updatedAt) throw blocked("An exposed or terminal reservation cannot be cancelled.");
      }
      const body: ReservationBody = current === undefined
        ? { schemaVersion: ASSET_USAGE_RESERVATION_SCHEMA, ...identity, reservationId, idempotencyHash, policyDigest,
          registryVersion: input.registryVersion, rail: "x402", amountAtomic, reservedAt: at, updatedAt: at,
          state: "released_unsubmitted", effectAt: null, outcomeDigest }
        : { ...withoutDigest(current), state: "released_unsubmitted", updatedAt: at, effectAt: null, outcomeDigest };
      const released = seal(body);
      await this.writeJson(this.recordPath(identity, reservationId), released, current === undefined);
      return released;
    });
  }

  async usage(identityValue: AssetUsageIdentity, now: Date): Promise<AssetUsageSnapshot> {
    const identity = validateIdentity(identityValue);
    const at = instant(now);
    await this.ready();
    return await this.withLocks([this.bucketLock(identity)], async () => ({
      windowPolicy: ASSET_USAGE_WINDOW,
      windowStart: `${at.slice(0, 10)}T00:00:00.000Z`,
      windowEnd: new Date(Date.parse(`${at.slice(0, 10)}T00:00:00.000Z`) + 86_400_000).toISOString(),
      amountAtomic: await this.sumBucketUsage(identity, await this.loadBucket(identity), now),
    }));
  }

  /** Existing-ledger snapshot for nonpersistent preflight; never initializes, locks, or creates a bucket. */
  async usageReadOnly(identityValue: AssetUsageIdentity, now: Date): Promise<AssetUsageSnapshot> {
    const identity = validateIdentity(identityValue);
    const at = instant(now);
    return {
      windowPolicy: ASSET_USAGE_WINDOW,
      windowStart: `${at.slice(0, 10)}T00:00:00.000Z`,
      windowEnd: new Date(Date.parse(`${at.slice(0, 10)}T00:00:00.000Z`) + 86_400_000).toISOString(),
      amountAtomic: await this.sumBucketUsage(identity, await this.loadBucket(identity, false), now),
    };
  }

  /** Read the daily total and one reservation from the same locked bucket snapshot. */
  async usageWithReservation(identityValue: AssetUsageIdentity, reservationIdValue: string, now: Date): Promise<{
    snapshot: AssetUsageSnapshot; reservation: AssetUsageReservation | null;
  }> {
    const identity = validateIdentity(identityValue);
    const reservationId = digest(reservationIdValue, "Reservation id");
    const at = instant(now);
    await this.ready();
    return await this.withLocks([this.bucketLock(identity)], async () => {
      const records = await this.loadBucket(identity);
      return {
        snapshot: {
          windowPolicy: ASSET_USAGE_WINDOW,
          windowStart: `${at.slice(0, 10)}T00:00:00.000Z`,
          windowEnd: new Date(Date.parse(`${at.slice(0, 10)}T00:00:00.000Z`) + 86_400_000).toISOString(),
          amountAtomic: await this.sumBucketUsage(identity, records, now),
        },
        reservation: records.find(record => record.reservationId === reservationId) ?? null,
      };
    });
  }

  async load(identityValue: AssetUsageIdentity, reservationIdValue: string): Promise<AssetUsageReservation | null> {
    const identity = validateIdentity(identityValue);
    const reservationId = digest(reservationIdValue, "Reservation id");
    await this.ready();
    return await this.withLocks([this.bucketLock(identity)], async () => {
      const value = await this.readJson(this.recordPath(identity, reservationId));
      if (value === null) return null;
      const record = validateAssetUsageReservation(value);
      if (record.reservationId !== reservationId || canonicalJson(exactIdentity(record)) !== canonicalJson(identity)) {
        corrupt("A usage reservation path binding is invalid.");
      }
      return record;
    });
  }

  private async ready(): Promise<void> {
    this.initialized ??= (async () => { await super.initialize(); await this.ensureDirectory("asset-usage"); })();
    await this.initialized;
  }

  private async loadBucket(identity: AssetUsageIdentity, create = true): Promise<readonly AssetUsageReservation[]> {
    const directory = this.bucketDirectory(identity);
    if (create) await this.ensureDirectory(directory);
    const entries = await this.readDirectory(directory);
    const records: AssetUsageReservation[] = [];
    for (const entry of entries) {
      if (!entry.isFile() || !/^[a-f0-9]{64}\.json$/u.test(entry.name)) corrupt("The usage ledger directory contains an invalid entry.");
      const value = await this.readJson(`${directory}/${entry.name}`);
      if (value === null) corrupt("A usage reservation disappeared during a protected read.");
      const record = validateAssetUsageReservation(value);
      if (canonicalJson(exactIdentity(record)) !== canonicalJson(identity) || `${record.reservationId}.json` !== entry.name) {
        corrupt("A usage reservation path binding is invalid.");
      }
      records.push(record);
    }
    return records;
  }

  /** Central existing-record projection shared by reserve admission and every usage reader. */
  private async sumBucketUsage(identity: AssetUsageIdentity, records: readonly AssetUsageReservation[], now: Date): Promise<string> {
    const retired = await new JupiterHistoricalRetirementReader(this.root).forBucket(identity, records);
    return historicalRetirementUsage(records, retired, now);
  }

  private bucketDirectory(identity: AssetUsageIdentity): string {
    return `asset-usage/${domainHash("apn.asset-usage-bucket.v1", canonicalJson(identity))}`;
  }

  private recordPath(identity: AssetUsageIdentity, reservationId: string): string {
    return `${this.bucketDirectory(identity)}/${reservationId}.json`;
  }

  private bucketLock(identity: AssetUsageIdentity): string {
    return `asset-usage:${domainHash("apn.asset-usage-lock.v1", canonicalJson(identity))}`;
  }
}
