import type { StateStore } from "../state.js";
import { canonicalProfile } from "../wallet-policy.js";
import { mmAssertProfileBinding, mmProfileIdentity } from "./identity.js";
import type { MetaMaskGaslessBinding, MetaMaskGaslessProfileIdentity } from "./model.js";
import { mmFail } from "./reasons.js";

export async function metaMaskGaslessOwner(state: StateStore, input: string,
  expected?: MetaMaskGaslessBinding): Promise<MetaMaskGaslessProfileIdentity> {
  const profile = canonicalProfile(input), profileHash = state.profileHash(profile);
  const stored = await state.loadProviderProfile(profileHash);
  if (stored === null) mmFail("mm_gasless_capability_unavailable");
  const owner = mmProfileIdentity(stored);
  if (owner.profile !== profile || owner.profileHash !== profileHash) mmFail("mm_gasless_identity");
  if (expected !== undefined) mmAssertProfileBinding(expected, owner);
  return owner;
}
