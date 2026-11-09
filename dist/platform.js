import { ApnError } from "./errors.js";
import { FileWrappingSecret, WRAPPING_SECRET_FILE_ENV } from "./file-wrapping-secret.js";
import { LinuxFlockLock } from "./linux-advisory-lock.js";
import { MacosAdvisoryLock } from "./macos-advisory-lock.js";
import { MacOSLoginKeychainSecret } from "./macos-keychain.js";
/**
 * The wrapping-secret backend. `APN_WRAPPING_SECRET_FILE` selects file custody on any platform (the Linux server path);
 * without it macOS keeps its login Keychain and every other platform refuses, because there is no default location.
 */
export function platformWrappingSecret() {
    const file = process.env[WRAPPING_SECRET_FILE_ENV];
    if (file !== undefined && file !== "")
        return new FileWrappingSecret(file);
    if (process.platform === "darwin")
        return new MacOSLoginKeychainSecret();
    throw new ApnError("APN_NATIVE_REJECTED", `Set ${WRAPPING_SECRET_FILE_ENV} to the absolute path of the APN wrapping-secret file.`, {
        nativeCode: "APN_KEYCHAIN_UNAVAILABLE",
    });
}
/** The kernel advisory lock: lockf(1) on macOS, util-linux flock(1) on Linux. */
export function platformAdvisoryLock() {
    if (process.platform === "darwin")
        return new MacosAdvisoryLock();
    if (process.platform === "linux")
        return new LinuxFlockLock();
    throw new ApnError("APN_STATE_SECURITY", `APN has no advisory lock for platform ${process.platform}.`);
}
//# sourceMappingURL=platform.js.map