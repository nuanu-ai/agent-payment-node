import type { GaslessMutable, GaslessOperationRecord } from "./operation-model.js";
import type { GaslessRpcPort } from "./ports.js";
import { assertGaslessPermissionClosure } from "./permission-invalidation.js";
import { observationSchema } from "./schema.js";
import { assertGaslessSettlementContinuation, validateGaslessSettlement } from "./settlement-validation.js";
import { gaslessSame } from "./validation.js";

export type GaslessSave = (op: GaslessOperationRecord, patch: Partial<GaslessMutable>) => Promise<GaslessOperationRecord>;
export class GaslessObservationService {
  constructor(private readonly rpc: GaslessRpcPort, private readonly save: GaslessSave) {}
  async run(op: GaslessOperationRecord): Promise<GaslessOperationRecord> {
    if (op.terminal || op.bootstrap.signingAttempts === 0) return op;
    let result;
    try {
      const s = op.intent.initialSnapshot;
      if (this.rpc.chainId !== op.intent.request.chainId || this.rpc.rpcOrigin !== s.rpcOrigin ||
        this.rpc.rpcEndpointHash !== s.rpcEndpointHash || this.rpc.bundlerOrigin !== s.bundlerOrigin ||
        this.rpc.bundlerEndpointHash !== s.bundlerEndpointHash) throw new Error("endpoint");
      result = await this.rpc.observe(op.intent, { bootstrapMaterialHash: op.bootstrap.materialHash,
        userOperationMaterialHash: op.userOperation.materialHash,
        userOperationHash: op.userOperation.userOperationHash }, op.cursor);
      if (!observationSchema.safeParse(result).success || !gaslessSame(result.cursor.startBlock, op.cursor.startBlock)) throw new Error("shape");
      if (op.userOperation.submissionAttempts !== 1 && (result.transactionHash !== null || result.settlement !== null)) throw new Error("unsubmitted");
      if ((result.status === "safe") !== (result.settlement !== null)) throw new Error("proof");
      if ((result.status === "permissions_invalidated") !== (result.permissionInvalidation !== undefined)) throw new Error("permission proof");
      if (result.status === "permissions_invalidated") assertGaslessPermissionClosure(op, { ...op, observation: result });
      const proof = result.settlement;
      if (proof !== null) {
        if (op.userOperation.userOperationHash === null || result.transactionHash !== proof.transactionHash || result.evidenceHash === null) throw new Error("binding");
        validateGaslessSettlement(op.intent, op.userOperation.userOperationHash, proof);
      }
      const prior = op.observation?.settlement;
      if (prior !== null && prior !== undefined) {
        if (proof === null) throw new Error("lost proof");
        assertGaslessSettlementContinuation(prior, proof);
      }
    } catch {
      // Preserve an already proven effect when a later safe-state observation is unavailable.
      if (op.state === "failed_effects_pending") return op;
      return await this.save(op, { state: "unknown_finality", failure: "gasless_receipt_unresolved" });
    }
    if (result.status === "permissions_invalidated") {
      return await this.save(op, { state: "failed_permissions_invalidated", observation: result,
        cursor: result.cursor, failure: result.reason });
    }
    const proof = result.settlement;
    if (proof !== null) {
      const cleared = proof.safeAccount.allowanceAtomic === "0";
      if (proof.accounting.success && !cleared) {
        return await this.save(op, { state: "unknown_finality", observation: result, cursor: result.cursor,
          failure: "gasless_residual_allowance" });
      }
      const state = proof.accounting.success ? "completed" : cleared ? "failed_confirmed_revert" : "failed_effects_pending";
      return await this.save(op, { state, observation: result, cursor: result.cursor,
        settlement: cleared ? proof : null,
        userOperation: { ...op.userOperation, phase: proof.accounting.success ? "safe_success" : "safe_revert" },
        failure: proof.accounting.success ? null : cleared ? "gasless_transfer_reverted" : "gasless_residual_allowance" });
    }
    return await this.save(op, { state: result.status === "pending" ? "submitted_pending" : "unknown_finality",
      observation: result, cursor: result.cursor,
      failure: result.reason ?? (result.status === "pending" ? null : "gasless_receipt_unresolved") });
  }
}
