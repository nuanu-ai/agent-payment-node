import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { hashObject, sha256 } from "../../src/canonical.js";
import type { Hex } from "../../src/model.js";
import { FEE_FORWARDER, FEE_FORWARDER_V2_0 } from "../../src/lifi/abi.js";
import type { BridgeMaterialization } from "../../src/lifi/model.js";
import { bridgeIntentBinding, type BridgeOperationRecord } from "../../src/lifi/operation-model.js";

/**
 * A LI.FI route or step capture recorded before 2026-11-04, re-addressed to the current FeeForwarder. That day LI.FI
 * replaced FeeForwarder v2.0.0 with v2.1.0 and the Diamond stopped running v2.0.0, so a fresh route naming it is
 * refused. A step LI.FI built after the switch is byte-identical to these captures apart from that address: same word
 * offset in the calldata, same `forwardERC20Fees` selector. The files stay as recorded: hash-bound captures and paid
 * receipts read them raw.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function lifiCapture(name: string): any {
  return JSON.parse(readdressFeeForwarder(readFileSync(resolve("tests/core/lifi-fixtures", name), "utf8")));
}

/** Every checksummed and lower-case (calldata word) spelling of FeeForwarder v2.0.0, as the current FeeForwarder. */
export function readdressFeeForwarder(text: string): string {
  return text.replaceAll(FEE_FORWARDER_V2_0, FEE_FORWARDER)
    .replaceAll(FEE_FORWARDER_V2_0.slice(2).toLowerCase(), FEE_FORWARDER.slice(2).toLowerCase());
}

/**
 * The materialization an operation prepared before 2026-11-04 stored: the same call through FeeForwarder v2.0.0. Only the
 * calldata names the FeeForwarder (callTo and approveTo of the one fee step), so only it and its digest change.
 */
export function feeForwarderV20Materialization(m: BridgeMaterialization): BridgeMaterialization {
  const current = FEE_FORWARDER.slice(2).toLowerCase(), replaced = FEE_FORWARDER_V2_0.slice(2).toLowerCase();
  if (m.transaction.data.split(current).length !== 3) throw new Error("expected callTo and approveTo of one fee step");
  const transaction = { ...m.transaction, data: m.transaction.data.replaceAll(current, replaced) as Hex };
  return { ...m, transaction, transactionDigest: hashObject(transaction) };
}

/**
 * An awaiting-approval record exactly as an APN before the switch stored it for the same route: the call (in the
 * materialization and the bridge envelope) names FeeForwarder v2.0.0, and every hash that covers it is recomputed.
 */
export function feeForwarderV20Record(op: BridgeOperationRecord): BridgeOperationRecord {
  if (op.state !== "awaiting_approval" || op.transitions.length !== 1) throw new Error("expected a freshly prepared record");
  const raw = structuredClone(op) as any;
  const m = feeForwarderV20Materialization(op.intent.materialization);
  raw.intent.materialization = m;
  raw.intent.decoded.dataHash = sha256(Buffer.from(m.transaction.data.slice(2), "hex"));
  for (const effect of raw.effects) {
    if (effect.role !== "bridge") continue;
    const { envelopeHash: _previous, ...body } = { ...effect.envelope, data: m.transaction.data };
    effect.envelope = { ...body, envelopeHash: hashObject(body) };
  }
  raw.fingerprint = hashObject(bridgeIntentBinding(raw));
  const [first] = raw.transitions;
  first.effects = first.effects.map((snapshot: any) => ({ ...snapshot,
    envelopeHash: raw.effects.find((effect: any) => effect.role === snapshot.role).envelope.envelopeHash }));
  first.previousHash = raw.fingerprint;
  delete first.transitionHash; first.transitionHash = hashObject(first);
  delete raw.integrityHash; raw.integrityHash = hashObject(raw);
  return raw as BridgeOperationRecord;
}
