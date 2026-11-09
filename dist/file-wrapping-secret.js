import { randomBytes } from "node:crypto";
import { constants } from "node:fs";
import { lstat, open } from "node:fs/promises";
import { dirname, isAbsolute, normalize, resolve } from "node:path";
import { ApnError } from "./errors.js";
/** The variable that names the server's wrapping-secret file. There is no default path. */
export const WRAPPING_SECRET_FILE_ENV = "APN_WRAPPING_SECRET_FILE";
const SECRET_BYTES = 32;
const MAX_FILE_BYTES = 256;
/**
 * Server custody of the APN wrapping secret: one file holding the base64 of 32 random bytes, owned by the APN user with
 * no group or other permission bits (systemd `LoadCredential=`, a mounted Kubernetes secret, or a file the operator
 * provisioned). `create` writes the file once with `O_EXCL` and mode 0600 when it does not exist yet; a racing writer
 * loses to the first and reads its secret back.
 */
export class FileWrappingSecret {
    path;
    cached;
    constructor(path) {
        if (!isAbsolute(path) || normalize(path) !== path || resolve(path) !== path || path === "/") {
            throw secretUnavailable(`${WRAPPING_SECRET_FILE_ENV} must be a canonical absolute path.`);
        }
        this.path = path;
    }
    async load() {
        if (this.cached !== undefined)
            return copy(this.cached);
        let handle;
        try {
            handle = await open(this.path, constants.O_RDONLY | constants.O_NOFOLLOW);
        }
        catch (error) {
            if (codeOf(error) === "ENOENT")
                return null;
            throw secretUnavailable("The wrapping-secret file cannot be opened.");
        }
        const raw = Buffer.alloc(MAX_FILE_BYTES + 1);
        try {
            const stats = await handle.stat();
            const uid = process.getuid?.();
            if (!stats.isFile() || stats.nlink !== 1 || (stats.mode & 0o077) !== 0 || (uid !== undefined && stats.uid !== uid)) {
                throw secretUnavailable("The wrapping-secret file must be a single-link regular file owned by the APN user with mode 0600 or 0400.");
            }
            const { bytesRead } = await handle.read(raw, 0, raw.length, 0);
            if (bytesRead > MAX_FILE_BYTES)
                throw secretUnavailable("The wrapping-secret file is too large.");
            const encoded = raw.subarray(0, bytesRead).toString("utf8").trim();
            const secret = Buffer.from(encoded, "base64");
            if (secret.length !== SECRET_BYTES || secret.toString("base64") !== encoded) {
                secret.fill(0);
                throw secretUnavailable("The wrapping-secret file must hold the base64 of exactly 32 bytes.");
            }
            this.remember(secret);
            return secret;
        }
        finally {
            raw.fill(0);
            await handle.close();
        }
    }
    async create() {
        const current = await this.load();
        if (current !== null)
            return current;
        const parent = await lstat(dirname(this.path)).catch(() => null);
        if (parent === null || !parent.isDirectory())
            throw secretUnavailable("The wrapping-secret directory does not exist.");
        const generated = randomBytes(SECRET_BYTES);
        const encoded = Buffer.from(`${generated.toString("base64")}\n`, "utf8");
        let handle;
        try {
            handle = await open(this.path, constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY | constants.O_NOFOLLOW, 0o600);
            await handle.writeFile(encoded);
            await handle.sync();
        }
        catch (error) {
            generated.fill(0);
            if (codeOf(error) === "EEXIST") {
                const raced = await this.load();
                if (raced !== null)
                    return raced;
            }
            throw secretUnavailable("The wrapping-secret file could not be created.");
        }
        finally {
            encoded.fill(0);
            await handle?.close();
        }
        this.remember(generated);
        return generated;
    }
    remember(secret) {
        if (this.cached === undefined)
            this.cached = copy(secret);
    }
}
function copy(secret) {
    const result = Buffer.alloc(secret.length);
    secret.copy(result);
    return result;
}
function codeOf(error) {
    return error !== null && typeof error === "object" && "code" in error ? error.code : undefined;
}
function secretUnavailable(message) {
    return new ApnError("APN_NATIVE_REJECTED", message, { nativeCode: "APN_KEYCHAIN_UNAVAILABLE" });
}
//# sourceMappingURL=file-wrapping-secret.js.map