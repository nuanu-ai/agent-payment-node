import { canonicalJson, domainHash } from "../../canonical.js";
import { ApnError } from "../../errors.js";
import type { ClockPort } from "../../ports.js";
import { validateSwapOperation, type SwapOperationRecord } from "../model.js";
import { requireSwapProtocol, validateSwapProtocolRegistry, type SwapProtocolRegistry } from "../protocol-registry.js";
import type { GuardedSwapExecutionDriver, GuardedSwapExecutionInput, GuardedSwapObservationInput } from "../runtime.js";
import type { GuardedSwapService } from "../service.js";
import type { SunSwapLocalOwnerAdmission } from "./admission.js";
import { createSunSwapTronExecutionBinding, type SunSwapExecutionBindingStore, type SunSwapTronExecutionBinding } from "./execution-binding.js";
import type { SunSwapExecutionGuard } from "./guard.js";
import type { SunSwapOutcomeObserver } from "./outcome.js";
import { validateSunSwapPreparedMaterial, type SunSwapPreparedMaterial } from "./prepared.js";
import { validateSunSwapExecutionBinding, type SunSwapExecutionBinding } from "./signer.js";

/** Per-operation signer and single sender over the encrypted local TRON wallet (SunSwapProtectedExecutionAdapter). */
export interface SunSwapSigningPort {
  sign(operation: SwapOperationRecord, binding: SunSwapExecutionBinding): Promise<{ readonly signedMaterialHandle: string }>;
  sendOnce(operation: SwapOperationRecord, binding: SunSwapExecutionBinding, handle: string): Promise<{ readonly transactionHash: string }>;
}
export interface SunSwapTronExecutionDriverDependencies {
  readonly core: GuardedSwapService;
  readonly protocolRegistry: SwapProtocolRegistry;
  readonly admission: Pick<SunSwapLocalOwnerAdmission, "assert">;
  readonly guard: Pick<SunSwapExecutionGuard, "inspect">;
  readonly bindings: Pick<SunSwapExecutionBindingStore, "save" | "load">;
  readonly signing: SunSwapSigningPort;
  readonly observer: Pick<SunSwapOutcomeObserver, "observeOutcome">;
  readonly clock: ClockPort;
}

/**
 * GuardedSwapExecutionDriver for the approved SunSwap reservation. Before the marker every refusal releases the
 * reservation with a bound proof. The marker, then the execution binding, are durable before signing; the sender
 * broadcasts once; every later outcome, and every status call, only observes the exact transaction id.
 */
export class SunSwapTronExecutionDriver implements GuardedSwapExecutionDriver {
  constructor(private readonly d: SunSwapTronExecutionDriverDependencies) {}

  async execute(input: GuardedSwapExecutionInput): Promise<SwapOperationRecord> {
    let operation = validateSwapOperation(input.operation);
    if (operation.state !== "reserved" || operation.submissionMarker !== null) blocked("SunSwap execution requires the exact approved reservation.", "sunswap_execution_state");
    let material: SunSwapPreparedMaterial, effect: SunSwapExecutionBinding, binding: SunSwapTronExecutionBinding;
    try {
      material = validateSunSwapPreparedMaterial(input.material, "stored");
      assertInjectedProtocol(operation, this.d.protocolRegistry);
      const admission = await this.d.admission.assert(operation);
      effect = { account: admission.account, intent: material.execution.intent, transaction: material.execution.transaction,
        simulation: material.execution.simulation };
      const effectFingerprint = validateSunSwapExecutionBinding(operation, effect);
      const freshness = await this.d.guard.inspect(operation, material), checked = this.d.clock.now();
      if (!signingWindowLive(material, checked) || checked.toISOString() < freshness.checkedAt ||
          checked.getTime() - Date.parse(freshness.checkedAt) > 30_000) {
        blocked("The frozen SunSwap signing window or pre-send freshness is no longer live.", "sunswap_deadline_expired");
      }
      // The marker instant is the freshness instant, so the binding proves its checks were taken at the boundary.
      operation = await this.d.core.markSubmitting(operation, new Date(freshness.checkedAt));
      binding = createSunSwapTronExecutionBinding({ operation, material, freshness, accountIdentityHash: admission.account.identityHash,
        ownerAdmissionHash: admission.admissionHash, effectFingerprint, approvalArtifactHash: input.approval.artifactHash });
    } catch (error) {
      if (operation.submissionMarker === null) await this.releaseUnsent(operation, error);
      else return await this.d.core.recordPossibleSend(operation, "unknown_finality", this.d.clock.now());
      throw error;
    }
    try { await this.d.bindings.save(operation, material, binding); }
    catch { return await this.d.core.recordPossibleSend(operation, "unknown_finality", this.d.clock.now()); }
    let handle: string;
    try { handle = (await this.d.signing.sign(operation, effect)).signedMaterialHandle; }
    catch { return await this.d.core.recordPossibleSend(operation, "unknown_finality", this.d.clock.now()); }
    let accepted = false;
    try { accepted = (await this.d.signing.sendOnce(operation, effect, handle)).transactionHash === binding.txID; } catch { accepted = false; }
    operation = await this.d.core.recordPossibleSend(operation, accepted ? "submitted" : "unknown_finality", this.d.clock.now());
    return await this.observeExact(operation, material);
  }

  async observe(input: GuardedSwapObservationInput): Promise<SwapOperationRecord> {
    let operation = validateSwapOperation(input.operation);
    if (operation.submissionMarker === null) blocked("SunSwap observation is available only after the submission marker.", "sunswap_resume_before_marker");
    const material = validateSunSwapPreparedMaterial(input.material, "stored");
    if (["finalized", "failed_confirmed_revert"].includes(operation.state)) return operation;
    const binding = await this.d.bindings.load(operation, material);
    // A marker without a completed send attempt is never resumed into signing: the outcome is unknown and only observed.
    if (operation.state === "submitting") operation = await this.d.core.recordPossibleSend(operation, "unknown_finality", this.d.clock.now());
    return binding === null ? operation : await this.observeExact(operation, material);
  }

  private async observeExact(operation: SwapOperationRecord, material: SunSwapPreparedMaterial): Promise<SwapOperationRecord> {
    let outcome: Awaited<ReturnType<SunSwapOutcomeObserver["observeOutcome"]>>;
    try { outcome = await this.d.observer.observeOutcome(operation, material); }
    catch { return operation; }
    if (outcome === null || (operation.state !== "submitted" && operation.state !== "unknown_finality")) return operation;
    return outcome.outcome === "succeeded" ? await this.d.core.finalize(operation, this.d.clock.now(), outcome.proof)
      : await this.d.core.failConfirmedRevert(operation, this.d.clock.now(), outcome.proof);
  }

  private async releaseUnsent(operation: SwapOperationRecord, error: unknown): Promise<void> {
    const reason = error instanceof ApnError ? `${error.code}:${String(error.details?.reason ?? "")}` : "guard_unavailable";
    const proof = domainHash("apn.sunswap-unsent-refusal.v1", canonicalJson({ operationId: operation.operationId,
      integrityHash: operation.integrityHash, reason }));
    try { await this.d.core.failBeforeEffect(operation, this.d.clock.now(), proof); }
    catch { /* A persisted marker or concurrent change keeps the reservation; resume only observes. */ }
  }
}

function assertInjectedProtocol(operation: SwapOperationRecord, registryValue: SwapProtocolRegistry): void {
  const registry = validateSwapProtocolRegistry(registryValue);
  if (registry.registryDigest !== operation.protocolRegistryDigest || registry.registryVersion !== operation.protocolRegistryVersion) {
    blocked("Injected SunSwap protocol registry does not match the prepared operation.", "sunswap_protocol_registry_drift");
  }
  requireSwapProtocol(registry, operation.mechanismDigest);
}
function signingWindowLive(material: SunSwapPreparedMaterial, now: Date): boolean {
  if (!(now instanceof Date) || !Number.isFinite(now.getTime())) throw new ApnError("APN_INVALID_INPUT", "SunSwap execution time is invalid.");
  const at = BigInt(now.getTime()), intent = material.execution.intent;
  return BigInt(intent.timestampMs) <= at && at < BigInt(intent.expirationMs) && at < BigInt(intent.deadlineSeconds) * 1_000n;
}
function blocked(message: string, reason: string): never { throw new ApnError("APN_OPERATION_BLOCKED", message, { reason }); }
