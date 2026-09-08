import { sha256 } from "../canonical.js";
import { projectLegacyLocalProfile } from "../provider-profile.js";
import type { StateStore } from "../state.js";
import { canonicalProfile } from "../wallet-policy.js";
import type { BridgeOwner, BridgeProviderBinding } from "./model.js";
import { bridgeFailure, bridgeSame } from "./validation.js";

export async function bridgeOwner(state: StateStore, profileInput: string): Promise<{ owner: BridgeOwner; providerBinding: BridgeProviderBinding }> {
  const profile = canonicalProfile(profileInput), profileHash = sha256(`profile\0${profile}`);
  const binding = await state.loadProviderProfile(profileHash);
  if (binding !== null && binding.provider_id !== "local") bridgeFailure("APN_PROVIDER_CAPABILITY_UNAVAILABLE", "bridge_profile_adapter_unavailable");
  const wallet = await state.loadWallet(profileHash);
  if (wallet === null) bridgeFailure("APN_WALLET_POLICY_REQUIRED", "existing_local_wallet_required");
  const provider = binding ?? projectLegacyLocalProfile(wallet);
  if (provider.drift.state !== "bound" || provider.public_address !== wallet.address || provider.account_binding_hash !== wallet.bindingHash ||
    provider.profile !== profile || provider.profile_hash !== profileHash) bridgeFailure("APN_PROFILE_DRIFT", "bridge_profile_binding");
  return {
    owner: { profile, profileHash, address: wallet.address, walletBindingHash: wallet.bindingHash, walletCreatedAt: wallet.createdAt },
    providerBinding: { providerId: "local", accountBindingHash: provider.account_binding_hash, capabilityHash: provider.capability_hash, revision: provider.revision },
  };
}
export async function assertBridgeOwner(state: StateStore, expected: { readonly owner: BridgeOwner; readonly providerBinding: BridgeProviderBinding }): Promise<BridgeOwner> {
  const current = await bridgeOwner(state, expected.owner.profile);
  if (!bridgeSame(current, { owner: expected.owner, providerBinding: expected.providerBinding })) bridgeFailure("APN_PROFILE_DRIFT", "bridge_owner_changed");
  return current.owner;
}
