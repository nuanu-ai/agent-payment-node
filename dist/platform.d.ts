import { type AdvisoryLockPort } from "./macos-advisory-lock.js";
import { type WrappingSecretPort } from "./macos-keychain.js";
/**
 * The wrapping-secret backend. `APN_WRAPPING_SECRET_FILE` selects file custody on any platform (the Linux server path);
 * without it macOS keeps its login Keychain and every other platform refuses, because there is no default location.
 */
export declare function platformWrappingSecret(): WrappingSecretPort;
/** The kernel advisory lock: lockf(1) on macOS, util-linux flock(1) on Linux. */
export declare function platformAdvisoryLock(): AdvisoryLockPort;
