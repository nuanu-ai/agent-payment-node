import { ApnError } from "./errors.js";
import type { OperationRecord, PlainProviderEffectReference, ProviderDirectBinding, ProviderEffectReference,
  SealedProviderEffectReference } from "./model.js";
import type { ProviderAdapterBundle } from "./provider-ports.js";
import type { ProviderProfileRecord } from "./provider-profile.js";
import { providerRequestReferenceHash, type ProviderRequestReferenceBinding,
  type ProviderRequestReferencePort } from "./provider-request-reference-store.js";
import type { RuntimeContext } from "./runtime.js";

export type ProviderDirectRecoveryOutcome =
  | { readonly disposition: "unchanged" }
  | { readonly disposition: "acknowledged"; readonly transactionHash: `0x${string}` }
  | { readonly disposition: "rejected"; readonly reason: "provider_denied" | "provider_expired" }
  | { readonly disposition: "ambiguous"; readonly reason: string };

/**
 * One no-replay read of the stored provider request. A sealed request id is opened first; a seal that cannot be opened
 * throws its own precise refusal before the provider is asked anything, and the operation is not advanced.
 */
export async function observeProviderDirectRequest(
  context: RuntimeContext,
  adapter: ProviderAdapterBundle,
  operation: OperationRecord & { readonly providerEffect: ProviderEffectReference },
  waitSeconds?: number,
): Promise<ProviderDirectRecoveryOutcome> {
  const direct = adapter.direct;
  if (direct?.observe === undefined) {
    return { disposition: "ambiguous", reason: "provider_recovery_unavailable" };
  }
  const recoveryToken = await providerEffectRecoveryToken(context, operation);
  let result: Awaited<ReturnType<NonNullable<typeof direct.observe>>>;
  try {
    result = await direct.observe({
      recoveryToken,
      sender: operation.walletAddress,
      ...(waitSeconds === undefined ? {} : { waitSeconds }),
    });
  } catch {
    return { disposition: "unchanged" };
  }
  if (result.disposition !== "pending") return result;
  return result.recoveryToken === recoveryToken
    ? { disposition: "unchanged" }
    : { disposition: "ambiguous", reason: "provider_recovery_identity_mismatch" };
}

/** A reference that keeps its id: every reference 0.5.106 or earlier wrote, and a delegated send's (the APN operation id). */
export function createProviderEffectReference(
  recoveryToken: string,
  providerState: string,
): PlainProviderEffectReference {
  return {
    schemaVersion: "apn.provider-effect-reference.v1",
    kind: "transaction",
    recoveryToken,
    providerState,
  };
}

/**
 * A provider's own request id for `operation` (its pending MFA request, or one the owner recovers), sealed before the
 * record names it: the record keeps only its hash. The caller holds the operation lock and the record has no reference yet.
 */
export async function sealProviderEffectReference(
  references: ProviderRequestReferencePort,
  operation: OperationRecord,
  recoveryToken: string,
  providerState: string,
): Promise<SealedProviderEffectReference> {
  const recoveryTokenHash = providerRequestReferenceHash(requiredProviderId(operation), recoveryToken);
  await references.seal(providerEffectBinding(operation, recoveryTokenHash), recoveryToken);
  return { schemaVersion: "apn.provider-effect-reference.v2", kind: "transaction", recoveryTokenHash, providerState };
}

/**
 * The reference a direct execution result is kept as: a provider-atomic send's request id is the provider's own and is
 * sealed; a delegated send's is the APN operation id, which every output already names, and is kept as is.
 */
export async function providerEffectReferenceFor(
  context: RuntimeContext,
  operation: OperationRecord,
  binding: ProviderDirectBinding,
  recoveryToken: string,
  providerState: string,
): Promise<ProviderEffectReference> {
  return binding.executionMode === "delegated_session_transaction"
    ? createProviderEffectReference(recoveryToken, providerState)
    : await sealProviderEffectReference(context.requireProviderRequestReferences(), operation, recoveryToken, providerState);
}

/**
 * Before the owner approves a provider-atomic send whose provider names its requests (it can be asked to observe one),
 * the wrapping secret that will seal that request id is read: a refusal here leaves the operation awaiting approval.
 */
export async function readyProviderEffectReferences(context: RuntimeContext, adapter: ProviderAdapterBundle): Promise<void> {
  if (adapter.direct?.observe !== undefined) await context.requireProviderRequestReferences().ready();
}

/** The stored request id: kept by a version 1 reference, or opened from the seal of a version 2 one. */
export async function providerEffectRecoveryToken(
  context: RuntimeContext,
  operation: OperationRecord & { readonly providerEffect: ProviderEffectReference },
): Promise<string> {
  const reference = operation.providerEffect;
  if (reference.schemaVersion === "apn.provider-effect-reference.v1") return reference.recoveryToken;
  return await context.requireProviderRequestReferences().open(providerEffectBinding(operation, reference.recoveryTokenHash));
}

/** The hash output shows for a stored reference (`provider_request_reference_hash`), whichever version keeps it. */
export function providerEffectReferenceHash(providerId: string, reference: ProviderEffectReference): string {
  return reference.schemaVersion === "apn.provider-effect-reference.v1"
    ? providerRequestReferenceHash(providerId, reference.recoveryToken) : reference.recoveryTokenHash;
}

/** Whether a stored reference names this request id; a sealed one is compared by hash and never opened. */
export function providerEffectNames(providerId: string, reference: ProviderEffectReference, recoveryToken: string): boolean {
  return providerEffectReferenceHash(providerId, reference) === providerRequestReferenceHash(providerId, recoveryToken);
}

function providerEffectBinding(operation: OperationRecord, referenceHash: string): ProviderRequestReferenceBinding {
  return { lane: "provider-direct", providerId: requiredProviderId(operation), profileHash: operation.profileHash,
    operationId: operation.operationId, referenceHash };
}

function requiredProviderId(operation: OperationRecord): string {
  if (operation.providerDirect === undefined) {
    throw new ApnError("APN_OPERATION_BLOCKED", "Operation is not a provider direct transfer.");
  }
  return operation.providerDirect.providerId;
}

export function canonicalProviderRecoveryToken(value: unknown): string {
  if (typeof value !== "string" || !/^[A-Za-z0-9._:-]{1,256}$/u.test(value)) {
    throw new ApnError("APN_INVALID_INPUT", "Provider request ID must be 1-256 safe ASCII characters.");
  }
  return value;
}

export function sameFrozenProviderProfile(
  profile: ProviderProfileRecord,
  operation: OperationRecord,
  binding: ProviderDirectBinding,
): boolean {
  return profile.provider_id === binding.providerId && profile.revision === binding.profileRevision &&
    profile.capability_hash === binding.capabilityHash && profile.account_binding_hash === binding.accountBindingHash &&
    profile.public_address.toLowerCase() === operation.walletAddress.toLowerCase();
}
