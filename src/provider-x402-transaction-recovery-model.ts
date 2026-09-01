import { canonicalJson, exactKeys, hashObject } from "./canonical.js";
import { ApnError } from "./errors.js";

export interface ProviderX402TransactionRecoveryBinding {
  readonly schemaVersion: "apn.provider-x402.transaction-recovery.v1";
  readonly operationId: string;
  readonly chainId: "8453";
  readonly transactionHash: `0x${string}`;
  readonly evidenceMode: "exact_transaction";
  readonly idempotencyDigest: string;
  readonly materialDigest: string;
  readonly stage: "bound" | "evidence_validated";
  readonly evidenceDigest?: string;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly integrityHash: string;
}

export function validateProviderX402TransactionRecoveryBinding(
  binding: ProviderX402TransactionRecoveryBinding,
  operationId: string,
): void {
  const { integrityHash: _integrityHash, ...base } = binding;
  if (
    !exactKeys(binding as unknown as Record<string, unknown>, [
      "schemaVersion", "operationId", "chainId", "transactionHash", "evidenceMode",
      "idempotencyDigest", "materialDigest", "stage",
      ...(binding.evidenceDigest === undefined ? [] : ["evidenceDigest"]),
      "createdAt", "updatedAt", "integrityHash",
    ]) || binding.schemaVersion !== "apn.provider-x402.transaction-recovery.v1" ||
    binding.operationId !== operationId || binding.chainId !== "8453" || binding.evidenceMode !== "exact_transaction" ||
    !/^0x[0-9a-f]{64}$/u.test(binding.transactionHash) || /^0x0{64}$/u.test(binding.transactionHash) ||
    !hash(binding.idempotencyDigest) || !hash(binding.materialDigest) || binding.integrityHash !== hashObject(base) ||
    !canonicalUtc(binding.createdAt) || !canonicalUtc(binding.updatedAt) ||
    Date.parse(binding.updatedAt) < Date.parse(binding.createdAt) ||
    !(["bound", "evidence_validated"] as const).includes(binding.stage) ||
    (binding.stage === "bound" ? binding.evidenceDigest !== undefined : !hash(binding.evidenceDigest))
  ) corrupt();
}

export function validateProviderX402TransactionRecoveryContinuity(
  previous: ProviderX402TransactionRecoveryBinding | undefined,
  next: ProviderX402TransactionRecoveryBinding | undefined,
): void {
  if (previous === undefined) return;
  if (next === undefined) corrupt();
  for (const key of [
    "schemaVersion", "operationId", "chainId", "transactionHash", "evidenceMode",
    "idempotencyDigest", "materialDigest", "createdAt",
  ] as const) if (canonicalJson(previous[key]) !== canonicalJson(next[key])) corrupt();
  if (previous.stage === "evidence_validated") {
    if (canonicalJson(previous) !== canonicalJson(next)) corrupt();
    return;
  }
  if (Date.parse(next.updatedAt) < Date.parse(previous.updatedAt)) corrupt();
  if (!(["bound", "evidence_validated"] as const).includes(next.stage)) corrupt();
  if (next.stage === "bound" && canonicalJson(previous) !== canonicalJson(next)) corrupt();
}

function hash(value: unknown): value is string { return typeof value === "string" && /^[a-f0-9]{64}$/u.test(value); }
function canonicalUtc(value: unknown): value is string {
  return typeof value === "string" && Number.isFinite(Date.parse(value)) && new Date(Date.parse(value)).toISOString() === value;
}
function corrupt(): never {
  throw new ApnError("APN_STATE_CORRUPT", "Provider x402 transaction recovery binding validation failed.");
}
