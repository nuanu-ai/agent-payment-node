import { ApnError } from "./errors.js";
import type { WrappingSecretPort } from "./macos-keychain.js";
import type { SecureStateStore } from "./secure-state-store.js";
/**
 * A local wallet whose login-Keychain wrapping secret is gone. Wallet status, ensure and doctor refuse it with this
 * reason instead of calling it ready.
 */
export declare function walletWrappingSecretMissing(): ApnError;
/** What doctor suggests for a missing secret: a first wallet only when nothing was ever sealed under a secret. */
export declare function missingSecretNextAction(state: SecureStateStore, profile: string): Promise<string>;
/** Whether anything under the state root was sealed under a wrapping secret; any entry counts, so this fails closed. */
export declare function holdsSealedCustody(state: SecureStateStore): Promise<boolean>;
/**
 * The wrapping secret for sealing: the existing one, or a first one minted for a state root that holds nothing sealed.
 * A missing secret is never replaced while anything sealed under it exists, since a new one would orphan that material
 * and make the old Keychain item collide on restore. This is the only caller of `create()`.
 */
export declare function loadOrCreateWrappingSecret(state: SecureStateStore, port: WrappingSecretPort): Promise<Buffer>;
