import { canonicalJson, domainHash, exactKeys, isPlainRecord } from "../../canonical.js";
import { ApnError } from "../../errors.js";
import { SecureStateStore, stateIdentifier } from "../../secure-state-store.js";
import { validateSwapOperation, type SwapOperationRecord } from "../model.js";
import type { SunSwapPreparedMaterial } from "./prepared.js";

const BINDING_VERSION = "apn.sunswap-tron.execution-binding.v1" as const;
const HASH = /^[a-f0-9]{64}$/u;

/** Fresh head evidence taken by the pre-send guard, immediately before the submission marker. */
export interface SunSwapExecutionFreshness {
  readonly headBlockNumber: string;
  readonly headBlockId: string;
  readonly headTimestampMs: string;
  readonly simulatedOutputAtomic: string;
  readonly simulatedEnergy: string;
  readonly balanceSun: string;
  readonly checkedAt: string;
}

export interface SunSwapTronExecutionBinding extends SunSwapExecutionFreshness {
  readonly schemaVersion: typeof BINDING_VERSION;
  readonly operationId: string;
  readonly operationIntegrityHash: string;
  readonly profileHash: string;
  readonly account: string;
  readonly accountIdentityHash: string;
  readonly ownerAdmissionHash: string;
  readonly effectFingerprint: string;
  readonly txID: string;
  readonly unsignedTransactionPayloadHash: string;
  readonly feeLimitSun: string;
  readonly maximumTrxDebitSun: string;
  readonly expirationMs: string;
  readonly quoteHash: string;
  readonly policyDigest: string;
  readonly mechanismDigest: string;
  readonly protocolRegistryDigest: string;
  readonly approvalArtifactHash: string;
  readonly submissionMarkerHash: string;
  readonly bindingHash: string;
}

export function createSunSwapTronExecutionBinding(input: { readonly operation: SwapOperationRecord; readonly material: SunSwapPreparedMaterial;
  readonly freshness: SunSwapExecutionFreshness; readonly accountIdentityHash: string; readonly ownerAdmissionHash: string;
  readonly effectFingerprint: string; readonly approvalArtifactHash: string }): SunSwapTronExecutionBinding {
  const operation = validateSwapOperation(input.operation), marker = operation.submissionMarker;
  if (operation.state !== "submitting" || marker === null) blocked("SunSwap execution requires a durable submission marker.", "sunswap_marker_missing");
  const { freshness, material } = input;
  const body = { schemaVersion: BINDING_VERSION, operationId: operation.operationId, operationIntegrityHash: marker.operationIntegrityHash,
    profileHash: operation.ownerProfileHash, account: operation.quote.account, accountIdentityHash: input.accountIdentityHash,
    ownerAdmissionHash: input.ownerAdmissionHash, effectFingerprint: input.effectFingerprint, txID: material.execution.transaction.txID,
    unsignedTransactionPayloadHash: operation.quote.unsignedTransactionPayloadHash, feeLimitSun: material.execution.intent.feeLimitSun,
    maximumTrxDebitSun: material.gasOrEnergy.maximumTrxDebitSun ?? "", expirationMs: material.execution.intent.expirationMs,
    headBlockNumber: freshness.headBlockNumber, headBlockId: freshness.headBlockId, headTimestampMs: freshness.headTimestampMs,
    simulatedOutputAtomic: freshness.simulatedOutputAtomic, simulatedEnergy: freshness.simulatedEnergy, balanceSun: freshness.balanceSun,
    checkedAt: freshness.checkedAt, quoteHash: operation.quote.quoteHash, policyDigest: operation.policyDigest,
    mechanismDigest: operation.mechanismDigest, protocolRegistryDigest: operation.protocolRegistryDigest,
    approvalArtifactHash: input.approvalArtifactHash, submissionMarkerHash: marker.markerHash } as const;
  return validateSunSwapTronExecutionBinding({ ...body, bindingHash: domainHash(BINDING_VERSION, canonicalJson(body)) }, operation, material);
}

export function validateSunSwapTronExecutionBinding(value: unknown, operationValue: SwapOperationRecord,
  material: SunSwapPreparedMaterial): SunSwapTronExecutionBinding {
  const operation = validateSwapOperation(operationValue), marker = operation.submissionMarker;
  if (!isPlainRecord(value) || !exactKeys(value, ["schemaVersion", "operationId", "operationIntegrityHash", "profileHash", "account",
    "accountIdentityHash", "ownerAdmissionHash", "effectFingerprint", "txID", "unsignedTransactionPayloadHash", "feeLimitSun",
    "maximumTrxDebitSun", "expirationMs", "headBlockNumber", "headBlockId", "headTimestampMs", "simulatedOutputAtomic", "simulatedEnergy",
    "balanceSun", "checkedAt", "quoteHash", "policyDigest", "mechanismDigest", "protocolRegistryDigest", "approvalArtifactHash",
    "submissionMarkerHash", "bindingHash"]) || value.schemaVersion !== BINDING_VERSION || marker === null) corrupt();
  const binding = value as unknown as SunSwapTronExecutionBinding, { bindingHash, ...body } = binding;
  const decimal = (item: unknown) => typeof item === "string" && /^(?:0|[1-9][0-9]{0,30})$/u.test(item);
  if (bindingHash !== domainHash(BINDING_VERSION, canonicalJson(body)) || binding.operationId !== operation.operationId ||
      binding.operationIntegrityHash !== marker.operationIntegrityHash || binding.profileHash !== operation.ownerProfileHash ||
      binding.account !== operation.quote.account || binding.txID !== material.execution.transaction.txID ||
      binding.unsignedTransactionPayloadHash !== operation.quote.unsignedTransactionPayloadHash ||
      binding.feeLimitSun !== material.execution.intent.feeLimitSun || binding.maximumTrxDebitSun !== material.gasOrEnergy.maximumTrxDebitSun ||
      binding.expirationMs !== material.execution.intent.expirationMs || binding.quoteHash !== operation.quote.quoteHash ||
      binding.policyDigest !== operation.policyDigest || binding.mechanismDigest !== operation.mechanismDigest ||
      binding.protocolRegistryDigest !== operation.protocolRegistryDigest || binding.submissionMarkerHash !== marker.markerHash ||
      [binding.accountIdentityHash, binding.ownerAdmissionHash, binding.effectFingerprint, binding.txID, binding.approvalArtifactHash,
        binding.headBlockId].some((item) => typeof item !== "string" || !HASH.test(item)) ||
      ![binding.headBlockNumber, binding.headTimestampMs, binding.simulatedOutputAtomic, binding.simulatedEnergy, binding.balanceSun].every(decimal) ||
      BigInt(binding.simulatedOutputAtomic) < BigInt(operation.quote.minimumOutputAtomic) ||
      BigInt(binding.headTimestampMs) >= BigInt(binding.expirationMs) || !canonicalInstant(binding.checkedAt) ||
      binding.checkedAt !== marker.markedAt || binding.checkedAt >= operation.quote.expiresAt) corrupt();
  return binding;
}

/**
 * Durable execution binding, written after the submission marker and before signing. It holds no secret: signed bytes
 * stay in the encrypted chain wallet, and resume only observes the exact transaction id.
 */
export class SunSwapExecutionBindingStore extends SecureStateStore {
  private initialized: Promise<void> | undefined;

  async save(operation: SwapOperationRecord, material: SunSwapPreparedMaterial, value: SunSwapTronExecutionBinding): Promise<SunSwapTronExecutionBinding> {
    const binding = validateSunSwapTronExecutionBinding(value, operation, material); await this.ready();
    return await this.withLocks([`sunswap-binding:${operation.operationId}`], async () => {
      const existing = await this.readJson(this.path(operation));
      if (existing !== null) {
        const prior = validateSunSwapTronExecutionBinding(existing, operation, material);
        if (canonicalJson(prior) !== canonicalJson(binding)) throw new ApnError("APN_STATE_CORRUPT", "A different SunSwap execution binding already exists.");
        return prior;
      }
      await this.ensureDirectory(`sunswap-execution-bindings/${operation.ownerProfileHash}`);
      await this.writeJson(this.path(operation), binding, true);
      return binding;
    });
  }

  async load(operation: SwapOperationRecord, material: SunSwapPreparedMaterial): Promise<SunSwapTronExecutionBinding | null> {
    await this.ready();
    const value = await this.readJson(this.path(operation));
    return value === null ? null : validateSunSwapTronExecutionBinding(value, operation, material);
  }

  private path(operation: SwapOperationRecord): string {
    stateIdentifier(operation.ownerProfileHash, "SunSwap binding profile"); stateIdentifier(operation.operationId, "SunSwap binding operation");
    return `sunswap-execution-bindings/${operation.ownerProfileHash}/${operation.operationId}.json`;
  }
  private async ready(): Promise<void> {
    this.initialized ??= (async () => { await super.initialize(); await this.ensureDirectory("sunswap-execution-bindings"); })();
    await this.initialized;
  }
}

function canonicalInstant(value: unknown): value is string { return typeof value === "string" && Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value; }
function corrupt(): never { throw new ApnError("APN_STATE_CORRUPT", "SunSwap execution binding integrity failed."); }
function blocked(message: string, reason: string): never { throw new ApnError("APN_OPERATION_BLOCKED", message, { reason }); }
