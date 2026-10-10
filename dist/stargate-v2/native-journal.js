import { lstat, mkdir, open, readFile, realpath, rename } from "node:fs/promises";
import { dirname, join, relative } from "node:path";
import { canonicalJson } from "../canonical.js";
import { StateStore } from "../state.js";
import { address, fail, validateRecord, validateAdvance } from "./native-record.js";
export class FileStargateNativeJournal {
    root;
    locks;
    constructor(root, locks) {
        this.root = root;
        this.locks = locks ?? new StateStore(root, { lockWaitMs: 0 });
    }
    path(id) {
        if (!/^[a-f0-9]{64}$/u.test(id))
            fail("APN_STATE_CORRUPT", "operation_id");
        return join(this.root, "stargate-v2-native", `${id}.json`);
    }
    async withLock(id, work) {
        await this.locks.initialize();
        return await this.locks.withLocks([`stargate-native:${id}`], work, { waitMs: 30_000 });
    }
    async withOwnerChainLock(owner, chainId, work) {
        await this.locks.initialize();
        return await this.locks.withLocks([`stargate-source:${chainId}:${address(owner).toLowerCase()}`], work, { waitMs: 30_000 });
    }
    async load(id) {
        try {
            const path = this.path(id);
            await secureDirectory(dirname(path), false);
            const info = await lstat(path);
            if (!info.isFile() || info.isSymbolicLink() || (info.mode & 0o077) !== 0)
                fail("APN_STATE_CORRUPT", "journal_file_mode");
            return validateRecord(JSON.parse(await readFile(path, "utf8")));
        }
        catch (error) {
            if (error.code === "ENOENT")
                return null;
            throw error;
        }
    }
    async save(nextInput) {
        const next = validateRecord(nextInput), path = this.path(next.operationId), previous = await this.load(next.operationId);
        validateAdvance(previous, next);
        const directory = dirname(path);
        await secureDirectory(directory);
        const temp = `${path}.${process.pid}.${Date.now()}.tmp`, handle = await open(temp, "wx", 0o600);
        try {
            await handle.writeFile(`${canonicalJson(next)}\n`);
            await handle.sync();
        }
        finally {
            await handle.close();
        }
        await rename(temp, path);
        const dir = await open(directory, "r");
        try {
            await dir.sync();
        }
        finally {
            await dir.close();
        }
    }
}
async function secureDirectory(directory, create = true) {
    if (create)
        await mkdir(directory, { recursive: true, mode: 0o700 });
    const info = await lstat(directory);
    if (!info.isDirectory() || info.isSymbolicLink() || (info.mode & 0o077) !== 0)
        fail("APN_STATE_CORRUPT", "journal_directory_mode");
    const resolved = await realpath(directory), parent = await realpath(dirname(directory));
    if (relative(parent, resolved).startsWith(".."))
        fail("APN_STATE_CORRUPT", "journal_path");
}
//# sourceMappingURL=native-journal.js.map