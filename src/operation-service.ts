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

export type StoredMoneyOperation =
  | { readonly kind: "direct_transfer"; readonly record: OperationRecord }
  | { readonly kind: "x402_fetch"; readonly strategy: "local"; readonly record: X402OperationRecord }
  | { readonly kind: "x402_fetch"; readonly strategy: "provider_atomic"; readonly record: ProviderX402OperationRecord };

export class OperationService {
  constructor(
    private readonly state: StateStore,
    private readonly providerX402 = new ProviderX402Repository(state.root),
  ) {}

  async resolvePrepare(input: {
    readonly kind: StoredMoneyOperation["kind"];
    readonly profileHash: string;
    readonly operationId: string;
    readonly idempotencyHash: string;
    readonly requestHash: string;
  }): Promise<StoredMoneyOperation | null> {
    const matches = [
      ...(await this.state.listAllOperations()).filter((operation) => operation.idempotencyHash === input.idempotencyHash).map((record) => ({ kind: "direct_transfer" as const, record })),
      ...(await this.state.listAllX402Operations()).filter((operation) => operation.idempotencyHash === input.idempotencyHash).map((record) => ({ kind: "x402_fetch" as const, strategy: "local" as const, record })),
      ...(await this.providerX402.listAllOperations()).filter((operation) => operation.idempotencyHash === input.idempotencyHash).map((record) => ({ kind: "x402_fetch" as const, strategy: "provider_atomic" as const, record })),
    ];
    if (matches.length > 1) throw new ApnError("APN_STATE_CORRUPT", "Idempotency identity is duplicated across operation stores.");
    const existing = matches[0];
    if (existing === undefined) return null;
    if (
      existing.kind !== input.kind || existing.record.profileHash !== input.profileHash ||
      existing.record.operationId !== input.operationId || existing.record.requestHash !== input.requestHash
    ) throw new ApnError("APN_IDEMPOTENCY_CONFLICT", "Idempotency key is already bound to different operation inputs.");
    return existing;
  }

  async assertProfileAvailable(profileHash: string): Promise<void> {
    const active: StoredMoneyOperation[] = [
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

  async required(operationId: string): Promise<StoredMoneyOperation> {
    const canonicalId = canonicalOperationId(operationId);
    const direct = await this.state.findOperation(canonicalId);
    const x402 = await this.state.findX402Operation(canonicalId);
    const providerX402 = await this.providerX402.findOperation(canonicalId);
    if ([direct, x402, providerX402].filter((value) => value !== null).length > 1) {
      throw new ApnError("APN_STATE_CORRUPT", "Operation ID is duplicated across operation stores.");
    }
    if (direct !== null) return { kind: "direct_transfer", record: direct };
    if (x402 !== null) return { kind: "x402_fetch", strategy: "local", record: x402 };
    if (providerX402 !== null) return { kind: "x402_fetch", strategy: "provider_atomic", record: providerX402 };
    throw new ApnError("APN_OPERATION_NOT_FOUND", "Operation was not found.");
  }

  async status(operationId: string): Promise<unknown> {
    const operation = await this.required(operationId);
    if (operation.kind === "direct_transfer") return publicOperation(operation.record);
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
