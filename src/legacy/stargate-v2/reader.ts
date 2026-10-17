import { lstat, readFile, realpath } from "node:fs/promises";
import { dirname, join, relative } from "node:path";
import { isPlainRecord } from "../../canonical.js";
import { LEGACY_NATIVE_SCHEMA, validateLegacyNativeRecord, type LegacyStargateNativeRecord } from "./native-record.js";
import { fail } from "./pins.js";
import { LEGACY_TOKEN_SCHEMAS, validateLegacyTokenRecord, type LegacyStargateTokenRecord } from "./token-record.js";

export type LegacyStargateFamily = "stargate_native" | "stargate_token";
export type LegacyStargateRecord = LegacyStargateNativeRecord | LegacyStargateTokenRecord;
/** Each family's journal directory: a legacy record lives where its live successors live. */
export const LEGACY_STARGATE_DIRECTORY: Readonly<Record<LegacyStargateFamily, string>> = Object.freeze({
  stargate_native: "stargate-v2-native", stargate_token: "stargate-v2-token" });
const SCHEMAS: Readonly<Record<LegacyStargateFamily, readonly string[]>> = Object.freeze({
  stargate_native: [LEGACY_NATIVE_SCHEMA], stargate_token: LEGACY_TOKEN_SCHEMAS });

/** True for a record of a schema only an unreleased build wrote (native v1, token v1..v4). */
export function isLegacyStargateRecord(record: unknown): record is LegacyStargateRecord {
  return isPlainRecord(record) && ([...SCHEMAS.stargate_native, ...SCHEMAS.stargate_token] as readonly unknown[]).includes(record.schemaVersion);
}
export function legacyStargateFamily(record: LegacyStargateRecord): LegacyStargateFamily {
  return record.schemaVersion === LEGACY_NATIVE_SCHEMA ? "stargate_native" : "stargate_token";
}

/**
 * Read-only: the journal file as the 60b247d5^ journals loaded it (owner-only regular file in an owner-only directory
 * under the state root, never created here), then that tree's validator for its schema. Null when the file does not
 * exist or holds a schema this reader does not own (the live reader answers those).
 */
export async function loadLegacyStargateRecord(root: string, family: LegacyStargateFamily, operationId: string): Promise<LegacyStargateRecord | null> {
  if (!/^[a-f0-9]{64}$/u.test(operationId)) fail("operation_id");
  const directory = join(root, LEGACY_STARGATE_DIRECTORY[family]), path = join(directory, `${operationId}.json`);
  let text: string;
  try {
    const folder = await lstat(directory);
    if (!folder.isDirectory() || folder.isSymbolicLink() || (folder.mode & 0o077) !== 0) fail("journal_directory_mode");
    if (relative(await realpath(dirname(directory)), await realpath(directory)).startsWith("..")) fail("journal_path");
    const info = await lstat(path);
    if (!info.isFile() || info.isSymbolicLink() || (info.mode & 0o077) !== 0) fail("journal_file_mode");
    text = await readFile(path, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
  let value: unknown;
  try { value = JSON.parse(text); } catch { return fail("record_not_json"); }
  if (!isPlainRecord(value) || !SCHEMAS[family].includes(String(value.schemaVersion))) return null;
  return family === "stargate_native" ? validateLegacyNativeRecord(value) : validateLegacyTokenRecord(value);
}
