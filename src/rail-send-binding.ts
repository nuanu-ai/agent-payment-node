import { exactKeys, isPlainRecord } from "./canonical.js";
import { atomic, isoDate } from "./chain-policy.js";
import type { RailPreparedTransfer, RailSendBinding, RailSimulationEvidence } from "./direct-rail-ports.js";
import { ApnError } from "./errors.js";

/**
 * How long the owner may read the approval screen. This is the approval deadline only: the sending
 * window opens afterwards, when the send guard re-acquires the block reference.
 */
export const SOLANA_APPROVAL_WINDOW_MS = 240_000;

/**
 * A re-acquired Solana block reference must still leave this many blocks when the send guard takes
 * it. At roughly 400 ms per slot that is about the 15 s the bridge rail already demands, and a
 * freshly returned blockhash leaves about 150, so only a stale RPC answer is refused.
 */
export const SOLANA_MIN_SEND_BLOCKS = 38n;

/** A transient pre-send check is re-run inside the owner's approved window, never past its end. */
export const RAIL_PRESEND_ATTEMPTS = 4;
export const RAIL_PRESEND_RETRY_MS = 5_000;
/** The last attempt must still leave enough of the approval window to acquire a window and send. */
export const RAIL_PRESEND_MIN_REMAINING_MS = 15_000;

const HASH = /^[a-f0-9]{64}$/u;
const BLOCK_REFERENCE = /^[A-Za-z0-9]{32,128}$/u;

export function validateRailSendBinding(value: unknown, prepared: RailPreparedTransfer): RailSendBinding {
  if (!isPlainRecord(value) || !exactKeys(value, ["blockReference", "lastValidBlockHeight", "observedBlockHeight", "acquiredAt", "simulation"])) corrupt();
  if (prepared.rail !== "solana" || prepared.lastValidBlockHeight === null) corrupt();
  if (typeof value.blockReference !== "string" || !BLOCK_REFERENCE.test(value.blockReference)) corrupt();
  const lastValid = atomic(value.lastValidBlockHeight, true); const observed = atomic(value.observedBlockHeight, true);
  // The re-acquired window must open later than the frozen one and must not already be closing.
  if (lastValid < atomic(prepared.lastValidBlockHeight) || lastValid - observed < SOLANA_MIN_SEND_BLOCKS) corrupt();
  isoDate(value.acquiredAt);
  if (value.acquiredAt < prepared.preparedAt || value.acquiredAt > prepared.expiresAt) corrupt();
  validateRailSimulation(value.simulation);
  return value as unknown as RailSendBinding;
}

function validateRailSimulation(value: unknown): asserts value is RailSimulationEvidence {
  if (!isPlainRecord(value) || !exactKeys(value, ["outcome", "slotAtomic", "unitsConsumedAtomic", "signatureVerified", "payloadHash"])) corrupt();
  if (value.outcome !== "would_succeed" || value.signatureVerified !== false) corrupt();
  atomic(value.slotAtomic, true); atomic(value.unitsConsumedAtomic);
  if (typeof value.payloadHash !== "string" || !HASH.test(value.payloadHash)) corrupt();
}

/**
 * The lifetime the signed bytes actually carry: the re-acquired one once the send guard has run,
 * and otherwise the preparation-time one, which is all a rail without a send guard ever had.
 */
export function railSendLifetime(prepared: RailPreparedTransfer, send: RailSendBinding | null | undefined): {
  readonly blockReference: string;
  readonly lastValidBlockHeight: string | null;
} {
  return send === null || send === undefined
    ? { blockReference: prepared.blockReference, lastValidBlockHeight: prepared.lastValidBlockHeight }
    : { blockReference: send.blockReference, lastValidBlockHeight: send.lastValidBlockHeight };
}

/** Pre-send failures carry their own reason token so a transport loss never reads as a refusal. */
export function railSendReason(error: unknown, fallback: string): string {
  const reason = error instanceof ApnError ? error.details?.reason : undefined;
  return typeof reason === "string" && /^[a-z][a-z0-9_]{0,95}$/u.test(reason) ? reason : fallback;
}

/** Only a transport loss is re-run; a chain refusal and malformed evidence are answers, not noise. */
export function railSendTransient(error: unknown): boolean {
  return railSendReason(error, "") === "solana_simulation_unavailable";
}

function corrupt(): never {
  throw new ApnError("APN_STATE_CORRUPT", "The direct-rail send binding or its pre-send simulation is invalid.");
}
