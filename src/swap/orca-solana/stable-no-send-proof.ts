import { canonicalJson, domainHash } from "../../canonical.js";
import type { ChainAccount } from "../../direct-rail-ports.js";
import { ApnError } from "../../errors.js";
import { SecureStateStore, stateIdentifier } from "../../secure-state-store.js";
import type { SwapOperationRecord } from "../model.js";
import type { OrcaStableMaterial } from "./stable-material.js";
import type { OrcaStableExecutionBinding } from "./stable-execution-journal.js";

const VERSION = "apn.orca-stable-no-send-proof.v1" as const;
export interface OrcaStableNoSendProof {
  readonly schemaVersion: typeof VERSION;
  readonly operationId: string;
  readonly ownerProfileHash: string;
  readonly quoteHash: string;
  readonly markerHash: string;
  readonly markerOperationIntegrityHash: string;
  readonly materialDigest: string;
  readonly bindingHash: string | null;
  readonly custodyAccountIdentityHash: string;
  readonly reservationId: string;
  readonly reservedLeaseIntegrityHash: string;
  readonly proofHash: string;
}

/** The hash identifies the exact marker, material, custody identity and reserved principal lease. */
export function orcaStableNoSendProof(operation: SwapOperationRecord, material: OrcaStableMaterial,
  binding: OrcaStableExecutionBinding | null, account: ChainAccount): OrcaStableNoSendProof {
  if (operation.submissionMarker === null || operation.usageLease === null) corrupt();
  const body = { schemaVersion: VERSION, operationId: operation.operationId,
    ownerProfileHash: operation.ownerProfileHash, quoteHash: operation.quote.quoteHash,
    markerHash: operation.submissionMarker.markerHash,
    markerOperationIntegrityHash: operation.submissionMarker.operationIntegrityHash,
    materialDigest: material.materialDigest, bindingHash: binding?.bindingHash ?? null,
    custodyAccountIdentityHash: account.identityHash, reservationId: operation.usageLease.reservationId,
    reservedLeaseIntegrityHash: operation.usageLease.reservationDigest };
  return { ...body, proofHash: domainHash(VERSION, canonicalJson(body)) };
}

export class OrcaStableNoSendProofStore extends SecureStateStore {
  private initialized: Promise<void> | undefined;
  async save(expected: OrcaStableNoSendProof): Promise<OrcaStableNoSendProof> {
    validateOrcaStableNoSendProof(expected); await this.ready();
    return await this.withLocks([`orca-stable-no-send-proof:${expected.operationId}`], async () => {
      const path = this.path(expected);
      const existing = await this.readJson(path);
      if (existing !== null) {
        const previous = validateOrcaStableNoSendProof(existing);
        if (canonicalJson(previous) !== canonicalJson(expected)) corrupt();
        return previous;
      }
      await this.ensureDirectory(`orca-stable-no-send-proofs/${expected.ownerProfileHash}`);
      await this.writeJson(path, expected, true);
      return expected;
    });
  }
  async load(operation: SwapOperationRecord): Promise<OrcaStableNoSendProof | null> {
    await this.ready();
    const raw = await this.readJson(this.path(operation));
    return raw === null ? null : validateOrcaStableNoSendProof(raw);
  }
  private path(value: Pick<OrcaStableNoSendProof, "ownerProfileHash" | "operationId">): string {
    stateIdentifier(value.ownerProfileHash, "stable no-send owner");
    stateIdentifier(value.operationId, "stable no-send operation");
    return `orca-stable-no-send-proofs/${value.ownerProfileHash}/${value.operationId}.json`;
  }
  private async ready(): Promise<void> {
    this.initialized ??= (async () => { await super.initialize(); await this.ensureDirectory("orca-stable-no-send-proofs"); })();
    await this.initialized;
  }
}

export function validateOrcaStableNoSendProof(value: unknown): OrcaStableNoSendProof {
  if (typeof value !== "object" || value === null || Array.isArray(value)) corrupt();
  const proof = value as OrcaStableNoSendProof;
  const { proofHash, ...body } = proof;
  if (Object.keys(proof).length !== 12 || proof.schemaVersion !== VERSION ||
    ![proof.operationId, proof.ownerProfileHash, proof.quoteHash, proof.markerHash,
      proof.markerOperationIntegrityHash, proof.materialDigest, proof.custodyAccountIdentityHash,
      proof.reservationId, proof.reservedLeaseIntegrityHash, proof.proofHash]
      .every((item) => typeof item === "string" && /^[a-f0-9]{64}$/u.test(item)) ||
    (proof.bindingHash !== null && (typeof proof.bindingHash !== "string" || !/^[a-f0-9]{64}$/u.test(proof.bindingHash))) ||
      proofHash !== domainHash(VERSION, canonicalJson(body))) corrupt();
  return proof;
}
function corrupt(): never { throw new ApnError("APN_STATE_CORRUPT", "Stable no-send proof is invalid."); }
