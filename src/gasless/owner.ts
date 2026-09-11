import { sha256 } from "../canonical.js";
import { projectLegacyLocalProfile } from "../provider-profile.js";
import type { StateStore } from "../state.js";
import { canonicalProfile } from "../wallet-policy.js";
import type { GaslessOwner, GaslessProviderBinding } from "./model.js";
import { gaslessFailure, gaslessSame } from "./validation.js";

export async function gaslessOwner(state: StateStore, profileInput: string): Promise<{
  owner: GaslessOwner; providerBinding: GaslessProviderBinding;
}> {
  const profile = canonicalProfile(profileInput), profileHash = sha256(`profile\0${profile}`);
  const binding = await state.loadProviderProfile(profileHash);
  if (binding !== null && binding.provider_id !== "local") gaslessFailure("APN_PROVIDER_CAPABILITY_UNAVAILABLE", "gasless_profile_adapter_unavailable");
  const wallet = await state.loadWallet(profileHash);
  if (wallet === null) gaslessFailure("APN_WALLET_POLICY_REQUIRED", "gasless_existing_local_wallet_required");
  const provider = binding ?? projectLegacyLocalProfile(wallet);
  if (provider.drift.state !== "bound" || provider.public_address !== wallet.address ||
    provider.account_binding_hash !== wallet.bindingHash || provider.profile !== profile || provider.profile_hash !== profileHash) {
    gaslessFailure("APN_PROFILE_DRIFT", "gasless_identity_drift");
  }
  return { owner: { profile, profileHash, address: wallet.address, walletBindingHash: wallet.bindingHash,
    walletCreatedAt: wallet.createdAt }, providerBinding: { providerId: "local", accountBindingHash: provider.account_binding_hash,
    capabilityHash: provider.capability_hash, revision: provider.revision } };
}
export async function assertGaslessOwner(state: StateStore,
  expected: { readonly owner: GaslessOwner; readonly providerBinding: GaslessProviderBinding }): Promise<GaslessOwner> {
  const current = await gaslessOwner(state, expected.owner.profile);
  if (!gaslessSame(current, { owner: expected.owner, providerBinding: expected.providerBinding })) gaslessFailure("APN_PROFILE_DRIFT", "gasless_identity_drift");
  return current.owner;
}
