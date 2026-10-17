import { type LegacyStargateNativeRecord } from "./native-record.js";
import { type LegacyStargateTokenRecord } from "./token-record.js";
export type LegacyStargateFamily = "stargate_native" | "stargate_token";
export type LegacyStargateRecord = LegacyStargateNativeRecord | LegacyStargateTokenRecord;
/** Each family's journal directory: a legacy record lives where its live successors live. */
export declare const LEGACY_STARGATE_DIRECTORY: Readonly<Record<LegacyStargateFamily, string>>;
/** True for a record of a schema only an unreleased build wrote (native v1, token v1..v4). */
export declare function isLegacyStargateRecord(record: unknown): record is LegacyStargateRecord;
export declare function legacyStargateFamily(record: LegacyStargateRecord): LegacyStargateFamily;
/**
 * Read-only: the journal file as the 60b247d5^ journals loaded it (owner-only regular file in an owner-only directory
 * under the state root, never created here), then that tree's validator for its schema. Null when the file does not
 * exist or holds a schema this reader does not own (the live reader answers those).
 */
export declare function loadLegacyStargateRecord(root: string, family: LegacyStargateFamily, operationId: string): Promise<LegacyStargateRecord | null>;
