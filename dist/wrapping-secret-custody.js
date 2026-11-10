import { ApnError } from "./errors.js";
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
];
function wrappingSecretMissing(message) {
    return new ApnError("APN_STATE_CORRUPT", message, { reason: "wrapping_secret_missing", nextActions: [RESTORE_WRAPPING_SECRET] });
}
/**
 * A local wallet whose login-Keychain wrapping secret is gone. Wallet status, ensure and doctor refuse it with this
 * reason instead of calling it ready.
 */
export function walletWrappingSecretMissing() {
    return wrappingSecretMissing("The encrypted wallet exists but its wrapping secret is missing.");
}
/** What doctor suggests for a missing secret: a first wallet only when nothing was ever sealed under a secret. */
export async function missingSecretNextAction(state, profile) {
    return await holdsSealedCustody(state) ? RESTORE_WRAPPING_SECRET : `apn wallet ensure --profile ${profile}`;
}
/** Whether anything under the state root was sealed under a wrapping secret; any entry counts, so this fails closed. */
export async function holdsSealedCustody(state) {
    if ((await state.recordEntries("wallets")).some((entry) => !entry.isDirectory()))
        return true;
    for (const directory of SEALED_DIRECTORIES)
        if ((await state.recordEntries(directory)).length > 0)
            return true;
    return false;
}
/**
 * The wrapping secret for sealing: the existing one, or a first one minted for a state root that holds nothing sealed.
 * A missing secret is never replaced while anything sealed under it exists, since a new one would orphan that material
 * and make the old Keychain item collide on restore. This is the only caller of `create()`.
 */
export async function loadOrCreateWrappingSecret(state, port) {
    const existing = await port.load();
    if (existing !== null)
        return existing;
    if (await holdsSealedCustody(state)) {
        // A concurrent first creation may have minted it after the load above, then sealed what was just found.
        const raced = await port.load();
        if (raced !== null)
            return raced;
        throw wrappingSecretMissing("APN state holds encrypted records but their wrapping secret is missing; a new secret would orphan them.");
    }
    return await port.create();
}
//# sourceMappingURL=wrapping-secret-custody.js.map