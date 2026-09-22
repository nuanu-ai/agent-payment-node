import { canonicalJson, hashObject } from "../canonical.js";
import { BRIDGE_TERMINAL, bridgeIntentBinding, bridgeSnapshot, sealBridgeOperation,
  type BridgeEffect, type BridgeIntent, type BridgeMutable, type BridgeOperationRecord } from "./operation-model.js";
import { validateBridgeContinuity, validateBridgeOperation } from "./operation-validation.js";
import { bridgeFailure, bridgeSame } from "./validation.js";

export function newBridgeOperation(input: { readonly profileHash: string; readonly operationId: string;
  readonly idempotencyHash: string; readonly requestHash: string; readonly intent: BridgeIntent; readonly effects: readonly BridgeEffect[] }): BridgeOperationRecord {
  const immutable = { schemaVersion: "apn.bridge-operation.v1" as const, kind: "bridge_route" as const, ...input };
  const fingerprint = hashObject(bridgeIntentBinding(immutable));
  const mutable: BridgeMutable = { state: "awaiting_approval", approval: null, effects: input.effects, sourceProof: null,
    destinationProof: null, providerObservation: null, failure: null, usageLease: null, observationTelemetry: [],
    destinationScan: { startBlock: input.intent.destinationStartBlock, nextBlockAtomic: input.intent.destinationStartBlock.numberAtomic, previousEndBlock: null } };
  const transition = { ...bridgeSnapshot(mutable), at: input.intent.preparedAt, previousHash: fingerprint };
  const result = sealBridgeOperation({ ...immutable, ...mutable, fingerprint, createdAt: input.intent.preparedAt,
    updatedAt: input.intent.preparedAt, terminal: false, transitions: [{ ...transition, transitionHash: hashObject(transition) }] });
  return validateBridgeOperation(result);
}
export function transitionBridge(op: BridgeOperationRecord, patch: Partial<BridgeMutable>, at: string): BridgeOperationRecord {
  validateBridgeOperation(op);
  const next = { ...op, ...patch };
  const oldMeaning = bridgeSnapshot(op), newMeaning = bridgeSnapshot(next);
  // Poll timestamps alone are not evidence changes and cannot grow the journal.
  const observationMeaning = (s: typeof oldMeaning) => ({ ...s, providerObservation: s.providerObservation === null ? null : {
    ...s.providerObservation, observedAt: "", responseHash: null,
  } });
  if (bridgeSame(observationMeaning(oldMeaning), observationMeaning(newMeaning))) return op;
  if (op.transitions.length >= 512) bridgeFailure("APN_OPERATION_BLOCKED", "bridge_history_capacity");
  const entry = { ...newMeaning, at, previousHash: op.transitions.at(-1)!.transitionHash };
  const { integrityHash: _old, ...body } = next;
  const result = sealBridgeOperation({ ...body, updatedAt: at, terminal: BRIDGE_TERMINAL.includes(next.state),
    transitions: [...op.transitions, { ...entry, transitionHash: hashObject(entry) }] });
  if (Buffer.byteLength(canonicalJson(result), "utf8") + 1 > 1024 * 1024) bridgeFailure("APN_OPERATION_BLOCKED", "bridge_record_capacity");
  validateBridgeContinuity(op, result);
  return result;
}
export function bridgeAtTransition(op: BridgeOperationRecord, index: number): BridgeOperationRecord {
  const s = op.transitions[index];
  if (s === undefined) bridgeFailure("APN_STATE_CORRUPT", "bridge_history_index");
  const { at, previousHash: _p, transitionHash: _t, ...mutable } = s;
  const { integrityHash: _old, ...body } = op;
  return sealBridgeOperation({ ...body, ...mutable, effects: mutable.effects.map(({ envelopeHash: _h, ...e }, i) =>
    ({ ...e, envelope: op.effects[i]!.envelope })), updatedAt: at, terminal: BRIDGE_TERMINAL.includes(mutable.state), transitions: op.transitions.slice(0, index + 1) });
}
