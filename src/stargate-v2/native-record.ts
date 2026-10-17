import { getAddress, zeroAddress, type Hex } from "viem";
import { canonicalJson, hashObject, isPlainRecord } from "../canonical.js";
import { ApnError } from "../errors.js";
import type { Address } from "../model.js";
import { assertStargateV2RouteFinalityPolicy, type StargateV2RouteFinalityPolicy } from "./finality-policy.js";
import type { StargateNativeOperation, StargateNativePhase, StargateSourceReceipt, StargateDestinationEvidence } from "./native-execution.js";

export const SOURCE_CHAIN = 1 as const;
export const DESTINATION_CHAIN = 130 as const;
export const SOURCE_EID = 30101 as const;
export const DESTINATION_EID = 30320 as const;
export const SOURCE_POOL = getAddress("0x77b2043768d28E9C9aB44E1aBfC95944bcE57931");
export const DESTINATION_POOL = getAddress("0xe9aBA835f813ca05E50A6C0ce65D0D74390F7dE7");
const UINT = /^(?:0|[1-9][0-9]{0,77})$/u;
export const HASH = /^0x[0-9a-f]{64}$/u;
export const CODE = /^0x(?:[0-9a-f]{2})+$/u;
export const MAX_TTL_MS = 120_000;
/** Owner admission pin for this exact native lane, in the same provider/reference form as the token lane. */
export const STARGATE_NATIVE_MECHANISM = Object.freeze({ provider: "stargate-v2",
  reference: `eip155:${SOURCE_CHAIN}:${SOURCE_POOL}/eip155:${DESTINATION_CHAIN}:${DESTINATION_POOL}` });
/** v2 (0.5.25..) and v3 (admission-bound) are the only native schemas any release wrote. */
export const STARGATE_NATIVE_SCHEMAS = ["apn.stargate-v2-native-operation.v2", "apn.stargate-v2-native-operation.v3"] as const;

export function fail(code: "APN_INVALID_INPUT" | "APN_OPERATION_BLOCKED" | "APN_RPC_PROTOCOL" | "APN_RPC_AMBIGUOUS" |
  "APN_CHAIN_MISMATCH" | "APN_REPREPARE_REQUIRED" | "APN_STATE_CORRUPT", reason: string): never {
  throw new ApnError(code, `Direct Stargate V2 native execution failed closed: ${reason}.`, { reason });
}
export function uint(value: unknown, positive = false): bigint {
  if (typeof value !== "string" || !UINT.test(value)) return fail("APN_INVALID_INPUT", "noncanonical_uint");
  const n = BigInt(value); if (n >= 1n << 256n || (positive && n === 0n)) return fail("APN_INVALID_INPUT", "uint_range"); return n;
}
export function address(value: unknown): Address {
  try { const result = getAddress(value as string); if (result === zeroAddress) throw new Error("zero"); return result; }
  catch { return fail("APN_INVALID_INPUT", "address"); }
}
export function hex32(value: unknown): Hex {
  if (typeof value !== "string" || !HASH.test(value)) return fail("APN_RPC_PROTOCOL", "hash"); return value as Hex;
}
export function rpcQuantity(value: unknown): bigint {
  if (typeof value !== "string" || !/^0x(?:0|[1-9a-f][0-9a-f]*)$/u.test(value)) return fail("APN_RPC_PROTOCOL", "quantity");
  return BigInt(value);
}

export function transition(operation: StargateNativeOperation, phase: StargateNativePhase, reason: string, at: number): StargateNativeOperation {
  return seal({ ...operation, phase, transitions: [...operation.transitions, { phase, at: new Date(at).toISOString(), reason }] });
}
export function seal<T extends Omit<StargateNativeOperation, "integrityHash"> & { integrityHash?: never } | StargateNativeOperation>(value: T): StargateNativeOperation {
  const { integrityHash: _old, ...body } = value as StargateNativeOperation; return Object.freeze({ ...body, integrityHash: hashObject(body) }) as StargateNativeOperation;
}
export function validateRecord(value: unknown): StargateNativeOperation {
  if (!isPlainRecord(value) || !(STARGATE_NATIVE_SCHEMAS as readonly string[]).includes(String(value.schemaVersion))) fail("APN_STATE_CORRUPT", "schema");
  const raw = value as unknown as StargateNativeOperation, { integrityHash, ...body } = raw;
  if (hashObject(body) !== integrityHash || raw.transitions.at(-1)?.phase !== raw.phase || raw.operationId.length !== 64) fail("APN_STATE_CORRUPT", "integrity");
  const record = raw;
  assertStargateV2RouteFinalityPolicy(raw.finalityPolicy, SOURCE_CHAIN, DESTINATION_CHAIN);
  if (raw.finalityPolicyProvenance !== "pinned_v2") fail("APN_STATE_CORRUPT", "finality_policy_provenance");
  // v3 binds owner admission at prepare; v2 was written before the native lane reserved usage.
  if (raw.schemaVersion === "apn.stargate-v2-native-operation.v3") assertPolicyBinding(raw.policy);
  else if (raw.policy !== undefined) fail("APN_STATE_CORRUPT", "legacy_policy_field");
  const order: StargateNativePhase[] = ["prepared", "approved", "submission_started", "submitted", "observed"];
  for (let i = 1; i < record.transitions.length; i++) {
    const a = record.transitions[i - 1]!.phase, b = record.transitions[i]!.phase;
    if (a === "failed_confirmed_revert") fail("APN_STATE_CORRUPT", "transition");
    else if (b === "failed_confirmed_revert") { if (!["submission_started", "submitted", "unknown_finality"].includes(a)) fail("APN_STATE_CORRUPT", "transition"); }
    else if (b === "unknown_finality") { if (!["submission_started", "submitted"].includes(a)) fail("APN_STATE_CORRUPT", "transition"); }
    else if (a === "unknown_finality") { if (!["submitted", "observed"].includes(b)) fail("APN_STATE_CORRUPT", "transition"); }
    else if (order.indexOf(b) < order.indexOf(a) || order.indexOf(b) > order.indexOf(a) + 1) fail("APN_STATE_CORRUPT", "transition");
  }
  return record;
}
function assertPolicyBinding(policy: unknown): void {
  const binding = policy as StargateNativeOperation["policy"];
  if (!isPlainRecord(policy) || Object.keys(policy).sort().join() !== "mechanism,policyDigest,policyRevision" || typeof binding?.policyDigest !== "string" ||
    !/^[a-f0-9]{64}$/u.test(binding.policyDigest) || !Number.isSafeInteger(binding.policyRevision) || binding.policyRevision < 1 ||
    !isPlainRecord(binding.mechanism) || Object.keys(binding.mechanism).sort().join() !== "provider,reference" ||
    typeof binding.mechanism.provider !== "string" || typeof binding.mechanism.reference !== "string") fail("APN_STATE_CORRUPT", "policy_binding");
}
export function validateAdvance(previous: StargateNativeOperation | null, next: StargateNativeOperation): void {
  if (previous === null) { if (next.phase !== "prepared" || next.transitions.length !== 1) fail("APN_STATE_CORRUPT", "initial_state"); return; }
  const frozen = (x: StargateNativeOperation) => { const { phase: _p, transitions: _t, integrityHash: _i, transactionHash: _h, guid: _g,
    sourceReceipt: _s, destinationEvidence: _d, ...rest } = x; return rest; };
  if (canonicalJson(frozen(previous)) !== canonicalJson(frozen(next)) || next.transitions.length < previous.transitions.length ||
    canonicalJson(next.transitions.slice(0, previous.transitions.length)) !== canonicalJson(previous.transitions) ||
    (previous.transactionHash !== undefined && previous.transactionHash !== next.transactionHash)) fail("APN_STATE_CORRUPT", "journal_rewrite");
}

export interface StargateNativeCanonicalReceipt {
  readonly schemaVersion: "apn.stargate-v2-native-receipt.v1"; readonly operationId: string; readonly profile: string;
  readonly route: Readonly<{ sourceChainId: 1; sourceEid: 30101; sourcePool: Address; destinationChainId: 130;
    destinationEid: 30320; destinationPool: Address }>;
  readonly owner: Address; readonly recipient: Address; readonly principalAtomic: string; readonly nativeMessageFeeAtomic: string;
  readonly finalityPolicy: StargateV2RouteFinalityPolicy;
  readonly totalValueAtomic: string; readonly maximumDebitAtomic: string; readonly quoteHash: string;
  readonly source: StargateSourceReceipt; readonly destination: StargateDestinationEvidence; readonly evidenceHash: string;
}

export function stargateV2NativeCanonicalReceipt(operationInput: StargateNativeOperation): StargateNativeCanonicalReceipt {
  const operation = validateRecord(operationInput);
  if (operation.phase !== "observed" || operation.sourceReceipt === undefined || operation.destinationEvidence === undefined) {
    fail("APN_OPERATION_BLOCKED", "receipt_not_observed");
  }
  const body = { schemaVersion: "apn.stargate-v2-native-receipt.v1" as const, operationId: operation.operationId,
    profile: operation.profile, route: { sourceChainId: SOURCE_CHAIN, sourceEid: SOURCE_EID, sourcePool: SOURCE_POOL,
      destinationChainId: DESTINATION_CHAIN, destinationEid: DESTINATION_EID, destinationPool: DESTINATION_POOL },
    owner: operation.owner, recipient: operation.recipient, principalAtomic: operation.amountAtomic, finalityPolicy: operation.finalityPolicy,
    nativeMessageFeeAtomic: operation.quote.quote.nativeMessageFeeAtomic, totalValueAtomic: operation.totalValueAtomic,
    maximumDebitAtomic: operation.maximumDebitAtomic, quoteHash: operation.quote.quoteHash,
    source: operation.sourceReceipt, destination: operation.destinationEvidence };
  return Object.freeze({ ...body, evidenceHash: hashObject(body) });
}
