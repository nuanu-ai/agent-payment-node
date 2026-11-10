import { ApnError } from "./errors.js";
import type { WrappingSecretPort } from "./macos-keychain.js";
import type { SecureStateStore } from "./secure-state-store.js";

/** The one recovery for a missing wrapping secret: nothing else can unwrap what was sealed under it. */
const RESTORE_WRAPPING_SECRET = "Restore the login Keychain item ai.nuanu.apn.wrapping-secret.v1 (account default) from a " +
  "backup of the login Keychain; nothing APN encrypted under it can be unwrapped without it.";

/**
 * Every directory whose entries a custody store sealed under the wrapping secret: the 13 stores of
 * tests/core/custody-envelope-cases.ts. `wallets/` is checked apart: its subdirectories are public records.
 */
const SEALED_DIRECTORIES = [
  "policies", "provider-authorizations", "smart-account-effects", "smart-account-x402-materials",
  "smart-account-gasless-materials", "smart-account-permissions", "chain-wallets", "circle-v2-evm-funding-effects",
  "bridge-effects", "uniswap-execution-effects", "merchant-material", "gasless-effects",
] as const;

function wrappingSecretMissing(message: string): ApnError {
  return new ApnError("APN_STATE_CORRUPT", message, { reason: "wrapping_secret_missing", nextActions: [RESTORE_WRAPPING_SECRET] });
}

/**
 * A local wallet whose login-Keychain wrapping secret is gone. Wallet status, ensure and doctor refuse it with this
 * reason instead of calling it ready.
 */
export function walletWrappingSecretMissing(): ApnError {
  return wrappingSecretMissing("The encrypted wallet exists but its wrapping secret is missing.");
}

/** What doctor suggests for a missing secret: a first wallet only when nothing was ever sealed under a secret. */
export async function missingSecretNextAction(state: SecureStateStore, profile: string): Promise<string> {
  return await holdsSealedCustody(state) ? RESTORE_WRAPPING_SECRET : `apn wallet ensure --profile ${profile}`;
}

/**
 * A sealed record: every store writes `<name>.json`, flat or in one per-profile or per-chain subdirectory. The name never
 * starts with a dot: a profile (which starts with [a-z0-9]), a hex hash, a network-scoped key such as `~network~…` or
 * `~solana~…`, or an operation-scoped one such as `<operation>-<role>…`. Any such name counts, so the test is the dot and
 * the `.json` suffix alone. Atomic-write stages never reach a listing (recordEntries).
 */
const SEALED_RECORD = /^[^.].*\.json$/u;

/**
 * Whether anything under the state root was sealed under a wrapping secret. Only a record counts: an empty directory
 * (left after effect retention, or by a first seal that failed before writing), a dotfile such as Finder's .DS_Store and
 * any other regular file do not. It fails closed: a link or any other entry type, a directory nested deeper than the
 * stores lay them out, or a listing that fails counts as sealed. In `wallets/` the subdirectories are public records.
 */
export async function holdsSealedCustody(state: SecureStateStore): Promise<boolean> {
  try {
    if (await holdsSealedRecord(state, "wallets", "public")) return true;
    for (const directory of SEALED_DIRECTORIES) if (await holdsSealedRecord(state, directory, "descend")) return true;
    return false;
  } catch { return true; }
}

async function holdsSealedRecord(state: SecureStateStore, directory: string, subdirectories: "public" | "descend" | "unexpected"): Promise<boolean> {
  for (const entry of await state.recordEntries(directory)) {
    if (entry.isFile()) { if (SEALED_RECORD.test(entry.name)) return true; continue; }
    if (!entry.isDirectory() || subdirectories === "unexpected") return true;
    if (subdirectories === "descend" && await holdsSealedRecord(state, `${directory}/${entry.name}`, "unexpected")) return true;
  }
  return false;
}

/**
 * The wrapping secret for sealing: the existing one, or a first one minted for a state root that holds nothing sealed.
 * A missing secret is never replaced while anything sealed under it exists, since a new one would orphan that material
 * and make the old Keychain item collide on restore. This is the only caller of `create()`.
 */
export async function loadOrCreateWrappingSecret(state: SecureStateStore, port: WrappingSecretPort): Promise<Buffer> {
  const existing = await port.load();
  if (existing !== null) return existing;
  if (await holdsSealedCustody(state)) {
    // A concurrent first creation may have minted it after the load above, then sealed what was just found.
    const raced = await port.load();
    if (raced !== null) return raced;
    throw wrappingSecretMissing("APN state holds encrypted records but their wrapping secret is missing; a new secret would orphan them.");
  }
  return await port.create();
}
