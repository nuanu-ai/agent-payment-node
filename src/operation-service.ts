import { ApnError } from "./errors.js";
import type { CommandOutcome } from "./commands.js";
import type { OperationRecord } from "./model.js";
import type { StateStore } from "./state.js";
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
import type { BridgeOperationRecord } from "./lifi/operation-model.js";
import { publicBridgeOperation } from "./lifi/receipt.js";
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

export type StoredMoneyOperation =
  | { readonly kind: "smart_account_gasless_transfer"; readonly record: SmartAccountGaslessOperationRecord }
  | { readonly kind: "metamask_gasless_transfer"; readonly record: MetaMaskGaslessOperationRecord }
  | { readonly kind: "gasless_transfer"; readonly record: GaslessOperationRecord }
  | { readonly kind: "bridge_route"; readonly record: BridgeOperationRecord }
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
  ) {}

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
      ...(await this.smartAccountGasless.listAllOperations()).filter((operation) => operation.idempotencyHash === idempotencyHash).map((record) => ({ kind: "smart_account_gasless_transfer" as const, record })),
      ...(await this.metaMaskGasless.listAllOperations()).filter((operation) => operation.idempotencyHash === idempotencyHash).map((record) => ({ kind: "metamask_gasless_transfer" as const, record })),
      ...(await this.gasless.listAllOperations()).filter((operation) => operation.idempotencyHash === idempotencyHash).map((record) => ({ kind: "gasless_transfer" as const, record })),
      ...(await this.bridges.listAllOperations()).filter((operation) => operation.idempotencyHash === idempotencyHash).map((record) => ({ kind: "bridge_route" as const, record })),
      ...(await this.rails.listAllOperations()).filter((operation) => operation.idempotencyHash === idempotencyHash).map((record) => ({ kind: "rail_transfer" as const, record })),
      ...(await this.state.listAllOperations()).filter((operation) => operation.idempotencyHash === idempotencyHash).map((record) => ({ kind: "direct_transfer" as const, record })),
      ...(await this.state.listAllX402Operations()).filter((operation) => operation.idempotencyHash === idempotencyHash).map((record) => ({ kind: "x402_fetch" as const, strategy: "local" as const, record })),
      ...(await this.providerX402.listAllOperations()).filter((operation) => operation.idempotencyHash === idempotencyHash).map((record) => ({ kind: "x402_fetch" as const, strategy: "provider_atomic" as const, record })),
    ];
    if (matches.length > 1) throw new ApnError("APN_STATE_CORRUPT", "Idempotency identity is duplicated across operation stores.");
    return matches[0] ?? null;
  }

  async assertProfileAvailable(profileHash: string): Promise<void> {
    const active: StoredMoneyOperation[] = [
      ...(await this.smartAccountGasless.listOperations(profileHash)).map((record) => ({ kind: "smart_account_gasless_transfer" as const, record })),
      ...(await this.metaMaskGasless.listOperations(profileHash)).map((record) => ({ kind: "metamask_gasless_transfer" as const, record })),
      ...(await this.gasless.listOperations(profileHash)).map((record) => ({ kind: "gasless_transfer" as const, record })),
      ...(await this.bridges.listOperations(profileHash)).map((record) => ({ kind: "bridge_route" as const, record })),
      ...(await this.rails.listOperations(profileHash)).map((record) => ({ kind: "rail_transfer" as const, record })),
      ...(await this.state.listOperations(profileHash)).map((record) => ({ kind: "direct_transfer" as const, record })),
      ...(await this.state.listX402Operations(profileHash)).map((record) => ({ kind: "x402_fetch" as const, strategy: "local" as const, record })),
      ...(await this.providerX402.listOperations(profileHash)).map((record) => ({ kind: "x402_fetch" as const, strategy: "provider_atomic" as const, record })),
    ];
    const blocking = active.find(({ record }) => !record.terminal);
    if (blocking !== undefined) {
      throw new ApnError("APN_OPERATION_BLOCKED", "Another money operation for this profile is not terminal.", {
        blockingOperationId: blocking.record.operationId,
        blockingState: blocking.record.state,
      });
    }
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
    const bridge = await this.bridges.findOperation(canonicalId);
    const gasless = await this.gasless.findOperation(canonicalId);
    const metaMaskGasless = await this.metaMaskGasless.findOperation(canonicalId);
    const smartAccountGasless = await this.smartAccountGasless.findOperation(canonicalId);
    if ([direct, x402, providerX402, rail, bridge, gasless, metaMaskGasless, smartAccountGasless].filter((value) => value !== null).length > 1) {
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
    throw new ApnError("APN_OPERATION_NOT_FOUND", "Operation was not found.");
  }

  async status(operationId: string): Promise<unknown> {
    const operation = await this.required(operationId);
    if (operation.kind === "direct_transfer") return publicOperation(operation.record);
    if (operation.kind === "rail_transfer") return publicRailOperation(operation.record);
    if (operation.kind === "bridge_route") return publicBridgeOperation(operation.record);
    if (operation.kind === "gasless_transfer") return publicGaslessOperation(operation.record);
    if (operation.kind === "metamask_gasless_transfer") return publicMetaMaskGaslessOperation(operation.record);
    if (operation.kind === "smart_account_gasless_transfer") return publicSmartAccountGaslessOperation(operation.record);
    return operation.strategy === "local"
      ? publicX402Operation(operation.record)
      : publicProviderX402Operation(operation.record);
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
