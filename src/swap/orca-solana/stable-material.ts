import { canonicalJson, domainHash, sha256 } from "../../canonical.js";
import { ApnError } from "../../errors.js";
import { SecureStateStore, stateIdentifier } from "../../secure-state-store.js";
import { SOLANA_USDT } from "../../chain-policy.js";
import { validateSwapOperation, type SwapOperationRecord } from "../model.js";
import { validateSwapQuote } from "../quote.js";
import { preparedSwapOperationId, swapIdempotencyHash } from "../service.js";
import { ORCA_PROTOCOL_REGISTRY, ORCA_STABLE_GUARDED_MECHANISM_DIGEST } from "./stable-mechanism.js";
import { validateOrcaStableUnsigned, type OrcaStableUnsignedPreview } from "./stable-prepare.js";
import { ORCA_SOLANA_CHAIN, USDC_MINT, WHIRLPOOL_PROGRAM } from "./pins.js";
import { ORCA_STABLE_POOL } from "./stable-readonly.js";

export const ORCA_STABLE_MATERIAL_SCHEMA = "apn.orca-stable-guarded-material.v1" as const;
export interface OrcaStableMaterial {
  readonly schemaVersion: typeof ORCA_STABLE_MATERIAL_SCHEMA;
  readonly operationId: string;
  readonly idempotencyHash: string;
  readonly requestDigest: string;
  readonly quote: SwapOperationRecord["quote"];
  readonly policyRevision: number;
  /** Owner's original market impact cap. Older material without it cannot enter fresh execution. */
  readonly maximumPriceImpactBps?: number;
  readonly policyDigest: string;
  readonly activationDigest: string;
  readonly evidence: unknown;
  readonly preview: OrcaStableUnsignedPreview;
  readonly materialDigest: string;
}

export async function sealOrcaStableMaterial(input: Omit<OrcaStableMaterial, "schemaVersion" | "materialDigest">,
  idempotencyKey: string): Promise<OrcaStableMaterial> {
  const body = { schemaVersion: ORCA_STABLE_MATERIAL_SCHEMA, ...input };
  const material = await validateOrcaStableMaterial({ ...body, materialDigest: domainHash("apn.orca-stable-guarded-material.v1", canonicalJson(body)) });
  if (material.idempotencyHash !== swapIdempotencyHash(idempotencyKey) ||
      material.operationId !== preparedSwapOperationId(material.quote.profile, idempotencyKey)) corrupt();
  return material;
}

export async function validateOrcaStableMaterial(value: OrcaStableMaterial, operation?: SwapOperationRecord): Promise<OrcaStableMaterial> {
  const quote = validateSwapQuote(value.quote);
  if (value.schemaVersion !== ORCA_STABLE_MATERIAL_SCHEMA || !/^[a-f0-9]{64}$/u.test(value.operationId) ||
      !/^[a-f0-9]{64}$/u.test(value.idempotencyHash) || !/^[a-f0-9]{64}$/u.test(value.requestDigest) ||
      value.operationId !== domainHash("apn.swap-operation-id.v1", canonicalJson({ profileHash: quote.profileHash,
        idempotencyHash: value.idempotencyHash })) ||
      !/^[a-f0-9]{64}$/u.test(value.policyDigest) || value.policyRevision < 1 || !Number.isSafeInteger(value.policyRevision) ||
      (value.maximumPriceImpactBps !== undefined && (!Number.isSafeInteger(value.maximumPriceImpactBps) ||
        value.maximumPriceImpactBps < quote.slippageBps || value.maximumPriceImpactBps > 10_000)) ||
      !/^[a-f0-9]{64}$/u.test(value.activationDigest) ||
      quote.sourceAsset.chain !== ORCA_SOLANA_CHAIN || quote.destinationAsset.chain !== ORCA_SOLANA_CHAIN ||
      quote.sourceAsset.kind !== "token" || quote.sourceAsset.identifier !== USDC_MINT ||
      quote.destinationAsset.kind !== "token" || quote.destinationAsset.identifier !== SOLANA_USDT) corrupt();
  const preview = await validateOrcaStableUnsigned(value.preview);
  if (preview.owner !== quote.account || preview.owner !== quote.recipient ||
      preview.amountInAtomic !== quote.inputAmountAtomic || preview.minimumOutputAtomic !== quote.minimumOutputAtomic ||
      sha256(preview.unsignedPayload) !== quote.unsignedTransactionPayloadHash ||
      typeof value.evidence !== "object" || value.evidence === null) corrupt();
  const evidence = value.evidence as Record<string, unknown>;
  if (evidence.policyDigest !== value.policyDigest || evidence.policyRevision !== value.policyRevision ||
      evidence.activationDigest !== value.activationDigest || evidence.mechanismDigest !== ORCA_STABLE_GUARDED_MECHANISM_DIGEST ||
      evidence.messageHash !== preview.messageHash || evidence.unsignedPayloadHash !== sha256(preview.unsignedPayload) ||
      evidence.blockhash !== preview.blockhash || evidence.lastValidBlockHeight !== preview.lastValidBlockHeight ||
      quote.providerResponseHash !== domainHash("apn.orca-stable-candidate-evidence.v1", canonicalJson(value.evidence)) ||
      quote.routeHash !== domainHash("apn.orca-stable-candidate-route.v1", canonicalJson({ pool: ORCA_STABLE_POOL,
        program: WHIRLPOOL_PROGRAM, sourceAta: preview.sourceAta, destinationAta: preview.destinationAta,
        messageHash: preview.messageHash }))) corrupt();
  const { materialDigest: _digest, ...body } = value;
  if (value.materialDigest !== domainHash("apn.orca-stable-guarded-material.v1", canonicalJson(body))) corrupt();
  if (operation !== undefined) {
    const op = validateSwapOperation(operation);
    if (value.operationId !== op.operationId || value.idempotencyHash !== op.idempotencyHash ||
        quote.quoteHash !== op.quote.quoteHash || canonicalJson(quote) !== canonicalJson(op.quote) ||
        value.policyDigest !== op.policyDigest || op.mechanismDigest !== ORCA_STABLE_GUARDED_MECHANISM_DIGEST ||
        op.protocolRegistryDigest !== ORCA_PROTOCOL_REGISTRY.registryDigest ||
        !["quoted", "prepared", "awaiting_approval", "reserved", "submitting", "submitted", "unknown_finality",
          "finalized", "failed_confirmed_revert"].includes(op.state) ||
        (op.submissionMarker === null ? (op.state === "reserved" ? op.usageLease === null : op.usageLease !== null) :
          op.usageLease === null)) corrupt();
  }
  return value;
}

export class SavedOrcaStableMaterialStore extends SecureStateStore {
  private initialized: Promise<void> | undefined;
  async save(value: OrcaStableMaterial): Promise<OrcaStableMaterial> {
    const material = await validateOrcaStableMaterial(value); await this.ready();
    return await this.withLocks([`orca-stable:${material.operationId}`], async () => {
      const existing = await this.readJson(this.path(material.operationId));
      if (existing !== null) {
        const prior = await validateOrcaStableMaterial(existing as OrcaStableMaterial);
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
  async loadStaged(operationId: string): Promise<OrcaStableMaterial | null> {
    stateIdentifier(operationId, "stable operation id"); await this.ready();
    const value = await this.readJson(this.path(operationId));
    return value === null ? null : await validateOrcaStableMaterial(value as OrcaStableMaterial);
  }
  private path(operationId: string): string { return `orca-stable-material/${operationId}.json`; }
  private async ready(): Promise<void> { this.initialized ??= (async () => { await super.initialize(); await this.ensureDirectory("orca-stable-material"); })(); await this.initialized; }
}
function corrupt(): never { throw new ApnError("APN_STATE_CORRUPT", "Stored stable Orca material binding is invalid."); }
