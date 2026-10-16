import assert from "node:assert/strict";
import test from "node:test";
import { ApnCore } from "../../src/core.js";
import { ApnError } from "../../src/errors.js";
import { AssetUsageLedger } from "../../src/asset-usage-ledger.js";
import type { OperationAbandonApprovalPort, OperationAbandonIntent } from "../../src/operation-abandon-approval.js";
import type { OperationRecord } from "../../src/model.js";
import { EVM_REQUEST, EvmTestRpc, ensureDirectWallet, evmCore } from "./evm-helpers.js";
import { directUsage } from "./direct-allowlist-helpers.js";
import { temporaryState } from "./helpers.js";

class Abandon implements OperationAbandonApprovalPort {
  readonly intents: OperationAbandonIntent[] = [];
  refusal: Error | null = null;
  async approve(intent: OperationAbandonIntent): Promise<void> {
    this.intents.push(intent);
    if (this.refusal !== null) throw this.refusal;
  }
}

function unlanded(rpc: EvmTestRpc, seen: { finalizedNonce: string; transactionKnown: boolean }): void {
  Object.assign(rpc.evm, { unlandedEvidence: async () => ({ ...seen, receiptFound: rpc.receiptEnabled && rpc.submissions.length > 0 }) });
}

async function ledgerState(root: string, operation: OperationRecord): Promise<string | undefined> {
  const reservation = operation.allowlistLease!.reservation;
  return (await new AssetUsageLedger(root).load(reservation, reservation.reservationId))?.state;
}

test("an ambiguous dispatch the RPC never saw is re-sent as the identical bytes after observation, never in observe-only mode", async (t) => {
  const temporary = await temporaryState(); t.after(temporary.cleanup);
  const setup = evmCore(temporary.root), rpc = setup.rpc;
  rpc.sender = (await ensureDirectWallet(setup)).address;
  rpc.submitError = new Error("timeout"); rpc.receiptEnabled = false;
  const prepared = await setup.core.transfer.prepare({ ...EVM_REQUEST, idempotencyKey: "redispatch-0001" }) as { operation_id: string };
  assert.equal((await setup.core.transfer.approve(prepared.operation_id) as { state: string }).state, "unknown_finality");
  assert.equal(rpc.broadcastCount, 1);
  rpc.submitError = null;
  const seen = { finalizedNonce: rpc.nonceAtomic, transactionKnown: true };
  unlanded(rpc, seen);
  assert.equal((await setup.core.transfer.resume(prepared.operation_id) as { state: string }).state, "unknown_finality");
  assert.equal(rpc.broadcastCount, 1, "a hash the RPC still holds is only observed");
  seen.transactionKnown = false;
  assert.equal((await setup.core.transfer.resume(prepared.operation_id, undefined, true) as { state: string }).state, "unknown_finality");
  assert.equal(rpc.broadcastCount, 1, "observe-only never sends");
  const resent = await setup.core.transfer.resume(prepared.operation_id) as { state: string; reason: string };
  assert.equal(resent.state, "submitted_pending"); assert.equal(resent.reason, "same_signed_bytes_redispatched");
  assert.equal(rpc.broadcastCount, 2); assert.equal(rpc.submissions[1], rpc.submissions[0]);
  rpc.receiptEnabled = true;
  assert.equal((await setup.core.transfer.resume(prepared.operation_id) as { state: string }).state, "completed");
  assert.equal(rpc.broadcastCount, 2);
  assert.equal(await ledgerState(temporary.root, (await setup.state.findOperation(prepared.operation_id))!), "finalized");
});

test("a finalized nonce taken by another transaction ends the transfer as superseded, releases its hold and frees the account", async (t) => {
  const temporary = await temporaryState(); t.after(temporary.cleanup);
  const setup = evmCore(temporary.root), rpc = setup.rpc;
  const wallet = await ensureDirectWallet(setup); rpc.sender = wallet.address; rpc.receiptEnabled = false;
  const prepared = await setup.core.transfer.prepare({ ...EVM_REQUEST, idempotencyKey: "superseded-0001" }) as { operation_id: string };
  assert.equal((await setup.core.transfer.approve(prepared.operation_id) as { state: string }).state, "submitted_pending");
  unlanded(rpc, { finalizedNonce: rpc.nonceAtomic, transactionKnown: true });
  assert.equal((await setup.core.transfer.resume(prepared.operation_id) as { state: string }).state, "submitted_pending");
  unlanded(rpc, { finalizedNonce: (BigInt(rpc.nonceAtomic) + 1n).toString(), transactionKnown: false });
  const superseded = await setup.core.transfer.resume(prepared.operation_id) as { state: string; terminal: boolean };
  assert.equal(superseded.state, "failed_proven_superseded"); assert.equal(superseded.terminal, true);
  assert.equal(rpc.broadcastCount, 1, "a superseded nonce is never re-sent");
  const operation = (await setup.state.findOperation(prepared.operation_id))!;
  assert.equal(await ledgerState(temporary.root, operation), "failed_confirmed_revert");
  assert.equal(await directUsage(temporary.root, wallet.address, "eip155:8453", null, setup.clock.now()), "0");
  assert.equal((await setup.core.execute({ command: "receipt.get", operationId: prepared.operation_id })).ok, true);
  const next = await setup.core.execute({ ...EVM_REQUEST, idempotencyKey: "superseded-0002" });
  assert.equal(next.ok, true, JSON.stringify(next.error));
});

test("only a signature APN never dispatched can be abandoned; the owner's acknowledgement closes it without any send", async (t) => {
  const temporary = await temporaryState(); t.after(temporary.cleanup);
  const rpc = new EvmTestRpc();
  const setup = evmCore(temporary.root, rpc, undefined, undefined, native => ({ request: async request => {
    const result = await native.request(request);
    if (request.operation === "directTransfer.approveAndSign") throw new Error("simulated process loss after encrypted save");
    return result;
  } }));
  const wallet = await ensureDirectWallet(setup); rpc.sender = wallet.address;
  const abandon = new Abandon();
  const core = new ApnCore({ state: setup.state, rpc, native: setup.local, clock: setup.clock, operationAbandonApproval: abandon });
  const prepared = await setup.core.transfer.prepare({ ...EVM_REQUEST, idempotencyKey: "abandon-unsent-0001" }) as { operation_id: string };
  await assert.rejects(setup.core.transfer.approve(prepared.operation_id), /simulated process loss/u);
  abandon.refusal = new ApnError("APN_NATIVE_REJECTED", "wrong confirmation");
  assert.equal((await core.execute({ command: "operation.abandon", operationId: prepared.operation_id })).error?.code, "APN_NATIVE_REJECTED");
  assert.equal((await setup.state.findOperation(prepared.operation_id))!.state, "started");
  abandon.refusal = null;
  const closed = await core.execute({ command: "operation.abandon", operationId: prepared.operation_id });
  assert.equal(closed.ok, true, JSON.stringify(closed.error));
  assert.equal((closed.operation as { state: string }).state, "abandoned_unknown");
  assert.equal((closed.operation as { reason: string }).reason, "owner_abandoned_undispatched_signature");
  const intent = abandon.intents.at(-1)!;
  assert.equal(intent.chainLabel, "Base (eip155:8453)"); assert.equal(intent.unit, "ETH"); assert.match(intent.outcomeNote, /never sends it/u);
  const operation = (await setup.state.findOperation(prepared.operation_id))!;
  assert.equal(await ledgerState(temporary.root, operation), "failed_before_effect");
  assert.equal((await core.execute({ command: "operation.resume", operationId: prepared.operation_id })).ok, true);
  assert.equal((await core.execute({ command: "operation.abandon", operationId: prepared.operation_id })).ok, true);
  assert.equal(rpc.broadcastCount, 0); assert.equal(abandon.intents.length, 2);
  await assert.rejects(setup.local.request({ requestId: "terminal-signed-material", version: "apn.native.v1", operation: "directTransfer.signedMaterial.get",
    payload: { profile: operation.profile, operationId: operation.operationId, fingerprint: operation.fingerprint,
      expectedTransactionHash: operation.transactionHash, expectedRawTransactionHash: operation.rawTransactionHash } }), { code: "APN_NATIVE_PROTOCOL" });

  const dispatched = await setup.core.transfer.prepare({ ...EVM_REQUEST, idempotencyKey: "abandon-unsent-0002" }) as { operation_id: string };
  const plain = evmCore(temporary.root, rpc, setup.wrapping); rpc.receiptEnabled = false;
  assert.equal((await plain.core.transfer.approve(dispatched.operation_id) as { state: string }).state, "submitted_pending");
  const refused = await core.execute({ command: "operation.abandon", operationId: dispatched.operation_id });
  assert.equal(refused.error?.code, "APN_OPERATION_BLOCKED"); assert.equal(abandon.intents.length, 2);
  const sent = (await setup.state.findOperation(dispatched.operation_id))!;
  await assert.rejects(setup.local.request({ requestId: "mismatched-signed-material", version: "apn.native.v1", operation: "directTransfer.signedMaterial.get",
    payload: { profile: sent.profile, operationId: sent.operationId, fingerprint: sent.fingerprint,
      expectedTransactionHash: `0x${"e".repeat(64)}`, expectedRawTransactionHash: `0x${"e".repeat(64)}` } }), { code: "APN_NATIVE_PROTOCOL" });
});
