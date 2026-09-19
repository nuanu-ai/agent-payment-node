import {
  prepareUsdtOperation, refuseUsdtApproval, refuseUsdtDispatch, refuseUsdtRecovery, refuseUsdtSigner,
  resumeUsdtOperation, statusUsdtOperation, type UsdtOperationInput, type UsdtOperationRecord, type UsdtOperationRepository,
} from "./operation.js";

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

  approve(): never { return refuseUsdtApproval("approve"); }
  execute(): never { return refuseUsdtApproval("execute"); }
  sign(): never { return refuseUsdtSigner(); }
  dispatch(): never { return refuseUsdtDispatch(); }
  recover(): never { return refuseUsdtRecovery(); }
}
