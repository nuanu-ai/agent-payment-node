import assert from "node:assert/strict";
import test from "node:test";
import { ApnError } from "../../src/errors.js";
import { EVM_REQUEST, EvmApproval, EvmTestRpc, EvmWrappingSecret, ensureDirectWallet, evmCore } from "./evm-helpers.js";
import { temporaryState } from "./helpers.js";

const RPC_URL = "https://rpc.example.test/base";

test("timed-out foreground approval keeps its native code and names the resume that releases the reservation", async (context) => {
  const temporary = await temporaryState(); context.after(temporary.cleanup);
  const approval = new EvmApproval();
  approval.rejection = new ApnError("APN_NATIVE_REJECTED", "Direct-transfer approval timed out.", { nativeCode: "APN_APPROVAL_TIMEOUT" });
  const setup = evmCore(temporary.root, new EvmTestRpc(), new EvmWrappingSecret(), approval, undefined, RPC_URL);
  await ensureDirectWallet(setup);
  const prepared = await setup.core.transfer.prepare(EVM_REQUEST) as { operation_id: string };
  const envelope = await setup.core.execute({ command: "transfer.approve", operationId: prepared.operation_id }) as unknown as {
    ok: boolean; error: { code: string; details?: Record<string, unknown> }; next_actions: readonly string[] };
  assert.equal(envelope.ok, false);
  assert.equal(envelope.error.code, "APN_NATIVE_REJECTED"); assert.equal(envelope.error.details?.nativeCode, "APN_APPROVAL_TIMEOUT");
  assert.equal(envelope.next_actions[0], `apn operation resume --operation ${prepared.operation_id} --rpc-url ${RPC_URL}`);
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

test("a failure after the wallet was opened keeps its own error and code-based next actions", async (context) => {
  const temporary = await temporaryState(); context.after(temporary.cleanup);
  const setup = evmCore(temporary.root, new EvmTestRpc(), new EvmWrappingSecret(), new EvmApproval(), undefined, RPC_URL);
  await ensureDirectWallet(setup);
  const original = new ApnError("APN_STATE_BUSY", "TEST custody busy after approval.");
  setup.wrapping.load = async () => { setup.wrapping.loads += 1; throw original; };
  const prepared = await setup.core.transfer.prepare(EVM_REQUEST) as { operation_id: string };
  await assert.rejects(setup.core.transfer.approve(prepared.operation_id), (error: unknown) => error === original);
  assert.equal((await setup.state.findOperation(prepared.operation_id))!.state, "started");
});
