import assert from "node:assert/strict";
import test from "node:test";
import { decodeAbiParameters, parseAbiParameters } from "viem";
import type { Address, Hex } from "../../src/model.js";
import { decodeBnbCompositeMessage, flyRouteDeadline } from "../../src/lifi/bnb-composite.js";
import { ApnCore } from "../../src/core.js";
import { AssetUsageLedger } from "../../src/asset-usage-ledger.js";
import { lifiFixture, type LifiJson } from "./lifi-helpers.js";
import { temporaryState } from "./helpers.js";
import { findStored } from "./stored-operations.js";
import { lifiCapture } from "./lifi-capture.js";

const MESSAGE = parseAbiParameters("bytes32,(address callTo,address approveTo,address sendingAssetId,address receivingAssetId,uint256 fromAmount,bytes callData,bool requiresDeposit)[],address");
// QA's 2026-11-06 fill: a hop of Fly's route reverted 0x3e9e7bf1(1793963618, 1793963738), its own deadline and the block time.
const revert = lifiCapture("bsc-across-fly-revert-20261106.json") as { relay: { message: Hex } };
// The 2026-09-21 quote the eth-bnb fixture prepares, and the 2026-11-05 multi-hop one.
const september = lifiCapture("bnb-composite-fly-20260921.json") as { decoded: { flyPackedPayload: Hex; acrossData: { message: Hex; quoteTimestamp: number } } };
const november = lifiCapture("bnb-composite-fly-20261105.json") as { decoded: { acrossData: { message: Hex; quoteTimestamp: number } } };

function decoded(message: Hex) {
  const [transactionId, , finalReceiver] = decodeAbiParameters(MESSAGE, message);
  return decodeBnbCompositeMessage(message, transactionId, finalReceiver as Address);
}

test("the earliest deadline inside Fly's unsigned route caps the signed one", () => {
  const call = decoded(revert.relay.message);
  assert.equal(call.deadlineAtomic, "1793963859");
  assert.equal(flyRouteDeadline(call, 1793963500n), 1793963618n);
  // A value before the quote time is not a deadline of this quote; one after the signed deadline cannot bind first.
  assert.equal(flyRouteDeadline(call, 1793963619n), 1793963859n);
  assert.equal(flyRouteDeadline({ ...call, deadlineAtomic: "1793963600" }, 1793963500n), 1793963600n);
  for (const capture of [september, november]) {
    const routeless = decoded(capture.decoded.acrossData.message);
    assert.equal(flyRouteDeadline(routeless, BigInt(capture.decoded.acrossData.quoteTimestamp)), BigInt(routeless.deadlineAtomic));
  }
});

/** Writes a 4-byte timestamp into the unsigned route of the fixture's Fly program (payload offset 300, after the header). */
function routeDeadline(value: number) {
  const payload = september.decoded.flyPackedPayload.slice(2).toLowerCase(), word = value.toString(16).padStart(8, "0");
  return (step: LifiJson) => {
    const data = String(step.transactionRequest.data).toLowerCase(), at = data.indexOf(payload);
    assert.ok(at > 0 && data.indexOf(payload, at + 1) === -1);
    step.transactionRequest.data = data.slice(0, at + 600) + word + data.slice(at + 608);
  };
}

test("a deadline inside Fly's route closes the approval window, and a passed one refuses prepare", async (t) => {
  const fixture = async (deadline: number | null) => {
    const temporary = await temporaryState(); t.after(temporary.cleanup);
    const s = await lifiFixture(temporary.root, "eth-bnb");
    if (deadline !== null) s.provider.mutateMaterialization = routeDeadline(deadline);
    return s;
  };
  const now = Math.floor((await fixture(null)).now.getTime() / 1000);
  // Without one, the signed header's deadline closes it, as before.
  assert.equal((await (await fixture(null)).prepare("across", "bnb-route-free-001")).operation.intent.expiresAt, new Date(1789921639_000).toISOString());
  assert.equal((await (await fixture(now + 120)).prepare("across", "bnb-route-deadline-001")).operation.intent.expiresAt,
    new Date((now + 120) * 1000).toISOString());
  await assert.rejects((await fixture(now)).prepare("across", "bnb-route-expired-001"), /fly_route_deadline/u);
});

test("LI.FI's DONE/PARTIAL for a reverted Fly swap goes to the trace, which proves the WETH came back and frees the usage", async (t) => {
  const temporary = await temporaryState(); t.after(temporary.cleanup);
  const s = await lifiFixture(temporary.root, "eth-bnb");
  // Where 0.5.94 left QA's operation: PARTIAL without a destination proof, parked as unknown finality.
  const hint = s.provider.hint;
  s.provider.statusValue = "partial_observed"; s.provider.hint = null; s.destination.destinationCompositeOutcome = "recovered_weth";
  const prepared = await s.prepare("across", "bnb-partial-001");
  await s.core.execute({ command: "bridge.approve", operationId: prepared.id });
  let record = (await findStored(s.core.bridges.records, prepared.id))!;
  assert.equal(record.state, "unknown_finality"); assert.equal(record.failure?.reason, "provider_partial_observed_unproved");
  assert.equal(record.destinationProof, null);
  s.provider.hint = hint;
  const restarted = new ApnCore({ state: s.state, bridge: s.dependencies, clock: { now: () => new Date(s.now) } });
  await restarted.execute({ command: "operation.resume", operationId: prepared.id });
  record = (await findStored(restarted.bridges.records, prepared.id))!;
  assert.equal(record.state, "destination_failed"); assert.equal(record.failure?.reason, "recovered_weth");
  assert.equal(record.destinationProof?.compositeTrace?.outcome, "recovered_weth");
  const binding = record.intent.allowlist!, lease = await new AssetUsageLedger(temporary.root).load({
    account: binding.account, chain: binding.chain, asset: binding.asset }, record.usageLease!.reservationId);
  assert.equal(lease?.state, "finalized"); assert.equal(s.source.submissions.length, 1);
});

test("on PARTIAL the trace still decides: a swap that delivered native BNB completes", async (t) => {
  const temporary = await temporaryState(); t.after(temporary.cleanup);
  const s = await lifiFixture(temporary.root, "eth-bnb");
  s.provider.statusValue = "partial_observed"; s.destination.destinationCompositeOutcome = "completed_native";
  const prepared = await s.prepare("across", "bnb-partial-native-001");
  await s.core.execute({ command: "bridge.approve", operationId: prepared.id });
  const record = (await findStored(s.core.bridges.records, prepared.id))!;
  assert.equal(record.state, "completed"); assert.equal(record.destinationProof?.compositeTrace?.outcome, "completed_native");
});
