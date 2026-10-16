import { walletEnvelopeIdentity } from "./encrypted-wallet-store.js";
import { ApnError } from "./errors.js";
import type { StateStore } from "./state.js";
import { listEncryptedWalletEnvelopes, listLocalWallets } from "./wallet-import-collision.js";

const PROFILE_HASH = /^[a-f0-9]{64}$/u;

/**
 * Every APN profile that names one EVM account: provider profiles bound to it, local wallets and encrypted wallet
 * envelopes holding it, and profiles of direct operations that sent from it. Several profiles may share one
 * account (aliases are not banned), so a money operation must wait for the unresolved operations of all of them.
 * Caller holds the account's evm-owner lock so no alias can be bound or start an operation meanwhile.
 */
export async function evmAccountProfileHashes(state: StateStore, account: string, ownProfileHash: string):
  Promise<ReadonlySet<string>> {
  const target = account.toLowerCase(), hashes = new Set([ownProfileHash]);
  for (const entry of await state.profileImportEntries()) {
    if (!entry.isDirectory() || entry.isSymbolicLink() || !PROFILE_HASH.test(entry.name)) {
      throw new ApnError("APN_STATE_CORRUPT", "Profiles directory is invalid during the account conflict check.");
    }
    const profile = await state.loadProviderProfile(entry.name);
    if (profile === null) throw new ApnError("APN_STATE_CORRUPT", "Provider profile disappeared during the account conflict check.");
    if (profile.public_address.toLowerCase() === target) hashes.add(entry.name);
  }
  for (const wallet of await listLocalWallets(state)) if (wallet.address.toLowerCase() === target) hashes.add(wallet.profileHash);
  for (const envelope of await listEncryptedWalletEnvelopes(state)) {
    const identity = walletEnvelopeIdentity(envelope.value, envelope.profile);
    if (identity.address.toLowerCase() === target) hashes.add(state.profileHash(identity.profile));
  }
  for (const operation of await state.listAllOperations()) {
    if (operation.walletAddress.toLowerCase() === target) hashes.add(operation.profileHash);
  }
  return hashes;
}
