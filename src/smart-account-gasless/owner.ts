import { accountBindingHash, capabilityHash, metamaskSmartAccountX402CapabilitySnapshot,
  validateProviderProfile } from "../provider-profile.js";
import type { StateStore } from "../state.js";
import { canonicalProfile } from "../wallet-policy.js";
import { SA_ZERO_ADDRESS, type SmartAccountGaslessBinding, type SmartAccountGaslessProfileIdentity } from "./model.js";
import { saFail } from "./reasons.js";
import { saAddress, saBinding } from "./schema.js";

export async function smartAccountGaslessOwner(state: StateStore, input: string,
  expected?: SmartAccountGaslessBinding): Promise<SmartAccountGaslessProfileIdentity> {
  const profile = canonicalProfile(input), profileHash = state.profileHash(profile);
  const stored = await state.loadProviderProfile(profileHash);
  if (stored === null) saFail("sa_gasless_capability");
  const p = validateProviderProfile(stored);
  if (p.provider_id !== "metamask-smart-account" || p.trust_class !== "external_owner_delegated_local_session" ||
    p.capability_hash !== capabilityHash(metamaskSmartAccountX402CapabilitySnapshot())) saFail("sa_gasless_capability");
  const address = saAddress(p.public_address, "sa_gasless_identity");
  if (p.profile !== profile || p.profile_hash !== profileHash || p.drift.state !== "bound" || p.drift.reason !== "none" ||
    address === SA_ZERO_ADDRESS || p.account_binding_hash !== accountBindingHash(p.provider_id, address)) saFail("sa_gasless_identity");
  const owner = { profile, profileHash, address, accountBindingHash: p.account_binding_hash,
    capabilityHash: p.capability_hash, revision: p.revision };
  if (expected !== undefined) assertSmartAccountGaslessBinding(expected, owner);
  return owner;
}
export function assertSmartAccountGaslessBinding(value: unknown, owner: SmartAccountGaslessProfileIdentity): SmartAccountGaslessBinding {
  const b = saBinding(value);
  if (b.profileHash !== owner.profileHash || b.ownerAddress !== owner.address || b.accountBindingHash !== owner.accountBindingHash ||
    b.capabilityHash !== owner.capabilityHash || b.profileRevision !== owner.revision) saFail("sa_gasless_identity");
  return b;
}
