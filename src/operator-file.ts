import { constants, type Stats } from "node:fs";
import { open, type FileHandle } from "node:fs/promises";

/** What a directory entry is when it is not a regular file, for a refusal that names it; null for a regular file. */
export type NonRegularFileType = "fifo" | "device" | "socket" | "directory" | "symbolic_link" | "other";

export function nonRegularFileType(info: Stats): NonRegularFileType | null {
  if (info.isFile()) return null;
  if (info.isFIFO()) return "fifo";
  if (info.isCharacterDevice() || info.isBlockDevice()) return "device";
  if (info.isSocket()) return "socket";
  if (info.isDirectory()) return "directory";
  return info.isSymbolicLink() ? "symbolic_link" : "other";
}

/** The entry type in a refusal message: "a FIFO", "a device", …. */
export function nonRegularFileLabel(type: NonRegularFileType): string {
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
export async function openExpectedRegularFile(path: string, expected: Stats): Promise<FileHandle | null> {
  if (!expected.isFile()) return null;
  const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  let opened: Stats;
  try { opened = await handle.stat(); }
  catch (error) { await handle.close(); throw error; }
  if (opened.isFile() && opened.dev === expected.dev && opened.ino === expected.ino) return handle;
  await handle.close();
  return null;
}
