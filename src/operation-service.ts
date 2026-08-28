import { ApnError } from "./errors.js";
import type { CommandOutcome } from "./commands.js";
import type { OperationRecord } from "./model.js";
import type { StateStore } from "./state.js";
import { canonicalOperationId, publicOperation } from "./transfer-policy.js";
import {
  publicX402Operation,
  publicX402ResultData,
  type X402SettlementWaitProjection,
  type X402OperationRecord,
} from "./x402-state-integrity.js";

export type StoredMoneyOperation =
  | { readonly kind: "direct_transfer"; readonly record: OperationRecord }
  | { readonly kind: "x402_fetch"; readonly record: X402OperationRecord };

export class OperationService {
  constructor(private readonly state: StateStore) {}

  async resolvePrepare(input: {
    readonly kind: StoredMoneyOperation["kind"];
    readonly profileHash: string;
    readonly operationId: string;
    readonly idempotencyHash: string;
    readonly requestHash: string;
  }): Promise<StoredMoneyOperation | null> {
    const matches = [
      ...(await this.state.listAllOperations()).filter((operation) => operation.idempotencyHash === input.idempotencyHash).map((record) => ({ kind: "direct_transfer" as const, record })),
      ...(await this.state.listAllX402Operations()).filter((operation) => operation.idempotencyHash === input.idempotencyHash).map((record) => ({ kind: "x402_fetch" as const, record })),
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
      ...(await this.state.listX402Operations(profileHash)).map((record) => ({ kind: "x402_fetch" as const, record })),
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
    if (direct !== null && x402 !== null) throw new ApnError("APN_STATE_CORRUPT", "Operation ID is duplicated across operation stores.");
    if (direct !== null) return { kind: "direct_transfer", record: direct };
    if (x402 !== null) return { kind: "x402_fetch", record: x402 };
    throw new ApnError("APN_OPERATION_NOT_FOUND", "Operation was not found.");
  }

  async status(operationId: string): Promise<unknown> {
    const operation = await this.required(operationId);
    return operation.kind === "direct_transfer" ? publicOperation(operation.record) : publicX402Operation(operation.record);
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
      data = publicX402ResultData(result);
    }
    return {
      proofClass: operation.proofClass,
      data,
      operation: publicX402Operation(operation, result ?? undefined, options.settlementWait),
      receipt,
      nextActions: operation.nextActions,
    };
  }

  async x402ReceiptOutcome(operationId: string): Promise<CommandOutcome> {
    const found = await this.required(operationId);
    if (found.kind !== "x402_fetch") throw new ApnError("APN_OPERATION_BLOCKED", "Operation is not an x402 fetch.");
    const operation = found.record;
    const receipt = await this.state.loadX402Receipt(operation.profileHash, operation.operationId);
    if (receipt === null) throw new ApnError("APN_RECEIPT_NOT_FOUND", "Durable receipt is not available.");
    return {
      proofClass: receipt.proofClass,
      data: null,
      operation: null,
      receipt,
      nextActions: [],
    };
  }
}
