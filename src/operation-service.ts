import { assertMetaMaskNativeConflictDomainAvailable, assertMetaMaskNativeOwnedConflictDomainAvailable, assertMetaMaskNativeOwnedScope,
  type MetaMaskNativeOwnedScope, type MetaMaskNativeOwnedContext } from "./metamask-native-transfer-owner.js";
import { listLocalWallets, listEncryptedWalletEnvelopes } from "./wallet-import-collision.js";
import { walletEnvelopeIdentity } from "./encrypted-wallet-store.js";
import { cleanup85UnsignedResumeExclusion } from "./circle-cleanup85-unsigned-resume.js";
import { cleanup85ConflictExclusion, type VerifiedCleanup85RecoveryAdmission, type Cleanup85CancellationRequest } from "./circle-cleanup85-native-conflict.js";
import { circleNativeSourceIdentity, verifiedCircleNativeSources, type VerifiedCircleNativeAdmission } from "./circle-native-admission.js";
import { assertCircleAttestation } from "./circle-v2-evm/protocol.js";
import { SeiFundingJournal, publicSeiFunding, type SeiFundingRecord } from "./lifi/sei-gaszip-journal.js";
import { CircleRepository } from "./circle-v2-evm/repository.js";
import { publicCircle, type CircleOperationV1, type CircleRole } from "./circle-v2-evm/operation-model.js";
import { MegaFundingJournal, publicMegaFunding, type MegaFundingRecord } from "./lifi/mega-gaszip-journal.js";
import { MerchantRepository } from "./x402-merchant/repository.js";
import { publicMerchant, validateMerchant, type MerchantOperation } from "./x402-merchant/model.js";
import { Permit2ProductionRepository, publicPermit2Production, validatePermit2ProductionRecord, type Permit2ProductionRecord } from "./x402-permit2/production-repository.js";
import { Permit2LegacyConflictRepository, type Permit2LegacyConflict } from "./x402-permit2/legacy-conflicts.js";
import { ApnError } from "./errors.js";
import type { CommandOutcome } from "./commands.js";
import type { OperationRecord } from "./model.js";
import type { StateStore } from "./state.js";
import { conflictDomainKey, evmConflictDomain, railConflictDomain, storedOperationDomains, type MoneyConflictDomain } from "./operation-conflict-domain.js";
import { canonicalOperationId, publicOperation } from "./transfer-policy.js";
import {
  publicX402Operation,
  type X402SettlementWaitProjection,
  type X402OperationRecord,
} from "./x402-state-integrity.js";
import {
  publicProviderX402Operation,
  type ProviderX402OperationRecord,
} from "./provider-x402-model.js";
import { ProviderX402Repository } from "./provider-x402-repository.js";
import { projectPublicX402Receipt, projectPublicX402Result } from "./x402-public-artifacts.js";
import { RailOperationRepository } from "./rail-operation-repository.js";
import { publicRailOperation, type RailOperationRecord } from "./rail-operation-model.js";
import { BridgeOperationRepository } from "./lifi/operation-repository.js";
import type { StoredBridgeOperationRecord } from "./lifi/legacy-operation.js";
import { publicStoredBridgeOperation } from "./lifi/receipt.js";
import { GaslessOperationRepository } from "./gasless/operation-repository.js";
import type { GaslessOperationRecord } from "./gasless/operation-model.js";
import { publicGaslessOperation } from "./gasless/receipt.js";
import { MetaMaskGaslessOperationRepository } from "./metamask-gasless/journal/repository.js";
import { publicMetaMaskGaslessOperation } from "./metamask-gasless/journal/receipt.js";
import type { MetaMaskGaslessOperationRecord } from "./metamask-gasless/operation-model.js";
import type { MetaMaskGaslessRepositoryPort } from "./metamask-gasless/ports.js";
import { SmartAccountGaslessOperationRepository } from "./smart-account-gasless/operation-repository.js";
import { publicSmartAccountGaslessOperation } from "./smart-account-gasless/receipt.js";
import type { SmartAccountGaslessOperationRecord } from "./smart-account-gasless/operation-model.js";
import type { SmartAccountGaslessRepositoryPort } from "./smart-account-gasless/ports.js";
import { FacilitatorGaslessOperationRepository, type FacilitatorGaslessRepositoryPort } from "./facilitator-gasless/operation-repository.js";
import type { FacilitatorOperationRecord } from "./facilitator-gasless/operation-model.js";
import { publicFacilitatorOperation } from "./facilitator-gasless/receipt.js";
import { RelayUnsignedOperationRepository, RelayRetirementRepository, publicRelayUnsignedOperation, validateRelayUnsignedOperation,
  type RelayUnsignedOperation } from "./relay-unsigned-operation.js";
import { assertExclusiveEvmOwner, evmAddressLock } from "./evm-address-ownership.js";
import { RelayEffectJournalRepository } from "./relay/effect-journal.js";
import { RelayNativeSourceJournalRepository } from "./relay/native-source.js";
export type StoredMoneyOperation =
  | { readonly kind: "sei_gaszip"; readonly record: SeiFundingRecord }
  | { readonly kind: "circle_route"; readonly record: CircleOperationV1 }
  | { readonly kind: "mega_gaszip"; readonly record: MegaFundingRecord }
  | { readonly kind: "merchant_x402"; readonly record: MerchantOperation }
  | { readonly kind: "permit2_production"; readonly record: Permit2ProductionRecord }
  | { readonly kind: "permit2_legacy_conflict"; readonly record: Permit2LegacyConflict }
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
export class OperationService {
  constructor(
    private readonly state: StateStore,
    private readonly providerX402 = new ProviderX402Repository(state.root),
    private readonly rails = new RailOperationRepository(state.root),
    private readonly bridges = new BridgeOperationRepository(state.root),
    private readonly gasless = new GaslessOperationRepository(state.root),
    private readonly metaMaskGasless: MetaMaskGaslessRepositoryPort = new MetaMaskGaslessOperationRepository(state.root),
    private readonly smartAccountGasless: SmartAccountGaslessRepositoryPort = new SmartAccountGaslessOperationRepository(state.root),
    private readonly facilitatorGasless: FacilitatorGaslessRepositoryPort = new FacilitatorGaslessOperationRepository(state.root),
    private readonly relayUnsigned = new RelayUnsignedOperationRepository(state.root),
    private readonly seiFunding: Pick<SeiFundingJournal, "listAllOperations" | "listOperations" | "findOperation"> = new SeiFundingJournal(state.root),
    private readonly megaFunding: Pick<MegaFundingJournal, "listAllOperations" | "listOperations" | "findOperation"> = new MegaFundingJournal(state.root),
  ) {}
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
      await this.assertProfileAvailable(operation.profileHash);
      await assertExclusiveEvmOwner(this.state, operation.sourceAccount, operation.profileHash);
      await this.relayUnsigned.persistLocked(operation);
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
    const matches = [
      ...(await this.seiFunding.listAllOperations()).filter(record => record.idempotencyHash === idempotencyHash).map(record => ({ kind: "sei_gaszip" as const, record })),
      ...(await this.circleOperations()).filter(operation => operation.idempotencyHash === idempotencyHash).map(record => ({ kind: "circle_route" as const, record })),
      ...(await this.megaFunding.listAllOperations()).filter(record => record.idempotencyHash === idempotencyHash).map(record => ({ kind: "mega_gaszip" as const, record })),
      ...(await this.merchantOperations()).filter(o => o.idempotencyHash === idempotencyHash).map(record => ({kind: "merchant_x402" as const, record})),
      ...(await this.relayUnsigned.listAllOperations()).filter((operation) => operation.idempotencyHash === idempotencyHash).map((record) => ({ kind: "relay_unsigned" as const, record })),
      ...(await this.facilitatorGasless.listAllOperations()).filter((operation) => operation.idempotencyHash === idempotencyHash).map((record) => ({ kind: "facilitator_gasless_transfer" as const, record })),
      ...(await this.smartAccountGasless.listAllOperations()).filter((operation) => operation.idempotencyHash === idempotencyHash).map((record) => ({ kind: "smart_account_gasless_transfer" as const, record })),
      ...(await this.metaMaskGasless.listAllOperations()).filter((operation) => operation.idempotencyHash === idempotencyHash).map((record) => ({ kind: "metamask_gasless_transfer" as const, record })),
      ...(await this.gasless.listAllOperations()).filter((operation) => operation.idempotencyHash === idempotencyHash).map((record) => ({ kind: "gasless_transfer" as const, record })),
      ...(await this.listAllBridgeOperations()).filter((operation) => operation.idempotencyHash === idempotencyHash).map((record) => ({ kind: "bridge_route" as const, record })),
      ...(await this.rails.listAllOperations()).filter((operation) => operation.idempotencyHash === idempotencyHash).map((record) => ({ kind: "rail_transfer" as const, record })),
      ...(await this.state.listAllOperations()).filter((operation) => operation.idempotencyHash === idempotencyHash).map((record) => ({ kind: "direct_transfer" as const, record })),
      ...(await this.state.listAllX402Operations()).filter((operation) => operation.idempotencyHash === idempotencyHash).map((record) => ({ kind: "x402_fetch" as const, strategy: "local" as const, record })),
      ...(await this.providerX402.listAllOperations()).filter((operation) => operation.idempotencyHash === idempotencyHash).map((record) => ({ kind: "x402_fetch" as const, strategy: "provider_atomic" as const, record })),
    ];
    if (matches.length > 1) throw new ApnError("APN_STATE_CORRUPT", "Idempotency identity is duplicated across operation stores.");
    return matches[0] ?? null;
  }
  async assertProfileAvailable(profileHash: string): Promise<void> {
    let blocking: StoredMoneyOperation | undefined;
    for (const operation of await this.profileOperations(profileHash)) {
      if (operation.record.terminal) continue;
      if (operation.kind === "relay_unsigned" && await this.relayLifecycle(operation.record) !== "active") continue;
      blocking = operation; break;
    }
    if (blocking !== undefined) {
      throw new ApnError("APN_OPERATION_BLOCKED", "Another money operation for this profile is not terminal.", {
        blockingOperationId: blocking.record.operationId,
        blockingState: blocking.record.state,
      });
    }
  }
  /** A new EVM money operation waits only for unresolved operations on the same chain and sending account. */
  async assertEvmAccountAvailable(profileHash: string, chainId: number | string, account: string): Promise<void> {
    await this.assertConflictDomainsAvailable(profileHash, () => [evmConflictDomain(chainId, account)]);
  }
  /** Only the real current foreground owner may exclude its exact own native journal claim. */
  async assertMetaMaskNativeOwnedAccountAvailable(scope:MetaMaskNativeOwnedScope,context:MetaMaskNativeOwnedContext):Promise<void> {
    assertMetaMaskNativeOwnedScope(scope,context);
    if(this.state.root!==context.stateRoot)throw new ApnError("APN_OPERATION_BLOCKED","Native owner conflict guard root changed.");
    const hashes=new Set([context.profileHash]),target=context.quote.sender.toLowerCase();
    for(const item of await this.state.profileImportEntries()) {
      if(!item.isDirectory()||item.isSymbolicLink()||!/^[a-f0-9]{64}$/.test(item.name))throw new ApnError("APN_STATE_CORRUPT","Profiles directory is invalid during native owner conflict guard.");
      const profile=await this.state.loadProviderProfile(item.name);if(profile===null)throw new ApnError("APN_STATE_CORRUPT","Provider profile disappeared during native owner conflict guard.");
      if(profile.public_address.toLowerCase()===target)hashes.add(item.name);
    }
    for(const wallet of await listLocalWallets(this.state))if(wallet.address.toLowerCase()===target)hashes.add(wallet.profileHash);
    for(const envelope of await listEncryptedWalletEnvelopes(this.state)) {
      const identity=walletEnvelopeIdentity(envelope.value,envelope.profile);if(identity.address.toLowerCase()===target)hashes.add(this.state.profileHash(identity.profile));
    }
    for(const operation of await this.state.listAllOperations())if(operation.walletAddress.toLowerCase()===target)hashes.add(operation.profileHash);
    assertMetaMaskNativeOwnedScope(scope,context);
    for(const hash of hashes)await this.assertConflictDomainsAvailable(hash,()=>[evmConflictDomain(context.quote.chainId,context.quote.sender)],undefined,false,undefined,undefined,{scope,context});
    assertMetaMaskNativeOwnedScope(scope,context);
  }
  async assertFinalizedCircleNativeAccountAvailable(profileHash: string, account: string, proof: VerifiedCircleNativeAdmission, exceptOperation?: OperationRecord): Promise<void> {
    const sources = verifiedCircleNativeSources(proof, profileHash, account);
    if (exceptOperation !== undefined && (exceptOperation.profileHash !== profileHash || exceptOperation.walletAddress !== account || exceptOperation.chainId !== 42161 || exceptOperation.evm?.asset.kind !== "native" || exceptOperation.evm.circleNativeAdmission === undefined || (await this.state.findOperation(exceptOperation.operationId))?.integrityHash !== exceptOperation.integrityHash)) throw new ApnError("APN_OPERATION_BLOCKED", "Native exclusion requires its exact saved operation.");
    await this.assertConflictDomainsAvailable(profileHash, () => [evmConflictDomain(42161, account)], exceptOperation?.operationId, false, sources);
  }
  async assertCleanup85NativeAccountAvailable(proof: VerifiedCleanup85RecoveryAdmission, request: Cleanup85CancellationRequest, exceptOperation?: OperationRecord): Promise<void> {
    const v = await cleanup85ConflictExclusion(this.state, proof, request, exceptOperation); await this.assertConflictDomainsAvailable(v.profileHash, () => [evmConflictDomain(42161, v.account)], exceptOperation?.operationId, false, undefined, v.parent);
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

  private async assertConflictDomainsAvailable(profileHash: string, domains: () => readonly MoneyConflictDomain[], exceptOperationId?: string, allowIncludedCircleSource = false, finalizedNativeSources?: ReadonlyMap<string, string>, cleanup85Parent?: { readonly operationId: string; readonly integrityHash: string }, nativeOwner?: { readonly scope:MetaMaskNativeOwnedScope; readonly context:MetaMaskNativeOwnedContext }): Promise<void> {
    let wanted: ReadonlySet<string>;
    try { wanted = new Set(domains().map(conflictDomainKey)); } catch { wanted = new Set(); }
    if(this.state.root!==undefined) {
      for(const wantedKey of wanted) {
        const [family,network,account]=wantedKey.split(":");
        if(family!=="evm"||network===undefined||account===undefined)continue;
        if(nativeOwner!==undefined) {
          assertMetaMaskNativeOwnedScope(nativeOwner.scope,nativeOwner.context);
          if(nativeOwner.context.stateRoot!==this.state.root||String(nativeOwner.context.quote.chainId)!==network||nativeOwner.context.quote.sender.toLowerCase()!==account)throw new ApnError("APN_OPERATION_BLOCKED","Native owner conflict domain changed.");
          await assertMetaMaskNativeOwnedConflictDomainAvailable(nativeOwner.scope,nativeOwner.context);
        } else await assertMetaMaskNativeConflictDomainAvailable(this.state.root,network,account);
      }
    }
    for (const operation of await this.profileOperations(profileHash)) {
      if (operation.record.terminal || operation.record.operationId === exceptOperationId) continue;
      if (operation.kind === "relay_unsigned" && await this.relayLifecycle(operation.record) !== "active") continue;
      let held = storedOperationDomains(operation);
      if (allowIncludedCircleSource && operation.kind === "circle_route" && operation.record.source !== null &&
        operation.record.residualAllowanceAtomic === "0" && operation.record.effects.find(e => e.role === "burn")?.phase === "confirmed") {
        // Only another CCTP operation may queue a source nonce after canonical inclusion. Other rails remain conservative.
        held = held?.filter(domain => !(domain.family === "evm" && domain.network === "42161" && domain.account === operation.record.sourceCustody.walletAddress.toLowerCase())) ?? null;
      }
      if (operation.kind === "circle_route" && finalizedNativeSources?.get(operation.record.operationId) === circleNativeSourceIdentity(operation.record))
        held = held?.filter(domain => !(domain.family === "evm" && domain.network === "42161" && domain.account === operation.record.sourceCustody.walletAddress.toLowerCase())) ?? null;
      if (operation.kind === "circle_route" && cleanup85Parent?.operationId === operation.record.operationId && cleanup85Parent.integrityHash === operation.record.integrityHash) held = held?.filter(domain => !(domain.family === "evm" && domain.network === "42161" && domain.account === operation.record.sourceCustody.walletAddress.toLowerCase())) ?? null;
      const shared = held?.find((domain) => wanted.has(conflictDomainKey(domain)));
      // An unreadable network or account on either side blocks the whole profile.
      if (held !== null && wanted.size > 0 && shared === undefined) continue;
      throw new ApnError("APN_OPERATION_BLOCKED", shared === undefined
        ? "Another money operation for this profile is not terminal."
        : "Another money operation for this network and account is not terminal.", {
        blockingOperationId: operation.record.operationId,
        blockingState: operation.record.state,
        ...(shared === undefined ? {} : { blockingNetwork: `${shared.family}:${shared.network}`, blockingAccount: shared.account }),
      });
    }
  }

  // Historical embedding ports supply only list methods; concrete StateStore always has a checked root.
  private async permit2ProductionOperations(profileHash: string) {
    return this.state.root === undefined ? [] : new Permit2ProductionRepository(this.state.root).listOperations(profileHash);
  }
  private async permit2LegacyOperations(profileHash: string) {
    return this.state.root === undefined ? [] : new Permit2LegacyConflictRepository(this.state.root).listOperations(profileHash);
  }
  private async profileOperations(profileHash: string): Promise<readonly StoredMoneyOperation[]> {
    return [
      ...(await this.seiFunding.listOperations(profileHash)).map(record => ({ kind: "sei_gaszip" as const, record })),
      ...(await this.circleOperations(profileHash)).map(record => ({ kind: "circle_route" as const, record })),
      ...(await this.megaFunding.listOperations(profileHash)).map(record => ({ kind: "mega_gaszip" as const, record })),
      ...(await this.merchantOperations(profileHash)).map(record => ({kind: "merchant_x402" as const, record})),
      ...(await this.permit2ProductionOperations(profileHash)).map(record => ({ kind: "permit2_production" as const, record })),
      ...(await this.permit2LegacyOperations(profileHash)).map(record => ({ kind: "permit2_legacy_conflict" as const, record })),
      ...(await this.relayUnsigned.listOperations(profileHash)).map((record) => ({ kind: "relay_unsigned" as const, record })),
      ...(await this.facilitatorGasless.listOperations(profileHash)).map((record) => ({ kind: "facilitator_gasless_transfer" as const, record })),
      ...(await this.smartAccountGasless.listOperations(profileHash)).map((record) => ({ kind: "smart_account_gasless_transfer" as const, record })),
      ...(await this.metaMaskGasless.listOperations(profileHash)).map((record) => ({ kind: "metamask_gasless_transfer" as const, record })),
      ...(await this.gasless.listOperations(profileHash)).map((record) => ({ kind: "gasless_transfer" as const, record })),
      ...(await this.listBridgeOperations(profileHash)).map((record) => ({ kind: "bridge_route" as const, record })),
      ...(await this.rails.listOperations(profileHash)).map((record) => ({ kind: "rail_transfer" as const, record })),
      ...(await this.state.listOperations(profileHash)).map((record) => ({ kind: "direct_transfer" as const, record })),
      ...(await this.state.listX402Operations(profileHash)).map((record) => ({ kind: "x402_fetch" as const, strategy: "local" as const, record })),
      ...(await this.providerX402.listOperations(profileHash)).map((record) => ({ kind: "x402_fetch" as const, strategy: "provider_atomic" as const, record })),
    ];
  }

  private async circleOperations(profileHash?: string): Promise<readonly CircleOperationV1[]> {
    if (this.state.root === undefined) return [];
    const repo = new CircleRepository(this.state.root);
    return profileHash === undefined ? repo.listAllOperations() : repo.listOperations(profileHash);
  }

  /** Finite unsigned retry only; IDs are derived and independently checked, never caller exclusions. */
  async assertCleanup85PreparationAccountsAvailable(record: CircleOperationV1, now: number): Promise<void> {
    const native = await cleanup85UnsignedResumeExclusion(this.state, record, now);
    if (native === null) return this.assertCircleAccountsAvailable(record, true, "cleanup");
    await this.assertConflictDomainsAvailable(record.profileHash, () => [evmConflictDomain(42161, record.sourceCustody.walletAddress)], native, true, undefined, { operationId: record.operationId, integrityHash: record.integrityHash });
    await this.assertConflictDomainsAvailable(record.destinationProfileHash, () => [evmConflictDomain(record.destinationChain, record.destinationCustody.walletAddress)], record.operationId);
  }
  /** Both Circle signing accounts are held under their existing profile locks. */
  async assertCircleAccountsAvailable(record: CircleOperationV1, exceptSaved = false, effectRole?: CircleRole): Promise<void> {
    if (exceptSaved) {
      const saved = await new CircleRepository(this.state.root).load(record.operationId);
      if (saved === null || saved.integrityHash !== record.integrityHash) throw new ApnError("APN_OPERATION_BLOCKED", "Circle exclusion requires the exact durable journal.");
    }
    const except = exceptSaved ? record.operationId : undefined;
    const settledSourceMint = exceptSaved && effectRole === "mint" && record.source?.finalityTag === "finalized" &&
      record.attestation !== null && record.residualAllowanceAtomic === "0" && record.effects.find(e => e.role === "burn")?.phase === "confirmed" &&
      record.effects.filter(e => e.role !== "mint").every(e => e.phase === "confirmed");
    // Finalized source settlement is read-only during mint. Its signer remains occupied for all other financial roles.
    if (settledSourceMint) assertCircleAttestation(record.source!, record.attestation!);
    else await this.assertConflictDomainsAvailable(record.profileHash,
      () => [evmConflictDomain(42161, record.sourceCustody.walletAddress)], except, true);
    await this.assertConflictDomainsAvailable(record.destinationProfileHash,
      () => [evmConflictDomain(record.destinationChain, record.destinationCustody.walletAddress)], except);
  }

  async assertProviderAccountAvailable(providerId: string, accountBindingHash: string, payer: string, exceptOperationId?: string): Promise<void> {
    const direct = (await this.state.listAllOperations()).filter((record) => !record.terminal &&
      record.operationId !== exceptOperationId &&
      record.providerDirect?.providerId === providerId &&
      (record.providerDirect.accountBindingHash === accountBindingHash || record.walletAddress.toLowerCase() === payer.toLowerCase()));
    const providerPaid = (await this.providerX402.listAllOperations()).filter((record) => !record.terminal &&
      record.operationId !== exceptOperationId &&
      record.provider.providerId === providerId &&
      (record.provider.accountBindingHash === accountBindingHash || record.provider.payer.toLowerCase() === payer.toLowerCase()));
    const blocking = direct[0] ?? providerPaid[0];
    if (blocking !== undefined) {
      throw new ApnError("APN_OPERATION_BLOCKED", "Another money operation for this provider account is not terminal.", {
        blockingOperationId: blocking.operationId,
        blockingState: blocking.state,
      });
    }
  }

  private async merchantOperations(profileHash?: string) {
    if (this.state.root === undefined) return [];
    const records = new MerchantRepository(this.state.root);
    return profileHash === undefined ? records.listAllOperations() : records.listOperations(profileHash);
  }

  async assertMerchantAccountAvailable(record: MerchantOperation): Promise<void> {
    validateMerchant(record);
    const saved = await new MerchantRepository(this.state.root).findOperation(record.operationId);
    if (saved === null || saved.integrityHash !== record.integrityHash) throw new ApnError("APN_OPERATION_BLOCKED", "Merchant conflict exclusion requires the exact saved operation.");
    await this.assertConflictDomainsAvailable(record.profileHash, () => [evmConflictDomain(4326, record.custody.walletAddress)], record.operationId);
  }

  async required(operationId: string): Promise<StoredMoneyOperation> {
    const canonicalId = canonicalOperationId(operationId);
    const mega = await this.megaFunding.findOperation(canonicalId);
    const sei = await this.seiFunding.findOperation(canonicalId);
    const circle = (await this.circleOperations()).find(record => record.operationId === canonicalId) ?? null;
    const merchant = await new MerchantRepository(this.state.root).findOperation(canonicalId);
    const permit2 = await new Permit2ProductionRepository(this.state.root).findOperation(canonicalId);
    const direct = await this.state.findOperation(canonicalId);
    const x402 = await this.state.findX402Operation(canonicalId);
    const providerX402 = await this.providerX402.findOperation(canonicalId);
    const rail = await this.rails.findOperation(canonicalId);
    const bridge = await this.findBridgeOperation(canonicalId);
    const gasless = await this.gasless.findOperation(canonicalId);
    const metaMaskGasless = await this.metaMaskGasless.findOperation(canonicalId);
    const smartAccountGasless = await this.smartAccountGasless.findOperation(canonicalId);
    const facilitatorGasless = await this.facilitatorGasless.findOperation(canonicalId);
    const relayUnsigned = await this.relayUnsigned.findOperation(canonicalId);
    if ([merchant, mega, sei, circle, permit2, direct, x402, providerX402, rail, bridge, gasless, metaMaskGasless, smartAccountGasless, facilitatorGasless, relayUnsigned]
      .filter((value) => value !== null).length > 1) {
      throw new ApnError("APN_STATE_CORRUPT", "Operation ID is duplicated across operation stores.");
    }
    if (mega !== null) return { kind: "mega_gaszip", record: mega };
    if (sei !== null) return { kind: "sei_gaszip", record: sei };
    if (circle !== null) return { kind: "circle_route", record: circle };
    if (merchant !== null) return { kind: "merchant_x402", record: merchant };
    if (permit2 !== null) return { kind: "permit2_production", record: permit2 };
    if (direct !== null) return { kind: "direct_transfer", record: direct };
    if (x402 !== null) return { kind: "x402_fetch", strategy: "local", record: x402 };
    if (providerX402 !== null) return { kind: "x402_fetch", strategy: "provider_atomic", record: providerX402 };
    if (rail !== null) return { kind: "rail_transfer", record: rail };
    if (bridge !== null) return { kind: "bridge_route", record: bridge };
    if (gasless !== null) return { kind: "gasless_transfer", record: gasless };
    if (metaMaskGasless !== null) return { kind: "metamask_gasless_transfer", record: metaMaskGasless };
    if (smartAccountGasless !== null) return { kind: "smart_account_gasless_transfer", record: smartAccountGasless };
    if (facilitatorGasless !== null) return { kind: "facilitator_gasless_transfer", record: facilitatorGasless };
    if (relayUnsigned !== null) return { kind: "relay_unsigned", record: relayUnsigned };
    throw new ApnError("APN_OPERATION_NOT_FOUND", "Operation was not found.");
  }

  async status(operationId: string): Promise<unknown> {
    const operation = await this.required(operationId);
    if (operation.kind === "sei_gaszip") return publicSeiFunding(operation.record);
    if (operation.kind === "circle_route") return publicCircle(operation.record);
    if (operation.kind === "mega_gaszip") return publicMegaFunding(operation.record);
    if (operation.kind === "merchant_x402") return publicMerchant(operation.record);
    if (operation.kind === "permit2_production") return publicPermit2Production(operation.record);
    if (operation.kind === "permit2_legacy_conflict") throw new ApnError("APN_OPERATION_BLOCKED", "Legacy Permit2 execution remains blocked.");
    if (operation.kind === "relay_unsigned") return this.relayStatus(operation.record);
    if (operation.kind === "direct_transfer") return publicOperation(operation.record);
    if (operation.kind === "rail_transfer") return publicRailOperation(operation.record);
    if (operation.kind === "bridge_route") return publicStoredBridgeOperation(operation.record);
    if (operation.kind === "gasless_transfer") return publicGaslessOperation(operation.record);
    if (operation.kind === "metamask_gasless_transfer") return publicMetaMaskGaslessOperation(operation.record);
    if (operation.kind === "smart_account_gasless_transfer") return publicSmartAccountGaslessOperation(operation.record);
    if (operation.kind === "facilitator_gasless_transfer") return publicFacilitatorOperation(operation.record);
    return operation.strategy === "local"
      ? publicX402Operation(operation.record)
      : publicProviderX402Operation(operation.record);
  }

  async relayStatus(operation: RelayUnsignedOperation) {
    const retirement = await new RelayRetirementRepository(this.state.root).load(operation);
    const completion = retirement === null ? await this.relaySourceCompletion(operation) : null;
    return publicRelayUnsignedOperation(operation, retirement, completion);
  }

  /** Source finality ends this operation's spend attempt. Destination delivery is observed separately. */
  private async relaySourceCompletion(operation: RelayUnsignedOperation): Promise<{ journalIntegrityHash: string } | null> {
    if (operation.arbitrumDraft !== undefined) return null;
    if (operation.nativeQuote !== undefined) {
      const journal = await new RelayNativeSourceJournalRepository(this.state.root).load(operation);
      return journal?.phase === "confirmed" ? { journalIntegrityHash: journal.integrityHash } : null;
    }
    const journal = await new RelayEffectJournalRepository(this.state.root).load(operation.profileHash, operation.operationId);
    return journal?.effects[1].phase === "confirmed" ? { journalIntegrityHash: journal.integrityHash } : null;
  }

  private async relayLifecycle(operation: RelayUnsignedOperation): Promise<"active" | "retired" | "source_confirmed"> {
    if (await new RelayRetirementRepository(this.state.root).load(operation) !== null) return "retired";
    return await this.relaySourceCompletion(operation) === null ? "active" : "source_confirmed";
  }

  // Test and embedding ports written before the compatibility reader expose the
  // original current-record methods. Keep those ports working while the concrete
  // repository supplies the version-aware methods.
  private async listAllBridgeOperations(): Promise<readonly StoredBridgeOperationRecord[]> {
    const repository = this.bridges as BridgeOperationRepository & Partial<{
      listAllStoredOperations(): Promise<readonly StoredBridgeOperationRecord[]>;
    }>;
    return typeof repository.listAllStoredOperations === "function"
      ? await repository.listAllStoredOperations()
      : await repository.listAllOperations();
  }
  private async listBridgeOperations(profileHash: string): Promise<readonly StoredBridgeOperationRecord[]> {
    const repository = this.bridges as BridgeOperationRepository & Partial<{
      listStoredOperations(profileHash: string): Promise<readonly StoredBridgeOperationRecord[]>;
    }>;
    return typeof repository.listStoredOperations === "function"
      ? await repository.listStoredOperations(profileHash)
      : await repository.listOperations(profileHash);
  }
  private async findBridgeOperation(operationId: string): Promise<StoredBridgeOperationRecord | null> {
    const repository = this.bridges as BridgeOperationRepository & Partial<{
      findStoredOperation(operationId: string): Promise<StoredBridgeOperationRecord | null>;
    }>;
    return typeof repository.findStoredOperation === "function"
      ? await repository.findStoredOperation(operationId)
      : await repository.findOperation(operationId);
  }

  async x402Outcome(
    operationId: string,
    options: {
      readonly exposeSellerResult: boolean;
      readonly exposeTerminalReceipt: boolean;
      readonly settlementWait?: X402SettlementWaitProjection;
    },
  ): Promise<CommandOutcome> {
    const found = await this.required(operationId);
    if (found.kind !== "x402_fetch") throw new ApnError("APN_OPERATION_BLOCKED", "Operation is not an x402 fetch.");
    if (found.strategy === "provider_atomic") {
      const operation = found.record;
      const receipt = operation.terminal && options.exposeTerminalReceipt
        ? await this.providerX402.loadReceipt(operation.profileHash, operation.operationId)
        : null;
      if (operation.terminal && options.exposeTerminalReceipt && receipt === null) {
        throw new ApnError("APN_STATE_CORRUPT", "Terminal provider x402 operation has no public receipt.");
      }
      return {
        proofClass: operation.proofClass,
        data: options.exposeSellerResult && operation.state === "completed" && operation.sellerResult !== undefined
          ? projectPublicX402Result({ variant: "normalized_provider_json", result: operation.sellerResult })
          : null,
        operation: publicProviderX402Operation(operation, options.settlementWait),
        receipt: receipt === null ? null : projectPublicX402Receipt({
          variant: "normalized_provider_json", operation, receipt,
        }),
        nextActions: operation.nextActions,
      };
    }
    const operation = found.record;
    const result = operation.resultLink === undefined
      ? null
      : await this.state.loadX402Result(operation.profileHash, operation.operationId);
    if (operation.resultLink !== undefined && result === null) {
      throw new ApnError("APN_STATE_CORRUPT", "x402 operation has a dangling public result link.");
    }
    const receipt = operation.terminal && options.exposeTerminalReceipt
      ? await this.state.loadX402Receipt(operation.profileHash, operation.operationId)
      : null;
    if (operation.terminal && options.exposeTerminalReceipt && receipt === null) {
      throw new ApnError("APN_STATE_CORRUPT", "Terminal x402 operation has no public receipt.");
    }
    let data: unknown | null = null;
    if (options.exposeSellerResult && operation.state === "completed") {
      if (result === null) throw new ApnError("APN_STATE_CORRUPT", "Completed x402 operation has no public result.");
      data = projectPublicX402Result({ variant: "local", result });
    }
    return {
      proofClass: operation.proofClass,
      data,
      operation: publicX402Operation(operation, result ?? undefined, options.settlementWait),
      receipt: receipt === null ? null : projectPublicX402Receipt({ variant: "local", receipt }),
      nextActions: operation.nextActions,
    };
  }

  async x402ReceiptOutcome(operationId: string): Promise<CommandOutcome> {
    const found = await this.required(operationId);
    if (found.kind !== "x402_fetch") throw new ApnError("APN_OPERATION_BLOCKED", "Operation is not an x402 fetch.");
    if (found.strategy === "provider_atomic") {
      const receipt = await this.providerX402.loadReceipt(found.record.profileHash, found.record.operationId);
      if (receipt === null) throw new ApnError("APN_RECEIPT_NOT_FOUND", "Durable receipt is not available.");
      return {
        proofClass: receipt.proofClass,
        data: null,
        operation: null,
        receipt: projectPublicX402Receipt({ variant: "normalized_provider_json", operation: found.record, receipt }),
        nextActions: [],
      };
    }
    const operation = found.record;
    const receipt = await this.state.loadX402Receipt(operation.profileHash, operation.operationId);
    if (receipt === null) throw new ApnError("APN_RECEIPT_NOT_FOUND", "Durable receipt is not available.");
    return {
      proofClass: receipt.proofClass,
      data: null,
      operation: null,
      receipt: projectPublicX402Receipt({ variant: "local", receipt }),
      nextActions: [],
    };
  }
}
