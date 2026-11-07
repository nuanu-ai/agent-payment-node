import assert from "node:assert/strict";
import test from "node:test";
import { ApnCore } from "../../src/core.js";
import type { BridgeOperationRecord } from "../../src/lifi/operation-model.js";
import { LIFI_RECIPIENT, LIFI_SYNTHETIC_SENDER, lifiFixture } from "./lifi-helpers.js";
import { temporaryState } from "./helpers.js";
import { findStored } from "./stored-operations.js";

test("an owner recipient pin on the LI.FI bridge admission refuses any other recipient at prepare", async (t) => {
  const temporary = await temporaryState(); t.after(temporary.cleanup);
  // The fixture's Ethereum USDC route pays LIFI_RECIPIENT; a pin that lists only the sender must refuse it.
  const s = await lifiFixture(temporary.root, "eth-base", { policy: { recipients: [LIFI_SYNTHETIC_SENDER] } });
  await assert.rejects(s.prepare("across", "lifi-pin-refused-0001"), /allowlist_recipient_not_admitted/u);
});

test("a pin that lists the recipient admits the bridge through approval, reservation and the first send", async (t) => {
  const temporary = await temporaryState(); t.after(temporary.cleanup);
  const s = await lifiFixture(temporary.root, "eth-base", { policy: { recipients: [LIFI_RECIPIENT, LIFI_SYNTHETIC_SENDER] } });
  const prepared = await s.prepare("across", "lifi-pin-admitted-0001");
  const approved = await s.core.execute({ command: "bridge.approve", operationId: prepared.id });
  assert.equal(approved.ok, true, JSON.stringify(approved.error));
  const record = (await findStored(s.core.bridges.records, prepared.id))!;
  assert.notEqual(record.usageLease, null); assert.ok(s.source.submissions.length >= 1);
});

test("a self-recipient native destination is still bound by the owner's pin", async (t) => {
  const temporary = await temporaryState(); t.after(temporary.cleanup);
  // ETH to BNB must pay the owner itself; a pin that does not list the owner still refuses it.
  const s = await lifiFixture(temporary.root, "eth-bnb", { policy: { recipients: [LIFI_RECIPIENT] } });
  await assert.rejects(s.prepare("across", "bnb-pin-refused-0001"), /allowlist_recipient_not_admitted/u);
});

test("a run that dies after saving a BNB failure proof ends destination_failed on the next resume", async (t) => {
  const temporary = await temporaryState(); t.after(temporary.cleanup);
  const s = await lifiFixture(temporary.root, "eth-bnb");
  s.provider.statusValue = "completed_observed"; s.destination.destinationCompositeOutcome = "recovered_weth";
  const prepared = await s.prepare("across", "bnb-proof-window-0001");
  // The process dies right before it records destination_failed: the destination proof is already saved.
  const records = s.core.bridges.records, persist = records.persist.bind(records);
  let died = false;
  records.persist = async (op: BridgeOperationRecord) => {
    if (!died && op.state === "destination_failed") { died = true; throw new Error("simulated process death"); }
    return await persist(op);
  };
  await s.core.execute({ command: "bridge.approve", operationId: prepared.id }).catch(() => undefined);
  assert.equal(died, true);
  let record = (await findStored(records, prepared.id))!;
  assert.equal(record.destinationProof?.compositeTrace?.outcome, "recovered_weth"); assert.notEqual(record.state, "destination_failed");
  records.persist = persist;
  const restarted = new ApnCore({ state: s.state, bridge: s.dependencies, clock: { now: () => new Date(s.now) } });
  const resumed = await restarted.execute({ command: "operation.resume", operationId: prepared.id });
  assert.equal(resumed.ok, true, JSON.stringify(resumed.error));
  record = (await findStored(restarted.bridges.records, prepared.id))!;
  assert.equal(record.state, "destination_failed"); assert.equal(record.failure?.reason, "recovered_weth");
  assert.equal(s.source.submissions.length, 1);
});
