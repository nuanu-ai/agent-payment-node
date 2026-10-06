import { canonicalJson, domainHash } from "../canonical.js";
import { getAddress } from "viem";
import { ApnError } from "../errors.js";
import { walletEnvelopeIdentity } from "../encrypted-wallet-store.js";
import { canonicalProfile } from "../wallet-policy.js";
/** Metadata only: never decrypts an envelope or obtains a signing key. */
export async function permit2WalletBinding(state, value) {
    const profile = canonicalProfile(value), profileHash = state.profileHash(profile);
    const artifacts = await state.loadWalletArtifacts(profile, profileHash);
    const provider = await state.loadProviderProfile(profileHash);
    return decodePermit2WalletBinding(profile, profileHash, artifacts, provider);
}
/** Pure existing metadata predicates; no lock, decrypt or ownership authority. */
export function decodePermit2WalletBinding(profile, profileHash, artifacts, provider) {
    if (artifacts.stored === null || artifacts.encrypted === null || provider !== null && provider.provider_id !== "local") {
        throw new ApnError("APN_OPERATION_BLOCKED", "A current local owner wallet is required.");
    }
    const envelope = walletEnvelopeIdentity(artifacts.encrypted, profile);
    if (artifacts.stored.profile !== profile || artifacts.stored.profileHash !== profileHash ||
        artifacts.stored.address.toLowerCase() !== envelope.address.toLowerCase() || artifacts.stored.bindingHash !== envelope.bindingHash ||
        provider !== null && (provider.public_address.toLowerCase() !== envelope.address.toLowerCase() ||
            provider.account_binding_hash !== envelope.bindingHash))
        throw new ApnError("APN_PROFILE_DRIFT", "Local owner wallet records disagree.");
    return { profile, profileHash, account: getAddress(envelope.address), bindingHash: envelope.bindingHash, provider: "local",
        providerRecordDigest: provider === null ? null : domainHash("apn.permit2.local-provider.v1", canonicalJson(provider)),
        walletChainId: envelope.chainId, walletCreatedAt: envelope.createdAt };
}
//# sourceMappingURL=owner-binding.js.map