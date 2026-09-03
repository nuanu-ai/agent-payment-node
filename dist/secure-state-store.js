import { randomBytes } from "node:crypto";
import { constants } from "node:fs";
import { lstat, mkdir, open, realpath, rename, stat, unlink, } from "node:fs/promises";
import { dirname, isAbsolute, join, normalize, parse, relative, resolve, sep } from "node:path";
import { canonicalJson, sha256 } from "./canonical.js";
import { ApnError } from "./errors.js";
import { MacosAdvisoryLock } from "./macos-advisory-lock.js";
const FILE_MODE = 0o600;
const DIRECTORY_MODE = 0o700;
const MAX_STATE_BYTES = 1024 * 1024;
const STATE_IDENTIFIER = /^[a-f0-9]{64}$/u;
function uid() {
    const value = process.geteuid?.();
    if (value === undefined)
        throw new ApnError("APN_STATE_SECURITY", "Effective user identity is unavailable.");
    return value;
}
function permissions(stats) {
    return stats.mode & 0o777;
}
export function stateSecurity(message) {
    throw new ApnError("APN_STATE_SECURITY", message);
}
export function stateCorrupt(message) {
    throw new ApnError("APN_STATE_CORRUPT", message);
}
export function stateIdentifier(value, label) {
    if (!STATE_IDENTIFIER.test(value))
        stateSecurity(`${label} is not a canonical state identifier.`);
}
export function validateDirectory(stats, root) {
    if (!stats.isDirectory() || stats.isSymbolicLink())
        stateSecurity("State directory is not a real directory.");
    if (stats.uid !== uid())
        stateSecurity("State directory has the wrong owner.");
    if (root && permissions(stats) !== DIRECTORY_MODE)
        stateSecurity("State root must have mode 0700.");
    if (!root && (permissions(stats) & 0o077) !== 0)
        stateSecurity("State directory is accessible by another user.");
}
function validateFile(stats) {
    if (!stats.isFile() || stats.isSymbolicLink())
        stateSecurity("State entry is not a regular file.");
    if (stats.uid !== uid())
        stateSecurity("State file has the wrong owner.");
    if (permissions(stats) !== FILE_MODE)
        stateSecurity("State file must have mode 0600.");
    if (stats.nlink !== 1)
        stateSecurity("State file must have exactly one link.");
}
export function isCode(error, code) {
    return error !== null && typeof error === "object" && "code" in error && error.code === code;
}
function compareLockKeys(left, right) {
    const rank = (key) => key.startsWith("profile:") ? 0 : key.startsWith("operation:") ? 1 : 2;
    return rank(left) - rank(right) || left.localeCompare(right);
}
export class SecureStateStore {
    root;
    lockWaitMs;
    lockPort;
    constructor(root, options = {}) {
        if (!isAbsolute(root) || normalize(root) !== root || resolve(root) !== root) {
            throw new ApnError("APN_STATE_SECURITY", "State root must be a canonical absolute path.");
        }
        this.root = root;
        this.lockWaitMs = options.lockWaitMs ?? 5_000;
        if (!Number.isSafeInteger(this.lockWaitMs) || this.lockWaitMs < 0 || this.lockWaitMs > 60_000) {
            throw new ApnError("APN_STATE_SECURITY", "State lock wait must be between 0 and 60000 milliseconds.");
        }
        this.lockPort = options.lockPort ?? new MacosAdvisoryLock();
    }
    async initialize() {
        await this.assertNoSymlinkAncestors(this.root);
        try {
            await mkdir(this.root, { mode: DIRECTORY_MODE });
        }
        catch (error) {
            if (!isCode(error, "EEXIST"))
                throw error;
        }
        validateDirectory(await lstat(this.root), true);
        const canonical = await realpath(this.root);
        if (canonical !== this.root)
            stateSecurity("State root resolves through an alias or symbolic link.");
        for (const name of [
            "profiles", "wallets", "policies", "provider-authorizations", "operations", "receipts",
            "x402-operations", "x402-results", "x402-receipts", "locks",
        ]) {
            await this.ensureDirectory(name);
        }
    }
    profileHash(profile) {
        return sha256(`profile\0${profile}`);
    }
    operationId(profile, idempotencyKey) {
        return sha256(`operation\0${profile}\0${idempotencyKey}`);
    }
    idempotencyHash(idempotencyKey) {
        return sha256(`idempotency\0${idempotencyKey}`);
    }
    async withLocks(keys, action, options = {}) {
        const waitMs = options.waitMs ?? this.lockWaitMs;
        if (!Number.isSafeInteger(waitMs) || waitMs < 0 || waitMs > 300_000) {
            throw new ApnError("APN_STATE_SECURITY", "State lock wait override must be between 0 and 300000 milliseconds.");
        }
        const strictDeadline = options.waitMs !== undefined;
        const started = Date.now();
        const held = [];
        try {
            for (const key of [...new Set(keys)].sort(compareLockKeys)) {
                await this.beforeLockAcquire(key);
                const elapsed = Date.now() - started;
                if (strictDeadline && elapsed >= waitMs)
                    throw busy(waitMs);
                held.push(await this.acquireLock(key, Math.max(0, waitMs - elapsed), strictDeadline));
            }
            return await action();
        }
        finally {
            for (const lock of held.reverse())
                await this.releaseLock(lock);
        }
    }
    async beforeLockAcquire(_key) { }
    async ensureDirectory(relativePath) {
        const target = this.resolveRelative(relativePath);
        const parent = dirname(target);
        if (target !== this.root && parent !== this.root) {
            const parentRelative = relative(this.root, parent);
            if (parentRelative.length > 0)
                await this.ensureDirectory(parentRelative);
        }
        await this.assertNoSymlinkAncestors(target);
        try {
            await mkdir(target, { mode: DIRECTORY_MODE });
        }
        catch (error) {
            if (!isCode(error, "EEXIST"))
                throw error;
        }
        validateDirectory(await lstat(target), target === this.root);
    }
    resolveRelative(relativePath) {
        if (relativePath === "" || isAbsolute(relativePath))
            stateSecurity("State path must be relative.");
        const target = resolve(this.root, relativePath);
        if (!target.startsWith(`${this.root}${sep}`))
            stateSecurity("State path escapes the state root.");
        return target;
    }
    async assertNoSymlinkAncestors(target) {
        const rootPath = parse(target).root;
        const components = target.slice(rootPath.length).split(sep).filter(Boolean);
        let current = rootPath;
        for (const component of components) {
            current = join(current, component);
            try {
                const info = await lstat(current);
                if (info.isSymbolicLink())
                    stateSecurity("State path traverses a symbolic link.");
            }
            catch (error) {
                if (isCode(error, "ENOENT"))
                    return;
                throw error;
            }
        }
    }
    async readJson(relativePath) {
        const target = this.resolveRelative(relativePath);
        const parent = dirname(target);
        await this.assertNoSymlinkAncestors(target);
        let parentBefore;
        try {
            parentBefore = await stat(parent);
        }
        catch (error) {
            if (isCode(error, "ENOENT"))
                return null;
            throw error;
        }
        validateDirectory(parentBefore, parent === this.root);
        let handle;
        try {
            handle = await open(target, constants.O_RDONLY | constants.O_NOFOLLOW);
        }
        catch (error) {
            if (isCode(error, "ENOENT"))
                return null;
            if (isCode(error, "ELOOP"))
                stateSecurity("State file is a symbolic link.");
            throw error;
        }
        try {
            const info = await handle.stat();
            validateFile(info);
            const parentAfter = await stat(parent);
            if (parentAfter.dev !== parentBefore.dev || parentAfter.ino !== parentBefore.ino) {
                stateSecurity("State parent changed during a protected read.");
            }
            if (info.size > MAX_STATE_BYTES)
                stateCorrupt("State file exceeds the size limit.");
            const bytes = await handle.readFile();
            let text;
            try {
                text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
            }
            catch {
                stateCorrupt("State file is not strict UTF-8.");
            }
            let value;
            try {
                value = JSON.parse(text);
            }
            catch {
                stateCorrupt("State file is not valid JSON.");
            }
            const canonical = canonicalJson(value);
            if (text !== canonical && text !== `${canonical}\n`)
                stateCorrupt("State file is not canonical JSON.");
            return value;
        }
        finally {
            await handle.close();
        }
    }
    async writeJson(relativePath, value) {
        const target = this.resolveRelative(relativePath);
        const parent = dirname(target);
        const serialized = `${canonicalJson(value)}\n`;
        if (Buffer.byteLength(serialized, "utf8") > MAX_STATE_BYTES)
            stateCorrupt("State file exceeds the size limit.");
        await this.assertNoSymlinkAncestors(target);
        validateDirectory(await lstat(parent), parent === this.root);
        const parentBefore = await stat(parent);
        let targetBefore = null;
        try {
            targetBefore = await lstat(target);
            validateFile(targetBefore);
        }
        catch (error) {
            if (!isCode(error, "ENOENT"))
                throw error;
        }
        const temporary = join(parent, `.${sha256(target).slice(0, 12)}.${randomBytes(12).toString("hex")}.tmp`);
        const handle = await open(temporary, constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY | constants.O_NOFOLLOW, FILE_MODE);
        let writeFailure;
        try {
            await handle.writeFile(serialized, { encoding: "utf8" });
            await handle.sync();
        }
        catch (error) {
            writeFailure = error;
        }
        finally {
            await handle.close();
        }
        if (writeFailure !== undefined) {
            await unlink(temporary).catch(() => undefined);
            throw writeFailure;
        }
        try {
            const parentAfter = await stat(parent);
            if (parentAfter.dev !== parentBefore.dev || parentAfter.ino !== parentBefore.ino) {
                stateSecurity("State parent changed during an atomic write.");
            }
            if (targetBefore !== null) {
                const current = await lstat(target);
                if (current.dev !== targetBefore.dev || current.ino !== targetBefore.ino) {
                    stateSecurity("State target changed during an atomic write.");
                }
            }
            else {
                try {
                    await lstat(target);
                    stateSecurity("State target appeared during an atomic write.");
                }
                catch (error) {
                    if (!isCode(error, "ENOENT"))
                        throw error;
                }
            }
            await rename(temporary, target);
            const directory = await open(parent, constants.O_RDONLY);
            try {
                await directory.sync();
            }
            finally {
                await directory.close();
            }
            validateFile(await lstat(target));
        }
        catch (error) {
            await unlink(temporary).catch(() => undefined);
            throw error;
        }
    }
    async removeFile(relativePath) {
        const target = this.resolveRelative(relativePath);
        const parent = dirname(target);
        await this.assertNoSymlinkAncestors(target);
        let parentBefore;
        try {
            parentBefore = await stat(parent);
        }
        catch (error) {
            if (isCode(error, "ENOENT"))
                return false;
            throw error;
        }
        validateDirectory(parentBefore, parent === this.root);
        let handle;
        try {
            handle = await open(target, constants.O_RDONLY | constants.O_NOFOLLOW);
        }
        catch (error) {
            if (isCode(error, "ENOENT"))
                return false;
            if (isCode(error, "ELOOP"))
                stateSecurity("State file is a symbolic link.");
            throw error;
        }
        try {
            validateFile(await handle.stat());
            const parentAfter = await stat(parent);
            if (parentAfter.dev !== parentBefore.dev || parentAfter.ino !== parentBefore.ino) {
                stateSecurity("State parent changed during a protected delete.");
            }
            await unlink(target);
            const directory = await open(parent, constants.O_RDONLY);
            try {
                await directory.sync();
            }
            finally {
                await directory.close();
            }
            return true;
        }
        finally {
            await handle.close();
        }
    }
    async acquireLock(key, waitMs, strictDeadline) {
        const lockName = `${sha256(`lock\0${key}`)}.lock`;
        const path = this.resolveRelative(join("locks", lockName));
        const started = Date.now();
        do {
            let handle;
            try {
                handle = await open(path, constants.O_CREAT | constants.O_RDWR | constants.O_NOFOLLOW, FILE_MODE);
            }
            catch (error) {
                if (isCode(error, "ELOOP"))
                    stateSecurity("State lock file is a symbolic link.");
                throw error;
            }
            try {
                await this.validateOpenedLock(path, handle);
                const elapsed = Date.now() - started;
                if (strictDeadline && elapsed >= waitMs) {
                    await handle.close();
                    break;
                }
                const attemptTimeoutMs = Math.max(1, Math.min(1_000, waitMs - elapsed || 1));
                if (await this.lockPort.tryAcquire(handle.fd, strictDeadline ? attemptTimeoutMs : undefined, strictDeadline)) {
                    await this.validateOpenedLock(path, handle);
                    return { handle };
                }
            }
            catch (error) {
                await handle.close().catch(() => undefined);
                throw error;
            }
            await handle.close();
            const elapsed = Date.now() - started;
            if (elapsed >= waitMs)
                break;
            await new Promise((resolveDelay) => setTimeout(resolveDelay, Math.min(10, waitMs - elapsed)));
        } while (true);
        throw busy(waitMs);
    }
    async validateOpenedLock(path, handle) {
        const opened = await handle.stat();
        let current;
        try {
            current = await lstat(path);
        }
        catch (error) {
            if (isCode(error, "ENOENT"))
                stateSecurity("State lock file changed while it was open.");
            throw error;
        }
        if (current.dev !== opened.dev || current.ino !== opened.ino) {
            stateSecurity("State lock file changed while it was open.");
        }
        validateFile(opened);
        validateFile(current);
    }
    async releaseLock(lock) {
        await lock.handle.close();
    }
}
function busy(waitMs) {
    return new ApnError("APN_STATE_BUSY", `State remained busy for ${waitMs} milliseconds; retry the operation.`);
}
//# sourceMappingURL=secure-state-store.js.map