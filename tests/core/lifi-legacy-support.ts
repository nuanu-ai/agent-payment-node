import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { canonicalJson, hashObject } from "../../src/canonical.js";
import { adaptLegacyBridgeOperation } from "../../src/lifi/legacy-operation.js";
import type { BridgeOperationRecord } from "../../src/lifi/operation-model.js";
import { legacyBridgeReceipt } from "../../src/lifi/receipt.js";

/** A current bridge journal rewritten into the exact pre-allowlist (legacy) shape: no usage lease, no allowlist binding. */
export function downgradeFixture(record: BridgeOperationRecord): Record<string, any> {
  const raw = structuredClone(record) as Record<string, any>;
  delete raw.usageLease;
  delete raw.intent.allowlist;
  if (raw.destinationProof !== null) {
    delete raw.destinationProof.nativeBalance;
    delete raw.destinationProof.nativeTransfer;
  }
  const binding = { schemaVersion: raw.schemaVersion, kind: raw.kind, profileHash: raw.profileHash,
    operationId: raw.operationId, idempotencyHash: raw.idempotencyHash, requestHash: raw.requestHash,
    intent: raw.intent, envelopes: raw.effects.map((effect: any) => effect.envelope) };
  raw.fingerprint = hashObject(binding);
  if (raw.approval !== null) raw.approval.fingerprint = raw.fingerprint;
  let previousHash = raw.fingerprint;
  for (const transition of raw.transitions) {
    delete transition.usageLease;
    if (transition.destinationProof !== null) {
      delete transition.destinationProof.nativeBalance;
      delete transition.destinationProof.nativeTransfer;
    }
    if (transition.approval !== null) transition.approval.fingerprint = raw.fingerprint;
    transition.previousHash = previousHash;
    delete transition.transitionHash;
    transition.transitionHash = hashObject(transition);
    previousHash = transition.transitionHash;
  }
  delete raw.integrityHash;
  raw.integrityHash = hashObject(raw);
  return raw;
}

export async function installLegacyFixture(root: string, record: BridgeOperationRecord) {
  const raw = downgradeFixture(record), operationPath = join(root, "bridge-operations", raw.profileHash, `${raw.operationId}.json`);
  const legacy = adaptLegacyBridgeOperation(raw), receipt = legacyBridgeReceipt(legacy);
  const receiptPath = join(root, "bridge-receipts", raw.profileHash, `${raw.operationId}.json`);
  await mkdir(dirname(operationPath), { recursive: true }); await mkdir(dirname(receiptPath), { recursive: true, mode: 0o700 });
  await writeFile(operationPath, `${canonicalJson(raw)}\n`); await writeFile(receiptPath, `${canonicalJson(receipt)}\n`, { mode: 0o600 });
  return { raw, receipt, operationPath, receiptPath };
}
