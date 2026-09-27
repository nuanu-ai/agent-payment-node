import { canonicalJson, domainHash, sha256 } from "../../canonical.js";
import { ApnError } from "../../errors.js";
import { SecureStateStore, stateIdentifier } from "../../secure-state-store.js";
import { validateSwapOperation, type SwapOperationRecord } from "../model.js";
import { validateSwapQuote } from "../quote.js";
import { ORCA_PROTOCOL_REGISTRY, ORCA_STABLE_GUARDED_MECHANISM_DIGEST } from "./stable-mechanism.js";
import { validateOrcaStableUnsigned, type OrcaStableUnsignedPreview } from "./stable-prepare.js";

export const ORCA_STABLE_MATERIAL_SCHEMA = "apn.orca-stable-guarded-material.v1" as const;
export interface OrcaStableMaterial {
  readonly schemaVersion: typeof ORCA_STABLE_MATERIAL_SCHEMA;
  readonly operationId: string;
  readonly quote: SwapOperationRecord["quote"];
  readonly policyRevision: number;
  readonly policyDigest: string;
  readonly activationDigest: string;
  readonly evidence: unknown;
  readonly preview: OrcaStableUnsignedPreview;
  readonly materialDigest: string;
}

export async function sealOrcaStableMaterial(input: Omit<OrcaStableMaterial, "schemaVersion" | "materialDigest">,
  operation: SwapOperationRecord): Promise<OrcaStableMaterial> {
  const body = { schemaVersion: ORCA_STABLE_MATERIAL_SCHEMA, ...input };
  return await validateOrcaStableMaterial({ ...body, materialDigest: domainHash("apn.orca-stable-guarded-material.v1", canonicalJson(body)) }, operation);
}

export async function validateOrcaStableMaterial(value: OrcaStableMaterial, operation: SwapOperationRecord): Promise<OrcaStableMaterial> {
  const op = validateSwapOperation(operation), quote = validateSwapQuote(value.quote);
  if (value.schemaVersion !== ORCA_STABLE_MATERIAL_SCHEMA || value.operationId !== op.operationId ||
      quote.quoteHash !== op.quote.quoteHash || canonicalJson(quote) !== canonicalJson(op.quote) ||
      value.policyDigest !== op.policyDigest || value.policyRevision < 1 || !Number.isSafeInteger(value.policyRevision) ||
      !/^[a-f0-9]{64}$/u.test(value.activationDigest) ||
      op.mechanismDigest !== ORCA_STABLE_GUARDED_MECHANISM_DIGEST ||
      op.protocolRegistryDigest !== ORCA_PROTOCOL_REGISTRY.registryDigest || op.state !== "awaiting_approval" ||
      op.submissionMarker !== null || op.usageLease !== null) corrupt();
  const preview = await validateOrcaStableUnsigned(value.preview);
  if (preview.owner !== quote.account || preview.owner !== quote.recipient ||
      preview.amountInAtomic !== quote.inputAmountAtomic || preview.minimumOutputAtomic !== quote.minimumOutputAtomic ||
      sha256(preview.unsignedPayload) !== quote.unsignedTransactionPayloadHash ||
      typeof value.evidence !== "object" || value.evidence === null) corrupt();
  const evidence = value.evidence as Record<string, unknown>;
  if (evidence.policyDigest !== value.policyDigest || evidence.policyRevision !== value.policyRevision ||
      evidence.activationDigest !== value.activationDigest || evidence.mechanismDigest !== op.mechanismDigest ||
      evidence.messageHash !== preview.messageHash || evidence.unsignedPayloadHash !== sha256(preview.unsignedPayload) ||
      evidence.blockhash !== preview.blockhash || evidence.lastValidBlockHeight !== preview.lastValidBlockHeight ||
      quote.providerResponseHash !== domainHash("apn.orca-stable-candidate-evidence.v1", canonicalJson(value.evidence))) corrupt();
  const { materialDigest: _digest, ...body } = value;
  if (value.materialDigest !== domainHash("apn.orca-stable-guarded-material.v1", canonicalJson(body))) corrupt();
  return value;
}

export class SavedOrcaStableMaterialStore extends SecureStateStore {
  private initialized: Promise<void> | undefined;
  async save(value: OrcaStableMaterial, operation: SwapOperationRecord): Promise<OrcaStableMaterial> {
    const material = await validateOrcaStableMaterial(value, operation); await this.ready();
    return await this.withLocks([`orca-stable:${material.operationId}`], async () => {
      const existing = await this.readJson(this.path(material.operationId));
      if (existing !== null) {
        const prior = await validateOrcaStableMaterial(existing as OrcaStableMaterial, operation);
        if (canonicalJson(prior) !== canonicalJson(material)) corrupt();
        return prior;
      }
      await this.writeJson(this.path(material.operationId), material, true);
      return material;
    });
  }
  async load(operationId: string, operation: SwapOperationRecord): Promise<OrcaStableMaterial | null> {
    stateIdentifier(operationId, "stable operation id"); await this.ready();
    const value = await this.readJson(this.path(operationId));
    return value === null ? null : await validateOrcaStableMaterial(value as OrcaStableMaterial, operation);
  }
  private path(operationId: string): string { return `orca-stable-material/${operationId}.json`; }
  private async ready(): Promise<void> { this.initialized ??= (async () => { await super.initialize(); await this.ensureDirectory("orca-stable-material"); })(); await this.initialized; }
}
function corrupt(): never { throw new ApnError("APN_STATE_CORRUPT", "Stored stable Orca material binding is invalid."); }
