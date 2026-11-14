import { constants } from "node:fs";
import { open } from "node:fs/promises";
export function nonRegularFileType(info) {
    if (info.isFile())
        return null;
    if (info.isFIFO())
        return "fifo";
    if (info.isCharacterDevice() || info.isBlockDevice())
        return "device";
    if (info.isSocket())
        return "socket";
    if (info.isDirectory())
        return "directory";
    return info.isSymbolicLink() ? "symbolic_link" : "other";
}
/** The entry type in a refusal message: "a FIFO", "a device", …. */
export function nonRegularFileLabel(type) {
    return { fifo: "a FIFO", device: "a device", socket: "a socket", directory: "a directory", symbolic_link: "a symbolic link",
        other: "a special file" }[type];
}
/**
 * Opens, for reading, the regular file an operator named and the caller already `lstat`ed as `expected`. A FIFO, device,
 * socket or directory is refused from that `lstat` before any open. O_NONBLOCK keeps an entry swapped in after it from
 * blocking the open (a FIFO opened for reading waits for a writer without it) and O_NOFOLLOW refuses a final link; the
 * opened descriptor must then be that same regular file (device and inode). Reads of a regular file ignore O_NONBLOCK.
 * Null when the opened entry is not that file; open errors are thrown unchanged for the caller to classify.
 */
export async function openExpectedRegularFile(path, expected) {
    if (!expected.isFile())
        return null;
    const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
    let opened;
    try {
        opened = await handle.stat();
    }
    catch (error) {
        await handle.close();
        throw error;
    }
    if (opened.isFile() && opened.dev === expected.dev && opened.ino === expected.ino)
        return handle;
    await handle.close();
    return null;
}
//# sourceMappingURL=operator-file.js.map