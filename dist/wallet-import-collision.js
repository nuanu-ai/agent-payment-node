import { ApnError } from "./errors.js";
import { stateCorrupt, stateSecurity } from "./secure-state-store.js";
import { completeWalletCommand } from "./wallet-policy.js";
/** Inspect every local identity before importing a second signing key. */
export async function listLocalWallets(state) {
    const wallets = [];
    for (const entry of await state.walletImportEntries()) {
        if (entry.isSymbolicLink())
            stateSecurity("Wallets directory contains an unsafe entry.");
        if (entry.isDirectory()) {
            if (!/^[a-f0-9]{64}$/u.test(entry.name))
                stateSecurity("Wallets directory contains an unknown directory.");
            const wallet = await state.loadWallet(entry.name) ?? await recordlessWallet(state, entry.name);
            if (wallet.profileHash !== entry.name)
                stateCorrupt("Wallet metadata path does not match its identity.");
            wallets.push(wallet);
        }
        else if (!entry.isFile() || !/^[a-z0-9][a-z0-9._-]{0,63}\.json$/u.test(entry.name)) {
            stateSecurity("Wallets directory contains an unknown file.");
        }
    }
    return wallets;
}
/**
 * A record directory without its `wallet.json`. When its profile's key is sealed, a `wallet ensure` or `wallet import`
 * stopped between the two writes (an incomplete wallet): refused naming the command that completes that profile.
 */
async function recordlessWallet(state, profileHash) {
    for (const envelope of await listEncryptedWalletEnvelopes(state)) {
        if (state.profileHash(envelope.profile) !== profileHash)
            continue;
        throw new ApnError("APN_STATE_CORRUPT", `The local wallet of profile ${envelope.profile} is incomplete: its key is sealed but its ` +
            "public record was never written.", { reason: "sealed_key_without_public_record", nextActions: [completeWalletCommand(envelope.profile)] });
    }
    return stateCorrupt("Wallet metadata disappeared during identity validation.");
}
/**
 * A first provider binding of a profile whose local key is sealed without its public record (an incomplete wallet, see
 * incompleteWallet) would strand that key behind another owner. Callers refuse it under the profile lock, before any
 * provider contact, consent or write, naming the command that completes the local wallet.
 */
export async function assertNoIncompleteLocalWallet(state, profile) {
    if (await state.loadWallet(state.profileHash(profile)) !== null || await state.loadEncryptedWalletEnvelope(profile) === null)
        return;
    throw new ApnError("APN_PROFILE_DRIFT", "This profile holds an incomplete local wallet: its key is sealed but its public record " +
        "was never written. Complete that wallet; a provider cannot be bound over it.", { reason: "sealed_key_without_public_record", nextActions: [completeWalletCommand(profile)] });
}
export async function listEncryptedWalletEnvelopes(state) {
    const envelopes = [];
    for (const entry of await state.walletImportEntries()) {
        if (entry.isFile() && !entry.isSymbolicLink() && /^[a-z0-9][a-z0-9._-]{0,63}\.json$/u.test(entry.name)) {
            const profile = entry.name.slice(0, -5);
            const value = await state.loadEncryptedWalletEnvelope(profile);
            if (value === null)
                stateCorrupt("Wallet envelope disappeared during validation.");
            envelopes.push({ profile, value });
        }
    }
    return envelopes;
}
export async function listLocalProviderProfiles(state) {
    const profiles = [];
    for (const entry of await state.profileImportEntries()) {
        if (!entry.isDirectory() || entry.isSymbolicLink() || !/^[a-f0-9]{64}$/u.test(entry.name)) {
            stateSecurity("Profiles directory contains an unsafe entry.");
        }
        const profile = await state.loadProviderProfile(entry.name);
        if (profile?.provider_id === "local")
            profiles.push(profile);
    }
    return profiles;
}
//# sourceMappingURL=wallet-import-collision.js.map