import { exactKeys, hashObject, isPlainRecord } from "./canonical.js";
import { ApnError } from "./errors.js";
import { projectLegacyLocalProfile } from "./provider-profile.js";
import { canonicalAddress, canonicalProfile } from "./wallet-policy.js";
export function validateEvmNativeCustody(value) {
    if (!isPlainRecord(value) || !exactKeys(value, ["schemaVersion", "profileHash", "walletAddress", "walletBindingHash", "walletCreatedAt",
        "providerId", "providerAccountBindingHash", "providerCapabilityHash", "providerRevision"]))
        drift();
    const binding = value;
    if (binding.schemaVersion !== "apn.evm-native-custody.v1" || binding.providerId !== "local" ||
        canonicalAddress(binding.walletAddress) !== binding.walletAddress ||
        ![binding.profileHash, binding.walletBindingHash, binding.providerAccountBindingHash, binding.providerCapabilityHash].every(v => typeof v === "string" && /^[a-f0-9]{64}$/u.test(v)) ||
        binding.walletBindingHash !== binding.providerAccountBindingHash || !Number.isSafeInteger(binding.providerRevision) || binding.providerRevision < 1 ||
        typeof binding.walletCreatedAt !== "string" || !Number.isFinite(Date.parse(binding.walletCreatedAt)) ||
        new Date(binding.walletCreatedAt).toISOString() !== binding.walletCreatedAt)
        drift();
    return binding;
}
export async function evmNativeCustody(state, profileInput) {
    const profile = canonicalProfile(profileInput), profileHash = state.profileHash(profile);
    const wallet = await state.loadWallet(profileHash);
    if (wallet === null)
        drift();
    const provider = await state.loadProviderProfile(profileHash) ?? projectLegacyLocalProfile(wallet);
    if (wallet.profile !== profile || wallet.profileHash !== profileHash || provider.provider_id !== "local" ||
        provider.profile !== profile || provider.profile_hash !== profileHash || provider.drift.state !== "bound" ||
        provider.public_address !== wallet.address || provider.account_binding_hash !== wallet.bindingHash)
        drift();
    return validateEvmNativeCustody({ schemaVersion: "apn.evm-native-custody.v1", profileHash, walletAddress: wallet.address,
        walletBindingHash: wallet.bindingHash, walletCreatedAt: wallet.createdAt, providerId: "local",
        providerAccountBindingHash: provider.account_binding_hash, providerCapabilityHash: provider.capability_hash, providerRevision: provider.revision });
}
export async function assertEvmNativeCustody(state, profile, expected, identity) {
    validateEvmNativeCustody(expected);
    if (hashObject(await evmNativeCustody(state, profile)) !== hashObject(expected) ||
        (identity !== undefined && (identity.profile !== profile || identity.address !== expected.walletAddress ||
            identity.bindingHash !== expected.walletBindingHash || identity.createdAt !== expected.walletCreatedAt)))
        drift();
}
function drift() { throw new ApnError("APN_PROFILE_DRIFT", "The frozen generic native wallet/provider custody binding has changed."); }
//# sourceMappingURL=evm-native-custody.js.map