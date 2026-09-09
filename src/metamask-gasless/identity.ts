import { hashObject, sha256 } from "../canonical.js";
import { validateProviderProfile } from "../provider-profile.js";
import type { MetaMaskGaslessBinding, MetaMaskGaslessProfileIdentity } from "./model.js";
import { MM_ZERO_ADDRESS } from "./model.js";
import { mmFail, type MetaMaskGaslessFailureReason } from "./reasons.js";
import { mmAddress, mmCanonicalAddress, mmExact, mmHash, mmSame } from "./validation.js";

export function mmPrivateHash(kind: "project" | "wallet-id" | "wallet-reference" | "request-id",
  value: string, referenceKind?: "id" | "name" | "address"): string {
  if (typeof value !== "string" || value.length === 0 || value.length > 1024 ||
    (kind === "wallet-reference") !== (referenceKind !== undefined)) mmFail("mm_gasless_identity");
  const purpose = `apn.metamask-gasless.${kind}.v1`;
  return referenceKind === undefined ? hashObject({ purpose, value }) : hashObject({ purpose, kind: referenceKind, value });
}
export function mmProfileIdentity(value: unknown): MetaMaskGaslessProfileIdentity {
  const p = validateProviderProfile(value);
  if (p.provider_id !== "metamask-agent-wallet") mmFail("mm_gasless_capability_unavailable");
  if (p.drift.state !== "bound" || p.drift.reason !== "none") mmFail("mm_gasless_binding_changed");
  if (p.profile_hash !== sha256(`profile\0${p.profile}`)) mmFail("mm_gasless_state_corrupt");
  const address = mmAddress(p.public_address, "mm_gasless_identity");
  if (address === MM_ZERO_ADDRESS) mmFail("mm_gasless_identity");
  return { profile: p.profile, profileHash: p.profile_hash, address, accountBindingHash: p.account_binding_hash,
    capabilityHash: p.capability_hash, revision: p.revision };
}
/** The supported server service has no opaque wallet id. The legacy field binds its resolved address. */
export function mmWalletIdentityHash(address: unknown): string {
  return mmPrivateHash("wallet-id", mmAddress(address, "mm_gasless_identity"));
}
export function mmBinding(value: unknown, reason: MetaMaskGaslessFailureReason = "mm_gasless_identity"): MetaMaskGaslessBinding {
  const b = mmExact(value, ["providerId", "address", "accountBindingHash", "capabilityHash", "revision", "projectHash",
    "walletReferenceHash", "walletIdHash", "namespace", "mode", "environment"], reason);
  if (b.providerId !== "metamask-agent-wallet" || b.namespace !== "eip155" || b.mode !== "server" || b.environment !== "prod" ||
    !Number.isSafeInteger(b.revision) || Number(b.revision) < 1 || mmCanonicalAddress(b.address, reason) === MM_ZERO_ADDRESS) mmFail(reason);
  for (const key of ["accountBindingHash", "capabilityHash", "projectHash", "walletReferenceHash", "walletIdHash"]) mmHash(b[key], reason);
  if (b.walletIdHash !== mmWalletIdentityHash(b.address)) mmFail(reason);
  return b as unknown as MetaMaskGaslessBinding;
}
export function mmAssertProfileBinding(binding: MetaMaskGaslessBinding, expected: MetaMaskGaslessProfileIdentity): void {
  mmBinding(binding);
  if (binding.address !== expected.address || binding.accountBindingHash !== expected.accountBindingHash ||
    binding.capabilityHash !== expected.capabilityHash || binding.revision !== expected.revision) mmFail("mm_gasless_binding_changed");
}
export function mmAssertSameBinding(current: unknown, expected: MetaMaskGaslessBinding): MetaMaskGaslessBinding {
  const binding = mmBinding(current);
  if (!mmSame(binding, expected)) mmFail("mm_gasless_binding_changed");
  return binding;
}
