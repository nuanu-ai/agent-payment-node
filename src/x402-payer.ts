import { ApnError } from "./errors.js";
import { policyBinding, type ProfilePolicyBinding } from "./profile-policy.js";
import { LOCAL_PROVIDER_ID } from "./provider-profile.js";
import type { RuntimeContext } from "./runtime.js";
import type { X402OperationRecord } from "./x402-state-integrity.js";

export interface X402PayerBinding {
  readonly wallet: `0x${string}`;
  readonly policy: ProfilePolicyBinding;
  readonly providerSigner?: NonNullable<X402OperationRecord["providerSigner"]>;
}

export async function resolveX402Payer(
  context: RuntimeContext,
  profileHash: string,
): Promise<X402PayerBinding> {
  const provider = context.profileRepository === undefined
    ? null
    : await context.requireProfileRepository().load(profileHash);
  if (provider === null || provider.provider_id === LOCAL_PROVIDER_ID) {
    const wallet = await context.state.loadWallet(profileHash);
    if (wallet === null) throw new ApnError("APN_OPERATION_BLOCKED", "Wallet is not initialized.");
    return { wallet: wallet.address.toLowerCase() as `0x${string}`, policy: policyBinding(wallet) };
  }
  const capability = provider.capability_snapshot.x402;
  if (
    provider.drift.state !== "bound" || !capability.available ||
    capability.mode !== "provider_detached_eip3009_apn_paid_retry" ||
    capability.execution_owner !== "apn" || capability.retry_owner !== "apn_state_machine"
  ) throw new ApnError("APN_PROVIDER_EFFECT_UNAVAILABLE", "The provider cannot sign detached APN x402 authorizations.");
  const adapter = context.requireProviderRegistry().resolve(provider.provider_id);
  if (
    adapter.provider_id !== provider.provider_id || adapter.capabilities.x402.mode !== capability.mode ||
    adapter.x402Signer?.mode !== capability.mode
  ) throw new ApnError("APN_PROVIDER_EFFECT_UNAVAILABLE", "The provider detached x402 signer is unavailable.");
  await adapter.reads.crossCheckAddress(provider.public_address);
  return {
    wallet: provider.public_address.toLowerCase() as `0x${string}`,
    policy: policyBinding(provider),
    providerSigner: {
      schemaVersion: "apn.x402.provider-signer.v1",
      providerId: provider.provider_id,
      profileRevision: provider.revision,
      capabilityHash: provider.capability_hash,
      accountBindingHash: provider.account_binding_hash,
      executionMode: capability.mode,
      executionOwner: capability.execution_owner,
      retryOwner: capability.retry_owner,
    },
  };
}
