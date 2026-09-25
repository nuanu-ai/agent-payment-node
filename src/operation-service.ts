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

  /** A new Solana or TRON money operation waits only for unresolved operations of the same rail account. */
  async assertRailAccountAvailable(profileHash: string, rail: "solana" | "tron", account: string): Promise<void> {
    await this.assertConflictDomainsAvailable(profileHash, () => [railConflictDomain(rail, account)]);
  }

  private async assertConflictDomainsAvailable(profileHash: string, domains: () => readonly MoneyConflictDomain[]): Promise<void> {
    let wanted: ReadonlySet<string>;
    try { wanted = new Set(domains().map(conflictDomainKey)); } catch { wanted = new Set(); }
    for (const operation of await this.profileOperations(profileHash)) {
      if (operation.record.terminal) continue;
      if (operation.kind === "relay_unsigned" && await this.relayLifecycle(operation.record) !== "active") continue;
      const held = storedOperationDomains(operation);
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

  private async profileOperations(profileHash: string): Promise<readonly StoredMoneyOperation[]> {
    return [
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

  async required(operationId: string): Promise<StoredMoneyOperation> {
    const canonicalId = canonicalOperationId(operationId);
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
    if ([direct, x402, providerX402, rail, bridge, gasless, metaMaskGasless, smartAccountGasless, facilitatorGasless, relayUnsigned]
      .filter((value) => value !== null).length > 1) {
      throw new ApnError("APN_STATE_CORRUPT", "Operation ID is duplicated across operation stores.");
    }
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
