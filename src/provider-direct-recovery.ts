import type { OperationRecord, ProviderDirectBinding, ProviderEffectReference } from "./model.js";
import type { ProviderAdapterBundle } from "./provider-ports.js";
import type { ProviderProfileRecord } from "./provider-profile.js";

export type ProviderDirectRecoveryOutcome =
  | { readonly disposition: "unchanged" }
  | { readonly disposition: "acknowledged"; readonly transactionHash: `0x${string}` }
  | { readonly disposition: "rejected"; readonly reason: "provider_denied" | "provider_expired" }
  | { readonly disposition: "ambiguous"; readonly reason: string };

export async function observeProviderDirectRequest(
  adapter: ProviderAdapterBundle,
  operation: OperationRecord & { readonly providerEffect: ProviderEffectReference },
  waitSeconds?: number,
): Promise<ProviderDirectRecoveryOutcome> {
  const direct = adapter.direct;
  if (direct?.observe === undefined) {
    return { disposition: "ambiguous", reason: "provider_recovery_unavailable" };
  }
  let result: Awaited<ReturnType<NonNullable<typeof direct.observe>>>;
  try {
    result = await direct.observe({
      recoveryToken: operation.providerEffect.recoveryToken,
      sender: operation.walletAddress,
      ...(waitSeconds === undefined ? {} : { waitSeconds }),
    });
  } catch {
    return { disposition: "unchanged" };
  }
  if (result.disposition !== "pending") return result;
  return result.recoveryToken === operation.providerEffect.recoveryToken
    ? { disposition: "unchanged" }
    : { disposition: "ambiguous", reason: "provider_recovery_identity_mismatch" };
}

export function createProviderEffectReference(
  recoveryToken: string,
  providerState: string,
): ProviderEffectReference {
  return {
    schemaVersion: "apn.provider-effect-reference.v1",
    kind: "transaction",
    recoveryToken,
    providerState,
  };
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
