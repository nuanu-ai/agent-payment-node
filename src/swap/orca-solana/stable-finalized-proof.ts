import { canonicalJson, domainHash, exactKeys, isPlainRecord } from "../../canonical.js";
import { ApnError } from "../../errors.js";
import { SecureStateStore, stateIdentifier } from "../../secure-state-store.js";
import { validateSwapReceiptProof, type SwapOperationRecord, type SwapReceiptProof } from "../model.js";

const VERSION = "apn.orca-stable-finalized-observation.v1" as const;
export interface OrcaStableFinalizedObservation {
  readonly schemaVersion: typeof VERSION;
  readonly operationId: string;
  readonly ownerProfileHash: string;
  readonly markerHash: string;
  readonly materialDigest: string;
  readonly bindingHash: string;
  readonly claimHash: string;
  readonly accountIdentityHash: string;
  readonly reservationId: string;
  readonly reservedLeaseDigest: string;
  readonly outcome: "succeeded" | "reverted";
  readonly proof: SwapReceiptProof;
  readonly observationHash: string;
}

export function sealOrcaStableFinalizedObservation(operation: SwapOperationRecord, bindings: {
  materialDigest: string; bindingHash: string; claimHash: string; accountIdentityHash: string;
}, outcome: "succeeded" | "reverted", proof: SwapReceiptProof): OrcaStableFinalizedObservation {
  if (operation.submissionMarker === null || operation.usageLease === null) corrupt();
  const body = { schemaVersion: VERSION, operationId: operation.operationId,
    ownerProfileHash: operation.ownerProfileHash, markerHash: operation.submissionMarker.markerHash,
    ...bindings, reservationId: operation.usageLease.reservationId,
    reservedLeaseDigest: operation.usageLease.reservationDigest, outcome, proof };
  return validateOrcaStableFinalizedObservation({ ...body, observationHash: domainHash(VERSION, canonicalJson(body)) }, operation);
}

export function validateOrcaStableFinalizedObservation(value: unknown,
  operation: SwapOperationRecord): OrcaStableFinalizedObservation {
  if (!isPlainRecord(value) || !exactKeys(value, ["schemaVersion", "operationId", "ownerProfileHash",
    "markerHash", "materialDigest", "bindingHash", "claimHash", "accountIdentityHash",
    "reservationId", "reservedLeaseDigest", "outcome", "proof", "observationHash"])) corrupt();
  const result = value as unknown as OrcaStableFinalizedObservation;
  const { observationHash, ...body } = result;
  if (result.schemaVersion !== VERSION || result.operationId !== operation.operationId ||
      result.ownerProfileHash !== operation.ownerProfileHash ||
      result.markerHash !== operation.submissionMarker?.markerHash ||
      result.reservationId !== operation.usageLease?.reservationId ||
      ![result.materialDigest, result.bindingHash, result.claimHash, result.accountIdentityHash,
        result.reservedLeaseDigest, observationHash].every(item => typeof item === "string" && /^[a-f0-9]{64}$/u.test(item)) ||
      !["succeeded", "reverted"].includes(result.outcome) ||
      observationHash !== domainHash(VERSION, canonicalJson(body))) corrupt();
  if (!isPlainRecord(result.proof)) corrupt();
  try {
    const proof = validateSwapReceiptProof(result.proof, operation.quote.sourceAsset.chain,
      operation.submissionMarker!.markedAt, result.proof.observedAt, "stored");
    if (!proof.finalized) corrupt();
  } catch { corrupt(); }
  return result;
}

/** Occupancy is authoritative: a malformed or JSON-null file must never be treated as absent. */
export class OrcaStableFinalizedObservationStore extends SecureStateStore {
  private initialized: Promise<void> | undefined;
  async load(operation: SwapOperationRecord): Promise<OrcaStableFinalizedObservation | null> {
    await this.ready();
    const directory = `orca-stable-finalized-observations/${operation.ownerProfileHash}`;
    const name = `${operation.operationId}.json`;
    if (!(await this.readDirectory(directory)).some(entry => entry.name === name)) return null;
    return validateOrcaStableFinalizedObservation(await this.readJson(this.path(operation)), operation);
  }
  async save(operation: SwapOperationRecord, value: OrcaStableFinalizedObservation): Promise<OrcaStableFinalizedObservation> {
    validateOrcaStableFinalizedObservation(value, operation);
    await this.ready();
    const existing = await this.load(operation);
    if (existing !== null) {
      if (canonicalJson(existing) !== canonicalJson(value)) corrupt();
      return existing;
    }
    await this.ensureDirectory(`orca-stable-finalized-observations/${operation.ownerProfileHash}`);
    await this.writeJson(this.path(operation), value, true);
    return value;
  }
  private path(operation: SwapOperationRecord): string {
    stateIdentifier(operation.ownerProfileHash, "stable observation profile");
    stateIdentifier(operation.operationId, "stable observation operation");
    return `orca-stable-finalized-observations/${operation.ownerProfileHash}/${operation.operationId}.json`;
  }
  private async ready(): Promise<void> {
    this.initialized ??= (async () => { await super.initialize(); await this.ensureDirectory("orca-stable-finalized-observations"); })();
    await this.initialized;
  }
}
function corrupt(): never { throw new ApnError("APN_STATE_CORRUPT", "Stable finalized observation is invalid."); }
