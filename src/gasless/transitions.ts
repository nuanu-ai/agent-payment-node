import { canonicalJson, hashObject } from "../canonical.js";
import { GASLESS_TERMINAL, gaslessIntentBinding, gaslessSnapshot, newGaslessEffect, sealGaslessOperation,
  type GaslessMutable, type GaslessOperationRecord } from "./operation-model.js";
import type { GaslessIntent } from "./model.js";
import { validateGaslessContinuity, validateGaslessOperation } from "./operation-validation.js";
import { gaslessFailure, gaslessSame } from "./validation.js";

export function newGaslessOperation(input: { readonly profileHash: string; readonly operationId: string;
  readonly idempotencyHash: string; readonly requestHash: string; readonly intent: GaslessIntent }): GaslessOperationRecord {
  const immutable = { schemaVersion: "apn.gasless-operation.v1" as const, kind: "gasless_transfer" as const, ...input };
  const fingerprint = hashObject(gaslessIntentBinding(immutable));
  const mutable: GaslessMutable = { state: "awaiting_approval", approval: null,
    bootstrap: newGaslessEffect("bootstrap"), userOperation: newGaslessEffect("user_operation"),
    cursor: { startBlock: input.intent.initialSnapshot.block, nextBlockAtomic: input.intent.initialSnapshot.block.numberAtomic, previousEndBlock: null },
    observation: null, settlement: null, failure: null };
  const transition = { ...mutable, at: input.intent.preparedAt, previousHash: fingerprint };
  return validateGaslessOperation(sealGaslessOperation({ ...immutable, ...mutable, fingerprint,
    createdAt: input.intent.preparedAt, updatedAt: input.intent.preparedAt, terminal: false,
    transitions: [{ ...transition, transitionHash: hashObject(transition) }] }));
}
export function transitionGasless(op: GaslessOperationRecord, patch: Partial<GaslessMutable>, at: string): GaslessOperationRecord {
  validateGaslessOperation(op);
  const next = { ...op, ...patch }, mutable = gaslessSnapshot(next);
  if (gaslessSame(gaslessSnapshot(op), mutable)) return op;
  if (op.transitions.length >= 512) gaslessFailure("APN_OPERATION_BLOCKED", "gasless_record_capacity");
  const entry = { ...mutable, at, previousHash: op.transitions.at(-1)!.transitionHash };
  const { integrityHash: _old, ...body } = next;
  const result = sealGaslessOperation({ ...body, updatedAt: at, terminal: GASLESS_TERMINAL.includes(next.state),
    transitions: [...op.transitions, { ...entry, transitionHash: hashObject(entry) }] });
  if (Buffer.byteLength(canonicalJson(result), "utf8") + 1 > 1024 * 1024) gaslessFailure("APN_OPERATION_BLOCKED", "gasless_record_capacity");
  validateGaslessContinuity(op, result); return result;
}
export function gaslessAtTransition(op: GaslessOperationRecord, index: number): GaslessOperationRecord {
  const s = op.transitions[index];
  if (s === undefined) gaslessFailure("APN_STATE_CORRUPT", "gasless_history_index");
  const { at, previousHash: _previous, transitionHash: _transition, ...mutable } = s;
  const { integrityHash: _old, ...body } = op;
  return sealGaslessOperation({ ...body, ...mutable, updatedAt: at, terminal: GASLESS_TERMINAL.includes(mutable.state),
    transitions: op.transitions.slice(0, index + 1) });
}
