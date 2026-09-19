import {
  prepareUsdtOperation, refuseUsdtApproval, refuseUsdtDispatch, refuseUsdtRecovery, refuseUsdtSigner,
  resumeUsdtOperation, statusUsdtOperation, type UsdtOperationInput, type UsdtOperationRecord, type UsdtOperationRepository,
} from "./operation.js";

/** Read-only operation boundary for the gasless USDT foundation. No signer or dispatcher is reachable. */
export class GaslessUsdtOperationService {
  constructor(readonly repository: UsdtOperationRepository, readonly profileHash: string) {}

  async prepare(input: Omit<UsdtOperationInput, "profileHash">, idempotencyKey: string): Promise<UsdtOperationRecord> {
    return prepareUsdtOperation(this.repository, { ...input, profileHash: this.profileHash }, idempotencyKey);
  }

  async status(operationId: string): Promise<UsdtOperationRecord> {
    return statusUsdtOperation(this.repository, this.profileHash, operationId);
  }

  async resume(operationId: string): Promise<UsdtOperationRecord> {
    return resumeUsdtOperation(this.repository, this.profileHash, operationId);
  }

  approve(): never { return refuseUsdtApproval("approve"); }
  execute(): never { return refuseUsdtApproval("execute"); }
  sign(): never { return refuseUsdtSigner(); }
  dispatch(): never { return refuseUsdtDispatch(); }
  recover(): never { return refuseUsdtRecovery(); }
}
