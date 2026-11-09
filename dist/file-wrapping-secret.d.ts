import type { WrappingSecretPort } from "./macos-keychain.js";
/** The variable that names the server's wrapping-secret file. There is no default path. */
export declare const WRAPPING_SECRET_FILE_ENV = "APN_WRAPPING_SECRET_FILE";
/**
 * Server custody of the APN wrapping secret: one file holding the base64 of 32 random bytes, owned by the APN user with
 * no group or other permission bits (systemd `LoadCredential=`, a mounted Kubernetes secret, or a file the operator
 * provisioned). `create` writes the file once with `O_EXCL` and mode 0600 when it does not exist yet; a racing writer
 * loses to the first and reads its secret back.
 */
export declare class FileWrappingSecret implements WrappingSecretPort {
    private readonly path;
    private cached;
    constructor(path: string);
    load(): Promise<Buffer | null>;
    create(): Promise<Buffer>;
    private remember;
}
