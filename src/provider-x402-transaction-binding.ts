import { canonicalJson, exactKeys, hashObject, isPlainRecord } from "./canonical.js";
import { ApnError } from "./errors.js";

export interface ProviderX402TransactionReservation {
  readonly schemaVersion: "apn.provider-x402.transaction-reservation.v1";
  readonly chainId: "8453";
  readonly transactionHash: `0x${string}`;
  readonly operationId: string;
  readonly profileHash: string;
  readonly evidenceMode: "exact_transaction";
  readonly idempotencyDigest: string;
  readonly materialDigest: string;
  readonly createdAt: string;
  readonly integrityHash: string;
}

export interface ProviderX402TransactionReservationIndex {
  readonly schemaVersion: "apn.provider-x402.transaction-reservation-index.v1";
  readonly reservations: readonly ProviderX402TransactionReservation[];
  readonly integrityHash: string;
}

export function recoveryMaterialDigest(input: {
  readonly operationId: string;
  readonly transactionHash: `0x${string}`;
  readonly idempotencyDigest: string;
}): string {
  return hashObject({
    schemaVersion: "apn.provider-x402.recovery-material.v1",
    chainId: "8453",
    evidenceMode: "exact_transaction",
    ...input,
  });
}

export function sealTransactionReservation(
  value: Omit<ProviderX402TransactionReservation, "integrityHash">,
): ProviderX402TransactionReservation {
  return { ...value, integrityHash: hashObject(value) };
}

export function validateTransactionReservation(value: unknown): ProviderX402TransactionReservation {
  if (!isPlainRecord(value) || !exactKeys(value, [
    "schemaVersion", "chainId", "transactionHash", "operationId", "profileHash", "evidenceMode",
    "idempotencyDigest", "materialDigest", "createdAt", "integrityHash",
  ])) corrupt();
  const reservation = value as unknown as ProviderX402TransactionReservation;
  const { integrityHash: _integrityHash, ...base } = reservation;
  if (
    reservation.schemaVersion !== "apn.provider-x402.transaction-reservation.v1" ||
    reservation.chainId !== "8453" || reservation.evidenceMode !== "exact_transaction" ||
    !transactionHash(reservation.transactionHash) || !hash(reservation.operationId) ||
    !hash(reservation.profileHash) || !hash(reservation.idempotencyDigest) || !hash(reservation.materialDigest) ||
    reservation.materialDigest !== recoveryMaterialDigest({
      operationId: reservation.operationId,
      transactionHash: reservation.transactionHash,
      idempotencyDigest: reservation.idempotencyDigest,
    }) ||
    !canonicalUtc(reservation.createdAt) || reservation.integrityHash !== hashObject(base)
  ) corrupt();
  return reservation;
}

export function sameReservation(
  left: ProviderX402TransactionReservation,
  right: ProviderX402TransactionReservation,
): boolean {
  return canonicalJson(left) === canonicalJson(right);
}

export function sealTransactionReservationIndex(
  reservations: readonly ProviderX402TransactionReservation[],
): ProviderX402TransactionReservationIndex {
  const value = {
    schemaVersion: "apn.provider-x402.transaction-reservation-index.v1" as const,
    reservations: [...reservations].sort((left, right) => left.transactionHash.localeCompare(right.transactionHash)),
  };
  return { ...value, integrityHash: hashObject(value) };
}

export function validateTransactionReservationIndex(value: unknown): ProviderX402TransactionReservationIndex {
  if (!isPlainRecord(value) || !exactKeys(value, ["schemaVersion", "reservations", "integrityHash"]) ||
      value.schemaVersion !== "apn.provider-x402.transaction-reservation-index.v1" || !Array.isArray(value.reservations)) corrupt();
  const index = value as unknown as ProviderX402TransactionReservationIndex;
  const reservations = index.reservations.map(validateTransactionReservation);
  const canonical = sealTransactionReservationIndex(reservations);
  if (canonicalJson(canonical) !== canonicalJson(index)) corrupt();
  const transactions = new Set<string>();
  const idempotency = new Set<string>();
  for (const reservation of reservations) {
    if (transactions.has(reservation.transactionHash) || idempotency.has(reservation.idempotencyDigest)) corrupt();
    transactions.add(reservation.transactionHash);
    idempotency.add(reservation.idempotencyDigest);
  }
  return index;
}

function transactionHash(value: unknown): value is `0x${string}` {
  return typeof value === "string" && /^0x[0-9a-f]{64}$/u.test(value) && !/^0x0{64}$/u.test(value);
}
function hash(value: unknown): value is string { return typeof value === "string" && /^[a-f0-9]{64}$/u.test(value); }
function canonicalUtc(value: unknown): value is string {
  return typeof value === "string" && Number.isFinite(Date.parse(value)) && new Date(Date.parse(value)).toISOString() === value;
}
function corrupt(): never {
  throw new ApnError("APN_STATE_CORRUPT", "Provider x402 transaction reservation validation failed.");
}
