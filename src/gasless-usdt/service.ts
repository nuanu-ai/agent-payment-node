import {
  prepareUsdtOperation, refuseUsdtApproval, refuseUsdtDispatch, refuseUsdtRecovery, refuseUsdtSigner,
  resumeUsdtOperation, statusUsdtOperation, type UsdtOperationInput, type UsdtOperationRecord, type UsdtOperationRepository,
} from "./operation.js";
import { classifyUsdtBoundRecovery, UsdtBoundOperationRepository, type UsdtBoundOperation, type UsdtBoundRecovery } from "./bound-operation.js";
import type { UsdtPolicyPrepared, UsdtPreparePort } from "./policy-prepare.js";
import { ApnError } from "../errors.js";

/** Read-only operation boundary for the gasless USDT foundation. No signer or dispatcher is reachable. */
export class GaslessUsdtOperationService {
  constructor(readonly repository: UsdtOperationRepository, private readonly profileHash?: string) {}

  /** Bind an explicit persisted profile hash; profile names are never interpreted as hashes. */
  forProfile(profileHash: string): GaslessUsdtOperationService {
    return new GaslessUsdtOperationService(this.repository, profileHash);
  }

  private boundProfile(): string {
    if (this.profileHash === undefined) throw new Error("Gasless USDT operation profile binding is required.");
    return this.profileHash;
  }

  async prepare(input: Omit<UsdtOperationInput, "profileHash">, idempotencyKey: string): Promise<UsdtOperationRecord> {
    return prepareUsdtOperation(this.repository, { ...input, profileHash: this.boundProfile() }, idempotencyKey);
  }

  async status(operationId: string): Promise<UsdtOperationRecord> {
    return statusUsdtOperation(this.repository, this.boundProfile(), operationId);
  }

  async resume(operationId: string): Promise<UsdtOperationRecord> {
    return resumeUsdtOperation(this.repository, this.boundProfile(), operationId);
  }

  /** Persist the complete domain preparation. This cannot reserve usage or reach a signer. */
  async prepareBound(binding: UsdtPolicyPrepared, idempotencyKey: string, now: Date): Promise<UsdtBoundOperation> {
    return new UsdtBoundOperationRepository(this.repository.root).create(this.boundProfile(), binding, idempotencyKey, now);
  }

  async statusBound(operationId: string): Promise<UsdtBoundOperation> {
    const record = await new UsdtBoundOperationRepository(this.repository.root).load(this.boundProfile(), operationId);
    if (record === null) throw new ApnError("APN_OPERATION_NOT_FOUND", "Gasless USDT bound operation was not found.",
      { reason: "bound_operation_not_found", rail: "gasless_usdt" });
    return record;
  }

  /** Fresh, read-only recovery classification. No saved state is changed. */
  async resumeBound(operationId: string, port: UsdtPreparePort): Promise<UsdtBoundRecovery> {
    return classifyUsdtBoundRecovery(await this.statusBound(operationId), port);
  }

  approve(): never { return refuseUsdtApproval("approve"); }
  execute(): never { return refuseUsdtApproval("execute"); }
  sign(): never { return refuseUsdtSigner(); }
  dispatch(): never { return refuseUsdtDispatch(); }
  recover(): never { return refuseUsdtRecovery(); }
}
