import type { StateStore } from "../state.js";
import { assertGaslessEstimate } from "./economics.js";
import { assertGaslessRemaining, gaslessReason, guardGaslessOperation } from "./guard.js";
import { validateGaslessMaterial } from "./material-validation.js";
import { GaslessObservationService, type GaslessSave } from "./observation.js";
import type { GaslessOperationRecord, GaslessRole } from "./operation-model.js";
import type { GaslessApprovalPort, GaslessBootstrapMaterial, GaslessCustodyPort,
  GaslessRpcPort, GaslessSealedMaterial, GaslessUserOperationMaterial } from "./ports.js";
import { publicGaslessOperation } from "./receipt.js";
import { gaslessFailure } from "./validation.js";

export class GaslessExecution {
  private readonly observation: GaslessObservationService;
  constructor(private readonly state: StateStore, private readonly rpc: GaslessRpcPort,
    private readonly custody: GaslessCustodyPort, private readonly now: () => number,
    private readonly save: GaslessSave) {
    this.observation = new GaslessObservationService(rpc, save);
  }
  async approve(op: GaslessOperationRecord, approval: GaslessApprovalPort): Promise<GaslessOperationRecord> {
    if (op.terminal || op.state !== "awaiting_approval") return op;
    try { await this.guard(op); } catch (error) { return await this.halt(op, error); }
    const accepted = await approval.confirm({ operationId: op.operationId, fingerprint: op.fingerprint,
      exactPhrase: `APPROVE GASLESS ${op.fingerprint}`, summary: publicGaslessOperation(op) });
    if (!accepted) return await this.save(op, { state: "failed_before_effect", failure: "gasless_approval_rejected" });
    try { assertGaslessRemaining(op, this.now()); } catch (error) { return await this.halt(op, error); }
    op = await this.save(op, { state: "execution_pending", approval: { policy: "apn.gasless.foreground-approval.v1",
      fingerprint: op.fingerprint, approvedAt: this.at(), expiresAt: op.intent.expiresAt } });
    return await this.run(op);
  }
  async run(op: GaslessOperationRecord): Promise<GaslessOperationRecord> {
    if (op.terminal || op.state === "awaiting_approval") return op;
    if (op.userOperation.submissionAttempts === 1 || op.state === "failed_effects_pending") return await this.observation.run(op);
    if (op.bootstrap.disclosureAttempts === 1 && op.bootstrap.estimate === null) {
      return await this.observation.run(await this.unknown(op, "gasless_bootstrap_unresolved"));
    }
    const bootstrapResult = await this.material(op, "bootstrap"); op = bootstrapResult.op;
    if (bootstrapResult.material === null) return op;
    const bootstrap = bootstrapResult.material as GaslessBootstrapMaterial;
    if (op.bootstrap.disclosureAttempts === 0) {
      try { await this.guard(op); } catch (error) { return await this.halt(op, error); }
      op = await this.save(op, { state: "bootstrap_pending", bootstrap: { ...op.bootstrap,
        phase: "disclosure_started", disclosureAttempts: 1, disclosedAt: this.at() } });
      let estimate;
      try {
        assertGaslessRemaining(op, this.now());
        estimate = await this.rpc.estimate(op.intent, bootstrap);
        assertGaslessEstimate(op.intent, estimate);
      } catch (error) {
        return await this.unknown(op, gaslessReason(error, "gasless_bootstrap_unresolved"));
      }
      op = await this.save(op, { bootstrap: { ...op.bootstrap, phase: "checked", estimate }, failure: null });
    }
    if (op.bootstrap.phase !== "checked" || op.bootstrap.estimate === null) return await this.unknown(op, "gasless_bootstrap_unresolved");
    const finalResult = await this.material(op, "user_operation", bootstrap); op = finalResult.op;
    if (finalResult.material === null) return op;
    const material = finalResult.material as GaslessUserOperationMaterial;
    try { await this.guard(op); } catch (error) { return await this.halt(op, error); }
    op = await this.save(op, { state: "user_operation_pending", userOperation: { ...op.userOperation,
      phase: "submitting", submissionAttempts: 1, submittedAt: this.at() }, failure: null });
    let acknowledged = false;
    try {
      assertGaslessRemaining(op, this.now());
      const returned = await this.rpc.send(op.intent, material);
      acknowledged = returned === material.userOperationHash;
    } catch { /* A durable first-send marker also owns a lost or malformed response. */ }
    op = await this.save(op, { state: acknowledged ? "submitted_pending" : "unknown_finality",
      userOperation: { ...op.userOperation, phase: acknowledged ? "submitted_pending" : "unknown_finality" },
      failure: acknowledged ? null : "gasless_submission_unknown" });
    return await this.observation.run(op);
  }
  private async material(op: GaslessOperationRecord, role: GaslessRole, bootstrap?: GaslessBootstrapMaterial):
    Promise<{ op: GaslessOperationRecord; material: GaslessSealedMaterial | null }> {
    let effect = role === "bootstrap" ? op.bootstrap : op.userOperation;
    if (effect.signingAttempts === 0) {
      try { await this.guard(op); } catch (error) { return { op: await this.halt(op, error), material: null }; }
      effect = { ...effect, phase: "signing_started", signingAttempts: 1, signingStartedAt: this.at() };
      op = await this.save(op, { state: role === "bootstrap" ? "bootstrap_pending" : "user_operation_pending", [this.key(role)]: effect });
      try { await this.custody.seal(op, role, op.intent.owner, bootstrap); }
      catch { /* Only a completed original seal is recoverable after an attempted signature. */ }
    }
    let material;
    try {
      const loaded = await this.custody.load(op, role);
      if (loaded === null) gaslessFailure("APN_PROVIDER_EFFECT_UNAVAILABLE", "gasless_material_missing");
      material = await validateGaslessMaterial(loaded, op, role, bootstrap);
    } catch {
      return { op: await this.unknown(op, role === "bootstrap" ? "gasless_bootstrap_unresolved" : "gasless_user_operation_unresolved"), material: null };
    }
    if (effect.materialHash === null || effect.phase === "unknown_finality") {
      // The original seal can be recovered without another signer invocation.
      effect = { ...effect, phase: "sealed", materialHash: material.materialHash,
        sealedAt: effect.sealedAt ?? this.at(), userOperationHash: material.role === "user_operation" ? material.userOperationHash : null };
      op = await this.save(op, { state: role === "bootstrap" ? "bootstrap_pending" : "user_operation_pending",
        [this.key(role)]: effect, failure: null });
    }
    return { op, material };
  }
  private key(role: GaslessRole): "bootstrap" | "userOperation" { return role === "bootstrap" ? "bootstrap" : "userOperation"; }
  private at(): string { return new Date(this.now()).toISOString(); }
  private async guard(op: GaslessOperationRecord): Promise<void> { await guardGaslessOperation(this.state, this.rpc, op, this.now); }
  private async halt(op: GaslessOperationRecord, error: unknown): Promise<GaslessOperationRecord> {
    const reason = gaslessReason(error, "gasless_guard_unavailable");
    if (op.bootstrap.signingAttempts === 0 && op.userOperation.signingAttempts === 0) {
      return await this.save(op, { state: "failed_before_effect", failure: reason });
    }
    return await this.unknown(op, reason);
  }
  private async unknown(op: GaslessOperationRecord, reason: string): Promise<GaslessOperationRecord> {
    return await this.save(op, { state: "unknown_finality", failure: reason });
  }
}
