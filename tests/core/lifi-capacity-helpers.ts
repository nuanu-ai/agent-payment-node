import assert from "node:assert/strict";
import { canonicalJson, hashObject } from "../../src/canonical.js";
import { ApnError } from "../../src/errors.js";
import { bridgeTransitionKind } from "../../src/lifi/history-capacity.js";
import { BRIDGE_TERMINAL, bridgeSnapshot, sealBridgeOperation, type BridgeEffectPhase, type BridgeMutable,
  type BridgeOperationRecord, type BridgeTransition } from "../../src/lifi/operation-model.js";
import { bridgeAtTransition } from "../../src/lifi/transitions.js";
import { lifiFixture } from "./lifi-helpers.js";
import { findStored } from "./stored-operations.js";

// LI.FI journals as earlier releases could leave them, built without the capacity rules, for the capacity tests.
export const bytes = (op: BridgeOperationRecord) => Buffer.byteLength(canonicalJson(op), "utf8") + 1;
/**
 * One appended transition exactly as transitionBridge builds it, without its capacity rules: what an earlier release
 * wrote. Its integrity hash is stale (same length) until `sealed`, so long histories are built without rehashing each step.
 */
export function appended(op: BridgeOperationRecord, patch: Partial<BridgeMutable>): BridgeOperationRecord {
  const next = { ...op, ...patch } as BridgeOperationRecord;
  const entry = { ...bridgeSnapshot(next), at: op.updatedAt, previousHash: op.transitions.at(-1)!.transitionHash };
  return { ...next, terminal: BRIDGE_TERMINAL.includes(next.state),
    transitions: [...op.transitions, { ...entry, transitionHash: hashObject(entry) }] };
}
export function sealed(op: BridgeOperationRecord): BridgeOperationRecord {
  const { integrityHash: _old, ...body } = op;
  return sealBridgeOperation(body);
}
export const written = (op: BridgeOperationRecord, patch: Partial<BridgeMutable>) => sealed(appended(op, patch));
/** A recorded transition appended again onto `from`, with `from`'s envelopes: history replayed onto a rebuilt journal. */
export function replayed(from: BridgeOperationRecord, entry: BridgeTransition): BridgeOperationRecord {
  const { at: _at, previousHash: _previous, transitionHash: _hash, ...rest } = entry;
  return appended(from, { ...rest, effects: rest.effects.map(({ envelopeHash: _e, ...e }, i) => ({ ...e, envelope: from.effects[i]!.envelope })) });
}
const failed = (stage: "source_receipt" | "destination_receipt", reason: string, n: number): Partial<BridgeMutable> => ({
  state: "unknown_finality", failure: { reason, residualAllowance: null, observationRpc: {
    schemaVersion: "apn.bridge-observation-rpc-failure.v1", stage, effectRole: "bridge", code: "APN_RPC_PROTOCOL",
    reason: "bridge_RPC_HTTP_status", rpcMethod: "eth_getTransactionReceipt", httpStatus: 500 + (n % 100), attempts: 1 + (n % 10) } } });
/** A destination read that failed with different details on every resume: each one was a new ordinary transition. */
export const flaky = (n: number) => failed("destination_receipt", "destination_observation_unavailable", n);
/** A source read that failed with different details on every resume, before the bridge was safe: ordinary transitions. */
export const sourceFlaky = (n: number) => failed("source_receipt", "source_observation_unavailable", n);
/** A pre-sign guard deferral flipping between rate limited and unavailable: ordinary transitions of about 2 KiB. */
export const deferred = (n: number): Partial<BridgeMutable> => ({ failure: { residualAllowance: null,
  reason: n % 2 === 0 ? "pre_sign_rpc_rate_limited" : "pre_sign_rpc_unavailable" } });
export const refused = (reason: string) => (error: unknown) => error instanceof ApnError && error.code === "APN_OPERATION_BLOCKED" &&
  error.message === `Bridge validation failed: ${reason}.`;
/** The kinds of the transitions `after` added to `before`. */
export const addedKinds = (before: BridgeOperationRecord, after: BridgeOperationRecord) => after.transitions.slice(before.transitions.length)
  .map((entry, index) => bridgeTransitionKind(after.transitions[before.transitions.length + index - 1]!, entry));
export const bridgeSafe = (entry: { readonly effects: readonly { readonly safeProof: unknown }[] }) => entry.effects.at(-1)!.safeProof !== null;

/**
 * A LI.FI approval whose process died at the `role` effect's `phase` save: just after writing it (`after`), or just before
 * (`before`: the journal holds the step before, with whatever custody seal or claim the code wrote ahead of the save).
 */
export async function stoppedSend(root: string, pair: "base-arb" | "eth-bnb", role: "approval" | "bridge", phase: BridgeEffectPhase,
  when: "before" | "after") {
  const s = await lifiFixture(root, pair), { id } = await s.prepare(), persist = s.core.bridges.records.persist.bind(s.core.bridges.records);
  s.core.bridges.records.persist = async (op) => {
    const hit = op.effects.find((e) => e.role === role)?.phase === phase;
    if (hit && when === "before") throw new Error(`died before ${phase}`);
    await persist(op);
    if (hit) throw new Error(`died after ${phase}`);
  };
  assert.equal((await s.core.execute({ command: "bridge.approve", operationId: id })).ok, false); s.core.bridges.records.persist = persist;
  return { s, id, stopped: (await findStored(s.core.bridges.records, id))! };
}
/**
 * `stopped` rebuilt with pre-sign deferrals inserted before its transition `start` and the history from there replayed on
 * top, as many as `fits` admits for the whole result: an earlier release journaled every deferral it met.
 */
export function withDeferrals(stopped: BridgeOperationRecord, start: number, fits: (op: BridgeOperationRecord) => boolean): BridgeOperationRecord {
  const tail = stopped.transitions.slice(start), replay = (from: BridgeOperationRecord) => tail.reduce(replayed, from);
  let op = bridgeAtTransition(stopped, start - 1), n = 0;
  const more = (from: BridgeOperationRecord, count: number) => {
    for (let k = 0; k < count; k++) from = appended(from, deferred(n + k));
    return from;
  };
  for (const batch of [8, 1]) while (fits(replay(more(op, batch)))) { op = more(op, batch); n += batch; }
  return sealed(replay(op));
}
