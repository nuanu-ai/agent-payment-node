import { ApnError } from "./errors.js";
import { metaMaskNativeMfaTask, metaMaskNativeRequestIdHash, metaMaskNativeRequestReference,
  metaMaskNativeSealedMfaTask, type MetaMaskNativeMfaTask, type MetaMaskNativeOperation,
  type patchMetaMaskNativeOperation } from "./metamask-native-journal.js";
import type { MetaMaskNativeMfaEvidence, MetaMaskNativeReadObservation, MetaMaskNativeSubmission } from "./metamask-native-transfer-adapter.js";
import type { ProviderRequestReferencePort } from "./provider-request-reference-store.js";

/**
 * The MetaMask request id of a native transfer (the request the owner's MFA approval waits on). A record 0.5.106 or
 * earlier wrote keeps the id itself and is read, observed and projected as it always was. 0.5.107 sealed the id the
 * hand-off returned; 0.5.108 and later name the id themselves and seal it before the hand-off. Both seal it under the
 * Keychain wrapping secret (provider-request-reference-store.ts) and keep only its hash (`providerRequestIdHash`); the
 * id is opened only to send the request once and to read it again, and output shows only the hash.
 */
type StoredRequest = Pick<MetaMaskNativeOperation, "operationId" | "context" | "providerRequestId" | "providerRequestIdHash">;

/** Seals APN's request id for `op` and returns the hash its effect marker keeps in its place; the caller holds the lock. */
export async function sealMetaMaskNativeRequest(references: ProviderRequestReferencePort, op: Pick<MetaMaskNativeOperation, "operationId" | "context">,
  requestId: string): Promise<string> {
  const requestIdHash = metaMaskNativeRequestIdHash(requestId);
  await references.seal(metaMaskNativeRequestReference(op, requestIdHash), requestId);
  return requestIdHash;
}

/**
 * The journal fields the hand-off's result writes: its state, transaction hash and diagnostic as returned, and the
 * owner's MFA task named by `requestIdHash`, the hash the effect marker already keeps (it stays as written).
 */
export function metaMaskNativeHandoffFields(result: MetaMaskNativeSubmission,
  requestIdHash: string): Parameters<typeof patchMetaMaskNativeOperation>[1] {
  const diagnostic = result.diagnostic === undefined ? {} : { diagnostic: result.diagnostic };
  if (result.disposition === "acknowledged") return { ...diagnostic, state: "acknowledged", transactionHash: result.transactionHash };
  // A pending or unknown hand-off stays financially UNKNOWN; an owner approval the provider waits on is kept beside it.
  const mfa = result.mfa !== undefined && result.transactionHash === undefined
    ? { mfaTask: metaMaskNativeSealedMfaTask(requestIdHash, result.mfa, "send") } : {};
  return { ...diagnostic, state: "unknown", transactionHash: result.transactionHash ?? null, ...mfa };
}

/**
 * The stored request id of `op`: kept in the record, or opened from its seal. A seal that cannot be opened (missing,
 * damaged, another transfer's, another secret, a refused Keychain) throws its own precise refusal before any read.
 */
export async function openMetaMaskNativeRequest(references: ProviderRequestReferencePort | undefined, op: StoredRequest): Promise<string> {
  if (op.providerRequestId !== null) return op.providerRequestId;
  if (op.providerRequestIdHash === undefined) throw new ApnError("APN_STATE_CORRUPT", "Native transfer stores no provider request to read.");
  if (references === undefined) throw new ApnError("APN_INTERNAL", "The sealed provider request reference store is unavailable.");
  return await references.open(metaMaskNativeRequestReference(op, op.providerRequestIdHash));
}

/** The owner's MFA task for the stored request, naming it as the record does: by the id, or by the hash of a sealed id. */
export function metaMaskNativeRequestTask(op: Pick<MetaMaskNativeOperation, "providerRequestId" | "providerRequestIdHash">,
  evidence: MetaMaskNativeMfaEvidence, source: MetaMaskNativeMfaTask["source"]): MetaMaskNativeMfaTask {
  if (op.providerRequestIdHash !== undefined) return metaMaskNativeSealedMfaTask(op.providerRequestIdHash, evidence, source);
  if (op.providerRequestId === null) throw new ApnError("APN_STATE_CORRUPT", "Native transfer stores no provider request for an MFA task.");
  return metaMaskNativeMfaTask(op.providerRequestId, evidence, source);
}

/** A read observation as output shows it: `request_id_hash`, the record's own hash, in place of a sealed id. */
export type MetaMaskNativePublicReadObservation = MetaMaskNativeReadObservation |
  (Omit<MetaMaskNativeReadObservation, "request_id"> & { readonly request_id_hash: string });

export function publicMetaMaskNativeReadObservation(observation: MetaMaskNativeReadObservation,
  op: Pick<MetaMaskNativeOperation, "providerRequestIdHash">): MetaMaskNativePublicReadObservation {
  const hash = op.providerRequestIdHash;
  if (hash === undefined) return observation;
  return Object.freeze(Object.fromEntries(Object.entries(observation).map(([key, value]) =>
    key === "request_id" ? ["request_id_hash", hash] : [key, value]))) as unknown as MetaMaskNativePublicReadObservation;
}
