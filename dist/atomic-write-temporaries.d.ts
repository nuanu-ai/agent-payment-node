import type { Dirent, Stats } from "node:fs";
/**
 * A live writer holds its unpublished stage only for one local write, fsync and rename (milliseconds, with no
 * network I/O in between). An unpublished stage older than this belongs to an interrupted writer.
 */
export declare const ORPHAN_TEMPORARY_AGE_MS: number;
export declare function atomicTemporaryPrefix(target: string): string;
export declare function isAtomicTemporaryName(name: string): boolean;
/**
 * Directory listings return records only. An abandoned unpublished stage (one link, older than
 * ORPHAN_TEMPORARY_AGE_MS, owned by this user) is unlinked; any other staged name is skipped untouched.
 * Unlinking a stage never changes a record: the target still holds its previous committed bytes.
 */
export declare function withoutAtomicTemporaries(directory: string, entries: readonly Dirent[], nowMs: number): Promise<readonly Dirent[]>;
/**
 * A create-only publication links the stage to the target before unlinking the stage. An exit in between leaves
 * the committed target with two links: itself and its own stage in the same directory. Only that exact pair
 * (same device and inode, stage name derived from this target path) is repaired by unlinking the stage.
 * Returns whether the target now has its single link back.
 */
export declare function releasePublishedTemporary(target: string, targetInfo: Stats): Promise<boolean>;
