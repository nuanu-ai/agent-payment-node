import { zeroAddress } from "viem";
import { hashObject, isPlainRecord } from "../../canonical.js";
import { ApnError } from "../../errors.js";
import { assertLegacyV1Policy, fail, LEGACY_NATIVE_LANE as LANE } from "./pins.js";

export const LEGACY_NATIVE_SCHEMA = "apn.stargate-v2-native-operation.v1";
export type LegacyNativePhase = "prepared" | "approved" | "submission_started" | "submitted" | "observed" | "unknown_finality" |
  "failed_confirmed_revert";
/** The signed shape both lanes froze; only the fields a reader or the closure check reads are typed. */
export interface LegacyStargateEnvelope {
  readonly chainId: number; readonly from: string; readonly to: string; readonly nonceAtomic: string;
  readonly [field: string]: unknown;
}
interface Transition<P> { readonly phase: P; readonly at: string; readonly reason: string }

/** Native ETH from Ethereum to Unichain as an unreleased 2026-09-20 build wrote it; read-only in every APN since 0.5.45. */
export interface LegacyStargateNativeRecord {
  readonly schemaVersion: typeof LEGACY_NATIVE_SCHEMA; readonly operationId: string; readonly profile: string; readonly profileHash: string;
  readonly owner: string; readonly recipient: string; readonly expiresAt: string; readonly phase: LegacyNativePhase;
  readonly envelope: LegacyStargateEnvelope; readonly transactionHash?: string;
  readonly transitions: readonly Transition<LegacyNativePhase>[]; readonly integrityHash: string;
  readonly [field: string]: unknown;
}

/**
 * The 60b247d5^ native reader restricted to schema v1, unchanged in what it accepts: integrity seal, last transition,
 * the pinned lane, the historical all-safe finality policy (absent, or exactly the derived one), no owner policy binding
 * (v1 predates it) and the transition order. It returns the record as stored (the old reader also sealed a derived policy
 * into its in-memory copy for its runtime; nothing executes these records any more). Any other failure is corrupt state.
 */
export function validateLegacyNativeRecord(value: unknown): LegacyStargateNativeRecord {
  try { return validate(value); }
  catch (error) { if (error instanceof ApnError) throw error; return fail("record_shape"); }
}

function validate(value: unknown): LegacyStargateNativeRecord {
  if (!isPlainRecord(value) || value.schemaVersion !== LEGACY_NATIVE_SCHEMA) fail("schema");
  const raw = value as unknown as LegacyStargateNativeRecord, { integrityHash, ...body } = raw;
  if (hashObject(body) !== integrityHash || raw.transitions.at(-1)?.phase !== raw.phase || raw.operationId.length !== 64) fail("integrity");
  assertLane(raw);
  assertLegacyV1Policy(raw, LANE.sourceChain, LANE.destinationChain);
  if (raw.policy !== undefined) fail("legacy_policy_field");
  const order: LegacyNativePhase[] = ["prepared", "approved", "submission_started", "submitted", "observed"];
  for (let i = 1; i < raw.transitions.length; i++) {
    const a = raw.transitions[i - 1]!.phase, b = raw.transitions[i]!.phase;
    if (a === "failed_confirmed_revert") fail("transition");
    else if (b === "failed_confirmed_revert") { if (!["submission_started", "submitted", "unknown_finality"].includes(a)) fail("transition"); }
    else if (b === "unknown_finality") { if (!["submission_started", "submitted"].includes(a)) fail("transition"); }
    else if (a === "unknown_finality") { if (!["submitted", "observed"].includes(b)) fail("transition"); }
    else if (order.indexOf(b) < order.indexOf(a) || order.indexOf(b) > order.indexOf(a) + 1) fail("transition");
  }
  return Object.freeze(raw);
}

function assertLane(record: LegacyStargateNativeRecord): void {
  const quote = record.quote as { readonly recipient?: unknown; readonly route?: Readonly<Record<string, unknown>> } | undefined;
  const route = quote?.route;
  if (record.recipient !== record.owner || record.sourcePool !== LANE.sourcePool || record.destinationPool !== LANE.destinationPool ||
    record.sourceEid !== LANE.sourceEid || record.destinationEid !== LANE.destinationEid || record.envelope?.chainId !== LANE.sourceChain ||
    record.envelope.from !== record.owner || record.envelope.to !== LANE.sourcePool || route?.sourceChainId !== LANE.sourceChain ||
    route.destinationChainId !== LANE.destinationChain || route.sourceEid !== LANE.sourceEid || route.destinationEid !== LANE.destinationEid ||
    quote?.recipient !== record.owner || route.sourcePool !== LANE.sourcePool || route.destinationPool !== LANE.destinationPool ||
    route.sourceToken !== zeroAddress || route.destinationToken !== zeroAddress || route.asset !== "ETH") fail("legacy_lane");
}
