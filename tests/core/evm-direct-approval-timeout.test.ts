import assert from "node:assert/strict";
import test from "node:test";
import { ApnError } from "../../src/errors.js";
import { EVM_REQUEST, EvmApproval, EvmTestRpc, EvmWrappingSecret, ensureDirectWallet, evmCore } from "./evm-helpers.js";
import { temporaryState } from "./helpers.js";

test("timed-out foreground approval keeps its native code and names the resume that releases the reservation", async (context) => {
  const temporary = await temporaryState(); context.after(temporary.cleanup);
  const approval = new EvmApproval();
  approval.rejection = new ApnError("APN_NATIVE_REJECTED", "Direct-transfer approval timed out.", { nativeCode: "APN_APPROVAL_TIMEOUT" });
  const setup = evmCore(temporary.root, new EvmTestRpc(), new EvmWrappingSecret(), approval);
  await ensureDirectWallet(setup);
  const prepared = await setup.core.transfer.prepare(EVM_REQUEST) as { operation_id: string };
  const resume = `apn operation resume --operation ${prepared.operation_id}`;
  await assert.rejects(setup.core.transfer.approve(prepared.operation_id), (error: unknown) => error instanceof ApnError &&
    error.code === "APN_NATIVE_REJECTED" && error.details?.nativeCode === "APN_APPROVAL_TIMEOUT" &&
    JSON.stringify(error.details?.nextActions) === JSON.stringify([resume]));
  const held = (await setup.state.findOperation(prepared.operation_id))!;
  assert.equal(held.state, "started"); assert.ok(held.allowlistLease);
  await assert.rejects(setup.core.transfer.resume(prepared.operation_id), { code: "APN_REPREPARE_REQUIRED" });
  const { AssetUsageLedger } = await import("../../src/asset-usage-ledger.js");
  const reservation = held.allowlistLease!.reservation;
  const identity = { account: reservation.account, chain: reservation.chain, asset: reservation.asset };
  assert.equal((await new AssetUsageLedger(temporary.root).load(identity, reservation.reservationId))!.state, "failed_before_effect");
  assert.equal((await setup.core.transfer.status(prepared.operation_id) as { state: string }).state, "failed_before_effect");
  assert.equal(setup.rpc.broadcastCount, 0);
});
