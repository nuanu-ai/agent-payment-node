import { exactKeys, hashObject, isPlainRecord } from "./canonical.js";
import { ApnError } from "./errors.js";
import { validateDirectAllowlistBinding, type DirectAllowlistBinding } from "./direct-allowlist-gate.js";
import { SecureStateStore } from "./secure-state-store.js";

export interface RailPrepareClaim {
  readonly schemaVersion: "apn.rail-prepare-claim.v1";
  readonly profileHash: string;
  readonly operationId: string;
  readonly idempotencyHash: string;
  readonly inputHash: string;
  readonly requestHash: string;
  readonly accountIdentityHash: string;
  readonly policyHash: string;
  readonly allowlist: DirectAllowlistBinding;
  readonly integrityHash: string;
}
const CLAIM_HASH = /^[a-f0-9]{64}$/u;
export function sealPrepareClaim(body: Omit<RailPrepareClaim, "integrityHash">): RailPrepareClaim {
  return validatePrepareClaim({ ...body, integrityHash: hashObject(body) });
}
function validatePrepareClaim(value: unknown): RailPrepareClaim {
  if (!isPlainRecord(value) || !exactKeys(value, ["schemaVersion", "profileHash", "operationId", "idempotencyHash",
    "inputHash", "requestHash", "accountIdentityHash", "policyHash", "allowlist", "integrityHash"]) ||
    value.schemaVersion !== "apn.rail-prepare-claim.v1") corrupt();
  for (const key of ["profileHash", "operationId", "idempotencyHash", "inputHash", "requestHash", "accountIdentityHash", "policyHash", "integrityHash"]) {
    if (typeof value[key] !== "string" || !CLAIM_HASH.test(value[key])) corrupt();
  }
  validateDirectAllowlistBinding(value.allowlist);
  const { integrityHash, ...body } = value;
  if (hashObject(body) !== integrityHash) corrupt();
  return value as unknown as RailPrepareClaim;
}
export class RailPrepareClaimStore extends SecureStateStore {
  private initialized: Promise<void> | undefined;
  private async ready(): Promise<void> {
    this.initialized ??= (async () => { await super.initialize(); await this.ensureDirectory("rail-prepare-claims"); })();
    await this.initialized;
  }
  private path(idempotencyHash: string): string {
    if (!CLAIM_HASH.test(idempotencyHash)) corrupt();
    return `rail-prepare-claims/${idempotencyHash}.json`;
  }
  async load(idempotencyHash: string): Promise<RailPrepareClaim | null> {
    await this.ready();
    const value = await this.readJson(this.path(idempotencyHash));
    if (value === null) return null;
    const claim = validatePrepareClaim(value);
    if (claim.idempotencyHash !== idempotencyHash) corrupt();
    return claim;
  }
  async create(claim: RailPrepareClaim): Promise<void> {
    validatePrepareClaim(claim);
    await this.ready();
    await this.writeJson(this.path(claim.idempotencyHash), claim, true);
  }
  async remove(idempotencyHash: string): Promise<void> {
    await this.ready();
    await this.removeFile(this.path(idempotencyHash));
  }
  async removeIfMatches(claim: RailPrepareClaim): Promise<void> {
    if ((await this.load(claim.idempotencyHash))?.integrityHash === claim.integrityHash) await this.remove(claim.idempotencyHash);
  }
}

export interface RailApprovalClaim {
  readonly schemaVersion: "apn.rail-approval-claim.v1";
  readonly profileHash: string;
  readonly operationId: string;
  readonly operationIntegrityHash: string;
  readonly fingerprint: string;
  readonly accountIdentityHash: string;
  readonly policyHash: string;
  readonly allowlist: DirectAllowlistBinding;
  readonly integrityHash: string;
}
export function sealApprovalClaim(body: Omit<RailApprovalClaim, "integrityHash">): RailApprovalClaim {
  return validateApprovalClaim({ ...body, integrityHash: hashObject(body) });
}
function validateApprovalClaim(value: unknown): RailApprovalClaim {
  if (!isPlainRecord(value) || !exactKeys(value, ["schemaVersion", "profileHash", "operationId", "operationIntegrityHash",
    "fingerprint", "accountIdentityHash", "policyHash", "allowlist", "integrityHash"]) ||
    value.schemaVersion !== "apn.rail-approval-claim.v1") corrupt();
  for (const key of ["profileHash", "operationId", "operationIntegrityHash", "fingerprint", "accountIdentityHash", "policyHash", "integrityHash"]) {
    if (typeof value[key] !== "string" || !CLAIM_HASH.test(value[key])) corrupt();
  }
  validateDirectAllowlistBinding(value.allowlist);
  const { integrityHash, ...body } = value;
  if (hashObject(body) !== integrityHash) corrupt();
  return value as unknown as RailApprovalClaim;
}
export class RailApprovalClaimStore extends SecureStateStore {
  private initialized: Promise<void> | undefined;
  private async ready(): Promise<void> {
    this.initialized ??= (async () => { await super.initialize(); await this.ensureDirectory("rail-approval-claims"); })();
    await this.initialized;
  }
  private path(operationId: string): string {
    if (!CLAIM_HASH.test(operationId)) corrupt();
    return `rail-approval-claims/${operationId}.json`;
  }
  async load(operationId: string): Promise<RailApprovalClaim | null> {
    await this.ready();
    const value = await this.readJson(this.path(operationId));
    if (value === null) return null;
    const claim = validateApprovalClaim(value);
    if (claim.operationId !== operationId) corrupt();
    return claim;
  }
  async create(claim: RailApprovalClaim): Promise<void> {
    validateApprovalClaim(claim);
    await this.ready();
    await this.writeJson(this.path(claim.operationId), claim, true);
  }
  async removeIfMatches(claim: RailApprovalClaim): Promise<void> {
    if ((await this.load(claim.operationId))?.integrityHash === claim.integrityHash) await this.removeFile(this.path(claim.operationId));
  }
}

function corrupt(): never { throw new ApnError("APN_STATE_CORRUPT", "The direct-rail effect or operation binding is invalid."); }
