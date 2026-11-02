import assert from "node:assert/strict";
import test from "node:test";
import { keccak256, type Hex } from "viem";
import { ApnCore } from "../../src/core.js";
import { settleDispatchedDirect, SETTLED_DIRECT_STATES } from "../../src/direct-transfer-settle.js";
import type { FinalizedBatchRead } from "../../src/evm-finalized-proof.js";
import type { OperationRecord } from "../../src/model.js";
import { directAdapter } from "../../src/operation-index/adapters/direct.js";
import type { RpcPort } from "../../src/ports.js";
import { executeBoundCommand } from "../../src/runtime-factory.js";
import type { LocalOperationRecord } from "../../src/transfer-service-observe.js";
import { EVM_BLOCK_HASH, EVM_REQUEST, EvmTestRpc, ensureDirectWallet, evmCore } from "./evm-helpers.js";
import { finalizedNode } from "./finalized-node.js";
import { temporaryState } from "./helpers.js";

/** The finalized-tag node the never-lands proof reads, as evm-signed-recovery.test builds it (prepared block 12345). */
function unlanded(rpc: EvmTestRpc, seen: { readonly finalizedNonce: string; readonly transactionKnown: boolean }): void {
  Object.assign(rpc.evm, { finalizedBatch: (chainId: number): FinalizedBatchRead => async calls => {
    const hash = keccak256(rpc.submissions[0]! as Hex);
    return await finalizedNode(chainId, () => BigInt(seen.finalizedNonce), { era: { number: 12345n, hash: EVM_BLOCK_HASH },
      ...(seen.transactionKnown ? { pending: [hash] } : {}) }).batch(calls);
  } });
}

test("the next prepare closes a dispatched transfer proven never to land and then runs; an unproven one stays and nothing is re-sent", async (t) => {
  const temporary = await temporaryState(); t.after(temporary.cleanup);
  const setup = evmCore(temporary.root), rpc = setup.rpc;
  rpc.sender = (await ensureDirectWallet(setup)).address; rpc.receiptEnabled = false;
  const blocker = await setup.core.transfer.prepare({ ...EVM_REQUEST, idempotencyKey: "blocker-0001" }) as { operation_id: string };
  assert.equal((await setup.core.transfer.approve(blocker.operation_id) as { state: string }).state, "submitted_pending");
  // The CLI/MCP boundary with the fake RPC; the blocker's runtime is built without custody, so a port reading signed bytes would fail.
  const next = { ...EVM_REQUEST, idempotencyKey: "after-blocker-0001" };
  const attempt = async () => await executeBoundCommand({ request: next }, { stateRoot: temporary.root, rpc, clock: setup.clock,
    wrappingSecret: setup.wrapping, approval: setup.approval });

  // Not proven, in the case where resume would re-send: the nonce is not past and the node does not hold the hash.
  unlanded(rpc, { finalizedNonce: rpc.nonceAtomic, transactionKnown: false });
  const refused = await attempt();
  assert.deepEqual([refused.error?.code, refused.error?.details?.blockingOperationId, refused.error?.details?.blockingState,
    refused.error?.details?.blocker_observation], ["APN_OPERATION_BLOCKED", blocker.operation_id, "submitted_pending", "not_proven"]);
  assert.deepEqual(refused.next_actions, [`apn operation resume --operation ${blocker.operation_id}`], "status only reads a direct transfer");
  assert.equal(Object.hasOwn(refused, "closed_blockers"), false);
  assert.equal(rpc.broadcastCount, 1, "the settle never re-sends");
  assert.equal((await setup.state.findOperation(blocker.operation_id))?.state, "submitted_pending");

  // Proven: the finalized nonce is past and a node indexing the prepared block knows neither the transaction nor a receipt.
  unlanded(rpc, { finalizedNonce: (BigInt(rpc.nonceAtomic) + 1n).toString(), transactionKnown: false });
  const prepared = await attempt();
  assert.equal(prepared.ok, true, JSON.stringify(prepared.error));
  assert.deepEqual(prepared.closed_blockers, [{ operation_id: blocker.operation_id, family: "direct_transfer", state: "failed_proven_superseded",
    proof: "finalized_nonce_without_receipt" }]);
  assert.equal((prepared.operation as { state: string }).state, "awaiting_approval");
  assert.equal((await setup.state.findOperation(blocker.operation_id))?.state, "failed_proven_superseded");
  assert.equal(rpc.broadcastCount, 1);
  // A replay of the same prepare finds its own operation: no blocker, nothing closed again.
  const replay = await attempt();
  assert.deepEqual([replay.ok, Object.hasOwn(replay, "closed_blockers")], [true, false]);
});

test("the direct settle observes only a dispatched local transfer, in observe-only mode, and never resumes or dispatches", async (t) => {
  const temporary = await temporaryState(); t.after(temporary.cleanup);
  const setup = evmCore(temporary.root), rpc = setup.rpc;
  rpc.sender = (await ensureDirectWallet(setup)).address;
  const prepared = await setup.core.transfer.prepare({ ...EVM_REQUEST, idempotencyKey: "settle-states-0001" }) as { operation_id: string };
  const saved = (await setup.state.findOperation(prepared.operation_id))!;
  const context = new ApnCore({ state: setup.state, rpc, clock: setup.clock }).context;
  assert.equal(await directAdapter.settleIfNeverLands!(context, saved), null, "an unsigned transfer is not observed");
  assert.equal(await directAdapter.settleIfNeverLands!(context, { ...saved, state: "signed_not_submitted" }), null);

  const calls: string[] = [];
  const observation = (state: OperationRecord["state"], terminal = false) => ({
    requiredOperation: async (): Promise<OperationRecord> => ({ ...saved, state, terminal, transactionHash: `0x${"ab".repeat(32)}` as Hex }),
    observeReceipt: async (operation: LocalOperationRecord) => { calls.push(`receipt:${operation.state}`); return { operation, receipt: "absent" as const }; },
    settleUnlanded: async (operation: LocalOperationRecord, _rpc: RpcPort, observeOnly: boolean) => { calls.push(`never-lands:${observeOnly}`); return operation; },
  });
  for (const state of ["awaiting_approval", "started", "signed_not_submitted"] as const) {
    await assert.rejects(settleDispatchedDirect(context, observation(state), prepared.operation_id),
      { code: "APN_OPERATION_BLOCKED", details: { reason: "direct_settle_not_dispatched", operationId: prepared.operation_id, state } }, state);
  }
  assert.equal((await settleDispatchedDirect(context, observation("completed", true), prepared.operation_id)).state, "completed");
  assert.deepEqual(calls, [], "nothing is read for a state the settle does not observe");
  for (const state of SETTLED_DIRECT_STATES) await settleDispatchedDirect(context, observation(state), prepared.operation_id);
  assert.deepEqual(calls, ["receipt:submitted_pending", "never-lands:true", "receipt:unknown_finality", "never-lands:true"]);
  assert.equal(rpc.broadcastCount, 0);
});
