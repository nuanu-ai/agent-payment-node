import type { WalletRecord } from "./model.js";
import type { ProviderProfileRecord } from "./provider-profile.js";
import type { StateStore } from "./state.js";
import { stateCorrupt, stateSecurity } from "./secure-state-store.js";

/** Inspect every local identity before importing a second signing key. */
export async function listLocalWallets(state: StateStore): Promise<readonly WalletRecord[]> {
  const wallets: WalletRecord[] = [];
  for (const entry of await state.walletImportEntries()) {
    if (entry.isSymbolicLink()) stateSecurity("Wallets directory contains an unsafe entry.");
    if (entry.isDirectory()) {
      if (!/^[a-f0-9]{64}$/u.test(entry.name)) stateSecurity("Wallets directory contains an unknown directory.");
      const wallet = await state.loadWallet(entry.name);
      if (wallet === null) stateCorrupt("Wallet metadata disappeared during identity validation.");
      if (wallet.profileHash !== entry.name) stateCorrupt("Wallet metadata path does not match its identity.");
      wallets.push(wallet);
    } else if (!entry.isFile() || !/^[a-z0-9][a-z0-9._-]{0,63}\.json$/u.test(entry.name)) {
      stateSecurity("Wallets directory contains an unknown file.");
    }
  }
  return wallets;
}

export async function listEncryptedWalletEnvelopes(state: StateStore): Promise<readonly { profile: string; value: unknown }[]> {
  const envelopes: { profile: string; value: unknown }[] = [];
  for (const entry of await state.walletImportEntries()) {
    if (entry.isFile() && !entry.isSymbolicLink() && /^[a-z0-9][a-z0-9._-]{0,63}\.json$/u.test(entry.name)) {
      const profile = entry.name.slice(0, -5);
      const value = await state.loadEncryptedWalletEnvelope(profile);
      if (value === null) stateCorrupt("Wallet envelope disappeared during validation.");
      envelopes.push({ profile, value });
    }
  }
  return envelopes;
}

export async function listLocalProviderProfiles(state: StateStore): Promise<readonly ProviderProfileRecord[]> {
  const profiles: ProviderProfileRecord[] = [];
  for (const entry of await state.profileImportEntries()) {
    if (!entry.isDirectory() || entry.isSymbolicLink() || !/^[a-f0-9]{64}$/u.test(entry.name)) {
      stateSecurity("Profiles directory contains an unsafe entry.");
    }
    const profile = await state.loadProviderProfile(entry.name);
    if (profile?.provider_id === "local") profiles.push(profile);
  }
  return profiles;
}
