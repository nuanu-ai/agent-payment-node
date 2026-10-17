import type { CircleKnownOperation } from "./circle-v2-evm/funding-operation.js";
import { assertCircleAttestation } from "./circle-v2-evm/protocol.js";
import type { GaszipFundingRecord } from "./lifi/gaszip-direct-journal.js";
import { CircleRepository } from "./circle-v2-evm/repository.js";
import type { CircleRole } from "./circle-v2-evm/operation-model.js";
import { MerchantRepository } from "./x402-merchant/repository.js";
import { validateMerchant, type MerchantOperation } from "./x402-merchant/model.js";
import { Permit2ProductionRepository, validatePermit2ProductionRecord, type Permit2ProductionRecord } from "./x402-permit2/production-repository.js";
import { ApnError } from "./errors.js";
import type { CommandOutcome } from "./commands.js";
import type { OperationRecord } from "./model.js";
import type { StateStore } from "./state.js";
import { conflictDomainKeys, evmConflictDomain, railConflictDomain, sharedConflictDomainKeys,
  sharedEvmConflictDomain, type MoneyConflictDomain } from "./operation-conflict-domain.js";
import { canonicalOperationId } from "./transfer-policy.js";
import type { X402SettlementWaitProjection, X402OperationRecord } from "./x402-state-integrity.js";
import type { ProviderX402OperationRecord } from "./provider-x402-model.js";
import { ProviderX402Repository } from "./provider-x402-repository.js";
import type { RailOperationRecord } from "./rail-operation-model.js";
import type { StoredBridgeOperationRecord } from "./lifi/legacy-operation.js";
import type { GaslessOperationRecord } from "./gasless/operation-model.js";
import type { MetaMaskGaslessOperationRecord } from "./metamask-gasless/operation-model.js";
import type { SmartAccountGaslessOperationRecord } from "./smart-account-gasless/operation-model.js";
import type { FacilitatorOperationRecord } from "./facilitator-gasless/operation-model.js";
import { RelayUnsignedOperationRepository, validateRelayUnsignedOperation, type RelayUnsignedOperation } from "./relay-unsigned-operation.js";
import { assertExclusiveEvmOwner, evmAddressLock } from "./evm-address-ownership.js";
import { OperationIndex } from "./operation-index/index.js";
import { relayStatus } from "./operation-index/adapters/relay.js";
import { x402StoredOutcome, x402StoredReceiptOutcome, type X402StoredOperation } from "./operation-index/adapters/x402.js";
import { profileClaim, providerClaims, UNREADABLE_PROVIDER_CLAIM, unreadableProfileClaim, type OperationClaim, type OperationIndexEntry,
  type WantedTag } from "./operation-index/types.js";
export type StoredMoneyOperation =
  | { readonly kind: "sei_gaszip"; readonly record: GaszipFundingRecord }
  | { readonly kind: "circle_route"; readonly record: CircleKnownOperation }
  | { readonly kind: "mega_gaszip"; readonly record: GaszipFundingRecord }
  | { readonly kind: "merchant_x402"; readonly record: MerchantOperation }
  | { readonly kind: "permit2_production"; readonly record: Permit2ProductionRecord }
  | { readonly kind: "relay_unsigned"; readonly record: RelayUnsignedOperation }
  | { readonly kind: "facilitator_gasless_transfer"; readonly record: FacilitatorOperationRecord }
  | { readonly kind: "smart_account_gasless_transfer"; readonly record: SmartAccountGaslessOperationRecord }
  | { readonly kind: "metamask_gasless_transfer"; readonly record: MetaMaskGaslessOperationRecord }
  | { readonly kind: "gasless_transfer"; readonly record: GaslessOperationRecord }
  | { readonly kind: "bridge_route"; readonly record: StoredBridgeOperationRecord }
  | { readonly kind: "rail_transfer"; readonly record: RailOperationRecord }
  | { readonly kind: "direct_transfer"; readonly record: OperationRecord }
  | { readonly kind: "x402_fetch"; readonly strategy: "local"; readonly record: X402OperationRecord }
  | { readonly kind: "x402_fetch"; readonly strategy: "provider_atomic"; readonly record: ProviderX402OperationRecord };
/** What a new operation of a facade family is admitted with: the identity its record will carry. */
export interface FacadePrepareIdentity {
  readonly kind: StoredMoneyOperation["kind"];
  readonly profileHash: string;
  readonly operationId: string;
  readonly idempotencyHash: string;
  readonly requestHash: string;
}
/** The accounts a new operation signs with, and what else it holds or waits for. */
export interface FacadeAdmission {
  /** The networks and accounts it signs on; an unreadable list makes the admission profile-wide. */
  readonly domains: () => readonly MoneyConflictDomain[];
  /** A provider operation also holds its provider account and payer across profiles. */
  readonly provider?: { readonly providerId: string; readonly accountBindingHash: string; readonly payer: string };
  /** A profile-wide admission (Relay) also waits for every unresolved operation of the profile. */
  readonly profileWide?: true;
  /** Another profile the operation signs for (a Circle route's destination): held, and its quarantine waited for. */
  readonly otherProfiles?: readonly string[];
  readonly tag?: WantedTag;
}
const FACADE_KINDS: ReadonlySet<string> = new Set<StoredMoneyOperation["kind"]>(["sei_gaszip", "circle_route", "mega_gaszip", "merchant_x402",
  "permit2_production", "relay_unsigned", "facilitator_gasless_transfer", "smart_account_gasless_transfer", "metamask_gasless_transfer",
  "gasless_transfer", "bridge_route", "rail_transfer", "direct_transfer", "x402_fetch"]);

/**
 * The money-operation facade over the operation index (src/operation-index): idempotency, lookup and the
 * one-operation-per-account guard read one index entry and at most the blocking records, never every store.
 * Repository ports that older call sites still pass are not read: each family is read through its index adapter.
 */
export class OperationService {
  private readonly index: OperationIndex;
  constructor(
    private readonly state: StateStore,
    private readonly providerX402: Pick<ProviderX402Repository, "loadReceipt"> = new ProviderX402Repository(state.root),
    ..._unreadPorts: readonly unknown[]
  ) {
    this.index = new OperationIndex(state);
  }
  /** Create-only Relay insertion. Profile, operation, idempotency, then owner-address
   * locks are acquired together so owner validation and durable write are atomic. */
  async persistRelayUnsigned(operation: RelayUnsignedOperation): Promise<RelayUnsignedOperation> {
    validateRelayUnsignedOperation(operation);
    await this.state.initialize();
    return await this.state.withLocks([
      `profile:${operation.profileHash}`, `operation:${operation.operationId}`,
      `operation:idempotency:${operation.idempotencyHash}`, evmAddressLock(operation.sourceAccount),
    ], async () => {
      const existing = await this.resolvePrepare({ kind: "relay_unsigned", profileHash: operation.profileHash,
        operationId: operation.operationId, idempotencyHash: operation.idempotencyHash, requestHash: operation.requestHash });
      if (existing !== null) {
        if (existing.kind !== "relay_unsigned" || existing.record.integrityHash !== operation.integrityHash) {
          throw new ApnError("APN_IDEMPOTENCY_CONFLICT", "Relay unsigned operation cannot be changed or replayed with different inputs.");
        }
        return existing.record;
      }
      try {
        await this.required(operation.operationId);
        throw new ApnError("APN_IDEMPOTENCY_CONFLICT", "Operation ID is already bound to another money operation.");
      } catch (error) {
        if (!(error instanceof ApnError) || error.code !== "APN_OPERATION_NOT_FOUND") throw error;
      }
      // Its prepare admitted this operation's own claims; every other unresolved operation of the profile still blocks it.
      await this.index.assertAvailable({ family: null, profileHash: operation.profileHash, claims: [profileClaim(operation.profileHash)],
        except: operation.operationId });
      await assertExclusiveEvmOwner(this.state, operation.sourceAccount, operation.profileHash);
      await new RelayUnsignedOperationRepository(this.state.root).persistLocked(operation);
      return operation;
    });
  }
  async resolvePrepare(input: {
    readonly kind: StoredMoneyOperation["kind"];
    readonly profileHash: string;
    readonly operationId: string;
    readonly idempotencyHash: string;
    readonly requestHash: string;
  }): Promise<StoredMoneyOperation | null> {
    const existing = await this.findIdempotency(input.idempotencyHash);
    if (existing === null) return null;
    if (
      existing.kind !== input.kind || existing.record.profileHash !== input.profileHash ||
      existing.record.operationId !== input.operationId || existing.record.requestHash !== input.requestHash
    ) throw new ApnError("APN_IDEMPOTENCY_CONFLICT", "Idempotency key is already bound to different operation inputs.");
    return existing;
  }
  /** Pure lookup lets callers defer to the full prepare resolver before any lifecycle upgrade. */
  async findIdempotency(idempotencyHash: string): Promise<StoredMoneyOperation | null> {
    const entry = await this.index.findByIdempotency(idempotencyHash);
    if (entry === null) return null;
    // An operation of a family this facade does not model still owns the key.
    if (!FACADE_KINDS.has(entry.family)) throw new ApnError("APN_IDEMPOTENCY_CONFLICT", "Idempotency key is already bound to another operation family.");
    return await this.stored(entry);
  }
  /**
   * Admits a new operation: its claims are checked and written to the operation index as one step under the index lock,
   * before `work` (the family's prepare body: RPC reads, signing material, the durable record) runs. When `work` fails
   * or writes no record, the claims are removed. Any other prepare on the same account, of any family, is refused from
   * that moment, and this one is refused while another holds the account. The caller holds its family locks and has
   * already answered a replay of the same identity.
   */
  async admit<T>(identity: FacadePrepareIdentity, admission: FacadeAdmission, work: () => Promise<T>): Promise<T> {
    const claims: OperationClaim[] = [...admission.profileWide === true ? [profileClaim(identity.profileHash)] : [],
      ...this.domainClaims(identity.profileHash, admission.domains)];
    if (admission.provider !== undefined) {
      claims.push(...providerClaims(admission.provider.providerId, admission.provider.accountBindingHash, admission.provider.payer));
    }
    const others = admission.otherProfiles ?? [];
    return await this.index.admit({ family: identity.kind, profileHash: identity.profileHash, operationId: identity.operationId,
      idempotencyHash: identity.idempotencyHash, requestHash: identity.requestHash },
    { family: null, profileHash: identity.profileHash, claims, holds: others.map(profileClaim), waits: others.map(unreadableProfileClaim),
      ...(admission.tag === undefined ? {} : { tag: admission.tag }) }, work);
  }
  async assertProfileAvailable(profileHash: string): Promise<void> {
    await this.index.assertAvailable({ family: null, profileHash, claims: [profileClaim(profileHash)] });
  }
  /** A new EVM money operation waits only for unresolved operations on the same chain and sending account. */
  async assertEvmAccountAvailable(profileHash: string, chainId: number | string, account: string): Promise<void> {
    await this.assertConflictDomainsAvailable(profileHash, () => [evmConflictDomain(chainId, account)]);
  }
  /** R8 (OWNR-16): a native Arbitrum move to a local custody wallet does not wait for this account's Circle routes whose source burn is final. */
  async assertEvmNativeAccountAvailableBesideSettledCircle(profileHash: string, account: string): Promise<void> {
    await this.assertConflictDomainsAvailable(profileHash, () => [evmConflictDomain(42161, account)], undefined,
      { kind: "native_beside_settled_circle", account });
  }
  /** A local EIP-3009 x402 purchase waits only for exclusive claims on its chain and account, never for another purchase. */
  async assertEvmAccountSharedAvailable(profileHash: string, chainId: number | string, account: string): Promise<void> {
    await this.assertConflictDomainsAvailable(profileHash, () => [sharedEvmConflictDomain(chainId, account)]);
  }
  /** The account check of one saved operation, excluding only that operation's own claim; its owner holds the account locks. */
  async assertEvmAccountAvailableExcept(profileHash: string, chainId: number | string, account: string, exceptOperationId: string): Promise<void> {
    await this.assertConflictDomainsAvailable(profileHash, () => [evmConflictDomain(chainId, account)], canonicalOperationId(exceptOperationId));
  }
  /** Only a checked saved Permit2 operation can exclude its own existing conflict claim. */
  async assertPermit2AccountAvailable(record: Permit2ProductionRecord): Promise<void> {
    validatePermit2ProductionRecord(record);
    const saved = await new Permit2ProductionRepository(this.state.root).findOperation(record.operationId);
    if (saved === null || saved.integrityHash !== record.integrityHash) throw new ApnError("APN_OPERATION_BLOCKED", "Permit2 conflict exclusion requires the exact saved operation.");
    await this.assertConflictDomainsAvailable(record.profileHash,
      () => [evmConflictDomain(43114, record.material.wallet.account)], record.operationId);
  }

  /** A new Solana or TRON money operation waits only for unresolved operations of the same rail account. */
  async assertRailAccountAvailable(profileHash: string, rail: "solana" | "tron", account: string): Promise<void> {
    await this.assertConflictDomainsAvailable(profileHash, () => [railConflictDomain(rail, account)]);
  }

  private async assertConflictDomainsAvailable(profileHash: string, domains: () => readonly MoneyConflictDomain[], exceptOperationId?: string,
    tag?: WantedTag): Promise<void> {
    await this.index.assertAvailable({ family: null, profileHash, claims: this.domainClaims(profileHash, domains),
      ...(exceptOperationId === undefined ? {} : { except: exceptOperationId }), ...(tag === undefined ? {} : { tag }) });
  }
  /** An unreadable network or account on the caller's side waits for every unresolved operation of the profile. */
  private domainClaims(profileHash: string, domains: () => readonly MoneyConflictDomain[]): readonly OperationClaim[] {
    const wanted = conflictDomainKeys(domains), coexisting = sharedConflictDomainKeys(domains);
    return wanted.size === 0 ? [profileClaim(profileHash)] : [...wanted].map(key => coexisting.has(key) ? { key, shared: true as const } : { key });
  }

  /** Both Circle signing accounts are held under their existing profile locks. */
  async assertCircleAccountsAvailable(record: CircleKnownOperation, exceptSaved = false, effectRole?: CircleRole): Promise<void> {
    if (exceptSaved) {
      const saved = await new CircleRepository(this.state.root).loadAny(record.operationId);
      if (saved === null || saved.integrityHash !== record.integrityHash) throw new ApnError("APN_OPERATION_BLOCKED", "Circle exclusion requires the exact durable journal.");
    }
    const except = exceptSaved ? record.operationId : undefined;
    const settledSourceMint = exceptSaved && effectRole === "mint" && record.source?.finalityTag === "finalized" &&
      record.attestation !== null && record.residualAllowanceAtomic === "0" && record.effects.find(e => e.role === "burn")?.phase === "confirmed" &&
      record.effects.filter(e => e.role !== "mint").every(e => e.phase === "confirmed");
    // Finalized source settlement is read-only during mint. Its signer remains occupied for all other financial roles.
    if (settledSourceMint) assertCircleAttestation(record.source!, record.attestation!, record.schemaVersion === "apn.circle-v2-evm-operation.v2" ? record.funding : undefined);
    else await this.assertConflictDomainsAvailable(record.profileHash,
      () => [evmConflictDomain(42161, record.sourceCustody.walletAddress)], except, { kind: "circle_source_after_burn" });
    await this.assertConflictDomainsAvailable(record.destinationProfileHash,
      () => [evmConflictDomain(record.destinationChain, record.destinationCustody.walletAddress)], except);
  }

  /** The provider account and payer are held across profiles by provider direct and provider x402 operations. */
  async assertProviderAccountAvailable(providerId: string, accountBindingHash: string, payer: string, exceptOperationId?: string): Promise<void> {
    await this.index.assertAvailable({ family: null, profileHash: null,
      claims: [...providerClaims(providerId, accountBindingHash, payer), UNREADABLE_PROVIDER_CLAIM],
      ...(exceptOperationId === undefined ? {} : { except: exceptOperationId }) });
  }

  async assertMerchantAccountAvailable(record: MerchantOperation): Promise<void> {
    validateMerchant(record);
    const saved = await new MerchantRepository(this.state.root).findOperation(record.operationId);
    if (saved === null || saved.integrityHash !== record.integrityHash) throw new ApnError("APN_OPERATION_BLOCKED", "Merchant conflict exclusion requires the exact saved operation.");
    await this.assertConflictDomainsAvailable(record.profileHash, () => [evmConflictDomain(4326, record.custody.walletAddress)], record.operationId);
  }

  async required(operationId: string): Promise<StoredMoneyOperation> {
    const entry = await this.index.find(canonicalOperationId(operationId));
    if (entry === null || !FACADE_KINDS.has(entry.family)) throw new ApnError("APN_OPERATION_NOT_FOUND", "Operation was not found.");
    const found = await this.stored(entry);
    if (found === null) throw new ApnError("APN_OPERATION_NOT_FOUND", "Operation was not found.");
    return found;
  }

  async status(operationId: string): Promise<unknown> {
    const found = await this.required(operationId);
    const adapter = this.index.adapter({ family: found.kind })!;
    return await adapter.view(found.kind === "x402_fetch" ? found : found.record, this.state.root);
  }

  async relayStatus(operation: RelayUnsignedOperation) {
    return await relayStatus(this.state.root, operation);
  }

  async x402Outcome(
    operationId: string,
    options: {
      readonly exposeSellerResult: boolean;
      readonly exposeTerminalReceipt: boolean;
      readonly settlementWait?: X402SettlementWaitProjection;
    },
  ): Promise<CommandOutcome> {
    return await x402StoredOutcome(this.state, this.providerX402, await this.requiredX402(operationId), options);
  }
  async x402ReceiptOutcome(operationId: string): Promise<CommandOutcome> {
    return await x402StoredReceiptOutcome(this.state, this.providerX402, await this.requiredX402(operationId));
  }

  private async requiredX402(operationId: string): Promise<X402StoredOperation> {
    const found = await this.required(operationId);
    if (found.kind !== "x402_fetch") throw new ApnError("APN_OPERATION_BLOCKED", "Operation is not an x402 fetch.");
    return found;
  }

  /** The record behind an entry through its family's own reader (its errors propagate); null when absent. */
  private async stored(entry: OperationIndexEntry): Promise<StoredMoneyOperation | null> {
    if (entry.unreadableReason === "duplicate_operation_id") throw new ApnError("APN_STATE_CORRUPT", "Operation ID is duplicated across operation stores.");
    const record = await this.index.loadRecord(entry);
    if (record === null) return null;
    return (entry.family === "x402_fetch" ? { kind: "x402_fetch", ...record as X402StoredOperation }
      : { kind: entry.family, record }) as StoredMoneyOperation;
  }
}
