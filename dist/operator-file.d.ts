import { type Stats } from "node:fs";
import { type FileHandle } from "node:fs/promises";
/** What a directory entry is when it is not a regular file, for a refusal that names it; null for a regular file. */
export type NonRegularFileType = "fifo" | "device" | "socket" | "directory" | "symbolic_link" | "other";
export declare function nonRegularFileType(info: Stats): NonRegularFileType | null;
/** The entry type in a refusal message: "a FIFO", "a device", …. */
export declare function nonRegularFileLabel(type: NonRegularFileType): string;
/**
 * Opens, for reading, the regular file an operator named and the caller already `lstat`ed as `expected`. A FIFO, device,
 * socket or directory is refused from that `lstat` before any open. O_NONBLOCK keeps an entry swapped in after it from
 * blocking the open (a FIFO opened for reading waits for a writer without it) and O_NOFOLLOW refuses a final link; the
 * opened descriptor must then be that same regular file (device and inode). Reads of a regular file ignore O_NONBLOCK.
 * Null when the opened entry is not that file; open errors are thrown unchanged for the caller to classify.
 */
export declare function openExpectedRegularFile(path: string, expected: Stats): Promise<FileHandle | null>;
