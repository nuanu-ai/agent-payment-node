import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { canonicalJson, hashObject } from "../../src/canonical.js";
import { validateCircle, type CircleOperationV1 } from "../../src/circle-v2-evm/operation-model.js";
import type { CircleDestinationChain } from "../../src/circle-v2-evm/catalog.js";

/** The v1 writer is deleted from src (v1 journals are read-only). These copies of its seal and advance only build fixture
 * journals in the exact format released v1 writers produced, so readers and refusals are tested against real shapes. */
export function sealCircle(input: Omit<CircleOperationV1, "integrityHash"> | CircleOperationV1): CircleOperationV1 {
  const { integrityHash: _old, ...body } = input as CircleOperationV1; return { ...body, integrityHash: hashObject(body) };
}
export function advanceCircle(op: CircleOperationV1, patch: Partial<CircleOperationV1>, reason: string, now: number): CircleOperationV1 {
  const { transitions, integrityHash: _old, ...body } = { ...op, ...patch };
  const entry = { sequence: transitions.length, at: new Date(now).toISOString(), reason, previousHash: op.transitions.at(-1)?.snapshotHash ?? null, snapshotHash: hashObject(body) };
  return sealCircle({ ...body, transitions: [...transitions, entry] });
}
/** Writes a checked v1 journal where the released runtime kept it. */
export async function saveCircleV1(root: string, input: CircleOperationV1): Promise<void> {
  const op = validateCircle(input);
  await mkdir(join(root, "circle-v2-evm"), { recursive: true, mode: 0o700 });
  await writeFile(join(root, "circle-v2-evm", `${op.operationId}.json`), `${canonicalJson(op)}\n`, { mode: 0o600 });
}
/** The asset-policy mechanism the released v1 runtime admitted. */
export const circleMechanism = (chain: CircleDestinationChain) => ({ provider: "circle-cctp-v2", reference: `circle-v2-evm-fast-42161-${chain}.v1` });
