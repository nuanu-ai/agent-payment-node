import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { hashObject } from "../../src/canonical.js";
import type { Hex } from "../../src/model.js";
import { FEE_FORWARDER, FEE_FORWARDER_V2_0 } from "../../src/lifi/abi.js";
import type { BridgeMaterialization } from "../../src/lifi/model.js";

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
