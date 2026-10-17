import { canonicalJson, hashObject, isPlainRecord } from "../../canonical.js";
import { ApnError } from "../../errors.js";
import type { LegacyStargateEnvelope } from "./native-record.js";
import { assertLegacyV1Policy, assertPinnedPolicy, fail, LEGACY_TOKEN_LANE as LANE, LEGACY_TOKEN_MECHANISM, UINT } from "./pins.js";

export const LEGACY_TOKEN_SCHEMAS = ["apn.stargate-v2-token-operation.v1", "apn.stargate-v2-token-operation.v2",
  "apn.stargate-v2-token-operation.v3", "apn.stargate-v2-token-operation.v4"] as const;
export type LegacyTokenPhase = "prepared" | "approved" | "allowance_submission_started" | "allowance_unknown_finality" |
  "allowance_submitted" | "allowance_observed" | "post_approval_quote_bound" | "submission_started" | "unknown_finality" | "submitted" |
  "observed" | "cleanup_required" | "cleanup_submission_started" | "cleanup_submitted" | "cleanup_unknown_finality" | "cleaned";
const USAGE_STATES: readonly unknown[] = ["reserved", "submitted", "unknown_finality", "finalized", "failed_before_effect", "failed_confirmed_revert"];

/** Optimism USDC to Polygon USDC as an unreleased 2026-09-20 build wrote it; read-only in every APN since 0.5.45. */
export interface LegacyStargateTokenRecord {
  readonly schemaVersion: typeof LEGACY_TOKEN_SCHEMAS[number]; readonly operationId: string; readonly profile: string;
  readonly profileHash: string; readonly owner: string; readonly recipient: string; readonly expiresAt: string; readonly phase: LegacyTokenPhase;
  readonly approvalEnvelope?: LegacyStargateEnvelope; readonly sendEnvelope: LegacyStargateEnvelope; readonly cleanupEnvelope?: LegacyStargateEnvelope;
  readonly approvalTransactionHash?: string; readonly transactionHash?: string; readonly cleanupTransactionHash?: string;
  readonly transitions: readonly { readonly phase: LegacyTokenPhase; readonly at: string; readonly reason: string }[];
  readonly integrityHash: string;
  readonly [field: string]: unknown;
}
type Fees = Readonly<Record<"provenance" | "quotedMaxFeePerGasWei" | "quotedMaxPriorityFeePerGasWei" | "approvedMaxFeePerGasWei" |
  "approvedMaxPriorityFeePerGasWei", string>>;
type Simulation = Readonly<Record<"mode" | "prepareStatus" | "gasCeilingAtomic", string>>;

/**
 * The 60b247d5^ token reader restricted to schemas v1..v4, unchanged in what it accepts: integrity seal, the v1 lane and
 * historical all-safe policy or the pinned policy, the v3/v4 bridge-simulation binding, the v4 fee approval, none of the v5
 * approval-finality fields, usage states, the mechanism pin, cleanup markers and the transition table. The record is
 * returned as stored. Any other failure is corrupt state.
 */
export function validateLegacyTokenRecord(value: unknown): LegacyStargateTokenRecord {
  try { return validate(value); }
  catch (error) { if (error instanceof ApnError) throw error; return fail("record_shape"); }
}

function validate(value: unknown): LegacyStargateTokenRecord {
  if (!isPlainRecord(value) || !(LEGACY_TOKEN_SCHEMAS as readonly unknown[]).includes(value.schemaVersion)) fail("schema");
  const raw = value as unknown as LegacyStargateTokenRecord, { integrityHash, ...body } = raw;
  if (hashObject(body) !== integrityHash || raw.transitions.at(-1)?.phase !== raw.phase || raw.operationId.length !== 64) fail("integrity");
  if (raw.schemaVersion === "apn.stargate-v2-token-operation.v1") { assertLane(raw); assertLegacyV1Policy(raw, LANE.sourceChain, LANE.destinationChain); }
  else assertPinnedPolicy(raw, LANE.sourceChain, LANE.destinationChain);
  if (raw.schemaVersion === "apn.stargate-v2-token-operation.v3" || raw.schemaVersion === "apn.stargate-v2-token-operation.v4") {
    assertSimulation(raw);
    if (raw.schemaVersion === "apn.stargate-v2-token-operation.v4") assertFees(raw);
    else if (raw.feeApproval !== undefined) fail("legacy_fee_approval_field");
  } else if (raw.bridgeSimulation !== undefined || raw.feeApproval !== undefined) fail("legacy_simulation_field");
  if (raw.approvalFinalityWindowMs !== undefined || raw.approvalSubmissionStartedAt !== undefined ||
    raw.approvalFinalityDeadline !== undefined || raw.postApprovalQuote !== undefined) fail("legacy_approval_finality_field");
  if ((raw.usageState !== undefined && !USAGE_STATES.includes(raw.usageState)) || (raw.usageTarget !== undefined && !USAGE_STATES.includes(raw.usageTarget))) fail("usage_state");
  if (canonicalJson((raw.policy as { readonly mechanism: unknown }).mechanism) !== canonicalJson(LEGACY_TOKEN_MECHANISM)) fail("mechanism_pin");
  if (["cleanup_submission_started", "cleanup_submitted", "cleanup_unknown_finality"].includes(raw.phase) &&
    (raw.cleanupEnvelope === undefined || raw.cleanupTransactionHash === undefined)) fail("cleanup_marker");
  if (raw.phase === "cleaned" && raw.cleanupTransactionHash !== undefined && raw.cleanupEnvelope === undefined) fail("cleanup_marker");
  if (raw.phase === "cleaned" && raw.residualAllowanceAtomic !== "0") fail("cleanup_residual");
  const allowed: Readonly<Partial<Record<LegacyTokenPhase, readonly LegacyTokenPhase[]>>> = {
    prepared: ["approved"], approved: ["allowance_submission_started", "submission_started", "cleanup_required"],
    allowance_submission_started: ["allowance_submitted", "allowance_unknown_finality", "cleanup_required"],
    allowance_submitted: ["allowance_unknown_finality", "allowance_observed", "cleanup_required"], allowance_unknown_finality: ["allowance_observed", "cleanup_required"],
    allowance_observed: ["post_approval_quote_bound", "submission_started", "cleanup_required"], post_approval_quote_bound: ["submission_started", "cleanup_required"],
    submission_started: ["submitted", "unknown_finality", "cleanup_required"],
    submitted: ["unknown_finality", "observed", "cleanup_required"], unknown_finality: ["submitted", "observed", "cleanup_required"], observed: [],
    cleanup_required: ["cleanup_submission_started", "cleaned", "observed"], cleanup_submission_started: ["cleanup_submitted", "cleanup_unknown_finality"],
    cleanup_submitted: ["cleanup_unknown_finality", "cleaned", "observed"], cleanup_unknown_finality: ["cleaned", "observed"], cleaned: [],
  };
  if (raw.transitions[0]?.phase !== "prepared") fail("transition");
  for (let i = 1; i < raw.transitions.length; i++) if (!allowed[raw.transitions[i - 1]!.phase]?.includes(raw.transitions[i]!.phase)) fail("transition");
  return Object.freeze(raw);
}

function assertSimulation(raw: LegacyStargateTokenRecord): void {
  const simulation = raw.bridgeSimulation as Simulation | undefined, approval = raw.approvalEnvelope, send = raw.sendEnvelope;
  const approvalDebit = approval === undefined ? 0n : BigInt(approval.gasLimitAtomic as string) * BigInt(approval.maxFeePerGasAtomic as string);
  const totalDebit = approvalDebit + BigInt(send.valueAtomic as string) + BigInt(send.gasLimitAtomic as string) * BigInt(send.maxFeePerGasAtomic as string);
  if (simulation === undefined || simulation.gasCeilingAtomic !== send.gasLimitAtomic || BigInt(simulation.gasCeilingAtomic) < 1n ||
    BigInt(simulation.gasCeilingAtomic) > LANE.maxBridgeGas || totalDebit.toString() !== raw.maximumDebitAtomic || totalDebit > BigInt(raw.maxNativeDebitAtomic as string) ||
    (raw.allowanceRequired ? simulation.mode !== "pending_post_approval" || simulation.prepareStatus !== "pending_post_approval" ||
      raw.initialAllowanceAtomic !== "0" || approval === undefined || BigInt(send.nonceAtomic) !== BigInt(approval.nonceAtomic) + 1n ||
      send.maxFeePerGasAtomic !== approval.maxFeePerGasAtomic || send.maxPriorityFeePerGasAtomic !== approval.maxPriorityFeePerGasAtomic
      : simulation.mode !== "exact_at_prepare" || simulation.prepareStatus !== "succeeded" || raw.initialAllowanceAtomic !== raw.amountAtomic ||
        approval !== undefined)) fail("bridge_simulation_binding");
}

function assertFees(raw: LegacyStargateTokenRecord): void {
  const fees = raw.feeApproval as Fees | undefined, send = raw.sendEnvelope, approval = raw.approvalEnvelope;
  const stored = (input: unknown, positive = false) => typeof input === "string" && UINT.test(input) && BigInt(input) < 1n << 256n && (!positive || BigInt(input) > 0n);
  if (fees === undefined || !["exact_snapshot", "owner_ceiling"].includes(fees.provenance) ||
    !stored(fees.quotedMaxFeePerGasWei, true) || !stored(fees.quotedMaxPriorityFeePerGasWei) ||
    !stored(fees.approvedMaxFeePerGasWei, true) || !stored(fees.approvedMaxPriorityFeePerGasWei) ||
    BigInt(fees.quotedMaxPriorityFeePerGasWei) > BigInt(fees.quotedMaxFeePerGasWei) ||
    BigInt(fees.quotedMaxFeePerGasWei) > BigInt(fees.approvedMaxFeePerGasWei) ||
    BigInt(fees.quotedMaxPriorityFeePerGasWei) > BigInt(fees.approvedMaxPriorityFeePerGasWei) ||
    BigInt(fees.approvedMaxPriorityFeePerGasWei) > BigInt(fees.approvedMaxFeePerGasWei) ||
    send.maxFeePerGasAtomic !== fees.approvedMaxFeePerGasWei || send.maxPriorityFeePerGasAtomic !== fees.approvedMaxPriorityFeePerGasWei ||
    (approval !== undefined && (approval.maxFeePerGasAtomic !== fees.approvedMaxFeePerGasWei || approval.maxPriorityFeePerGasAtomic !== fees.approvedMaxPriorityFeePerGasWei)) ||
    (fees.provenance === "exact_snapshot" && (fees.quotedMaxFeePerGasWei !== fees.approvedMaxFeePerGasWei ||
      fees.quotedMaxPriorityFeePerGasWei !== fees.approvedMaxPriorityFeePerGasWei))) fail("fee_approval_binding");
}

function assertLane(record: LegacyStargateTokenRecord): void {
  const quote = record.quote as { readonly recipient?: unknown; readonly route?: Readonly<Record<string, unknown>> } | undefined;
  const route = quote?.route, approval = record.approvalEnvelope, cleanup = record.cleanupEnvelope, send = record.sendEnvelope;
  const onSourceToken = (envelope: LegacyStargateEnvelope | undefined) => envelope === undefined ||
    envelope.chainId === LANE.sourceChain && envelope.from === record.owner && envelope.to === LANE.sourceToken;
  if (record.recipient !== record.owner || record.sourceToken !== LANE.sourceToken || record.destinationToken !== LANE.destinationToken ||
    record.sourcePool !== LANE.sourcePool || record.destinationPool !== LANE.destinationPool || record.sourceEid !== LANE.sourceEid ||
    record.destinationEid !== LANE.destinationEid || record.executor !== LANE.sourceExecutor || send?.chainId !== LANE.sourceChain ||
    send.from !== record.owner || send.to !== LANE.sourcePool || !onSourceToken(approval) || !onSourceToken(cleanup) ||
    route?.sourceChainId !== LANE.sourceChain || route?.destinationChainId !== LANE.destinationChain || route?.sourceEid !== LANE.sourceEid ||
    route?.destinationEid !== LANE.destinationEid || route?.sourcePool !== LANE.sourcePool || route?.destinationPool !== LANE.destinationPool ||
    route?.sourceToken !== LANE.sourceToken || route?.destinationToken !== LANE.destinationToken || quote?.recipient !== record.owner ||
    route?.asset !== "USDC") fail("legacy_lane");
}
