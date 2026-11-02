import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";
import { keccak256, type Hex } from "viem";
import { ApnCore } from "../../src/core.js";
import { settleDispatchedDirect, SETTLED_DIRECT_STATES } from "../../src/direct-transfer-settle.js";
import { ApnError } from "../../src/errors.js";
import type { FinalizedBatchRead } from "../../src/evm-finalized-proof.js";
import { EvmRpc } from "../../src/evm-rpc.js";
import type { OperationRecord } from "../../src/model.js";
import { settleBlockerAndRetry } from "../../src/operation-auto-settle.js";
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

/** A local transfer on Base dispatched and not yet observed (submitted_pending), and the next prepare of the same account. */
async function dispatched(t: test.TestContext) {
  const temporary = await temporaryState(); t.after(temporary.cleanup);
  const setup = evmCore(temporary.root), rpc = setup.rpc;
  rpc.sender = (await ensureDirectWallet(setup)).address; rpc.receiptEnabled = false;
  const blocker = await setup.core.transfer.prepare({ ...EVM_REQUEST, idempotencyKey: "blocker-0001" }) as { operation_id: string };
  assert.equal((await setup.core.transfer.approve(blocker.operation_id) as { state: string }).state, "submitted_pending");
  const saved = (await setup.state.findOperation(blocker.operation_id))!;
  const recordPath = join(temporary.root, "operations", saved.profileHash, `${saved.operationId}.json`);
  return { root: temporary.root, setup, rpc, id: blocker.operation_id, recordPath, bytes: await readFile(recordPath, "utf8"),
    next: { ...EVM_REQUEST, idempotencyKey: "after-blocker-0001" } };
}

test("the next prepare closes a dispatched transfer proven never to land and then runs; an unproven one stays and nothing is re-sent", async (t) => {
  const { root, setup, rpc, id, next } = await dispatched(t);
  // The CLI/MCP boundary with the fake RPC; the blocker's runtime is built without custody, so a port reading signed bytes would fail.
  const attempt = async () => await executeBoundCommand({ request: next, rpcUrl: "https://base.example" }, { stateRoot: root, rpc, clock: setup.clock,
    wrappingSecret: setup.wrapping, approval: setup.approval });

  // Not proven, in the case where resume would re-send: the nonce is not past and the node does not hold the hash.
  unlanded(rpc, { finalizedNonce: rpc.nonceAtomic, transactionKnown: false });
  const refused = await attempt();
  assert.deepEqual([refused.error?.code, refused.error?.details?.blockingOperationId, refused.error?.details?.blockingState,
    refused.error?.details?.blocker_observation], ["APN_OPERATION_BLOCKED", id, "submitted_pending", "not_proven"]);
  assert.deepEqual(refused.next_actions, [`apn operation status --operation ${id}`, `apn operation resume --operation ${id} --rpc-url https://base.example`],
    "status stays first; resume, which observes a dispatched transfer, follows with the invocation's RPC");
  assert.equal(Object.hasOwn(refused, "closed_blockers"), false);
  assert.equal(rpc.broadcastCount, 1, "the settle never re-sends");
  assert.equal((await setup.state.findOperation(id))?.state, "submitted_pending");

  // Proven: the finalized nonce is past and a node indexing the prepared block knows neither the transaction nor a receipt.
  unlanded(rpc, { finalizedNonce: (BigInt(rpc.nonceAtomic) + 1n).toString(), transactionKnown: false });
  const prepared = await attempt();
  assert.equal(prepared.ok, true, JSON.stringify(prepared.error));
  assert.deepEqual(prepared.closed_blockers, [{ operation_id: id, family: "direct_transfer", state: "failed_proven_superseded",
    proof: "finalized_nonce_without_receipt" }]);
  assert.equal((prepared.operation as { state: string }).state, "awaiting_approval");
  assert.equal((await setup.state.findOperation(id))?.state, "failed_proven_superseded");
  assert.equal(rpc.broadcastCount, 1);
  // A replay of the same prepare finds its own operation: no blocker, nothing closed again.
  const replay = await attempt();
  assert.deepEqual([replay.ok, Object.hasOwn(replay, "closed_blockers")], [true, false]);
});

test("without an RPC the settle is refused by its RPC requirement, which the refusal names; nothing is written or appended", async (t) => {
  const { root, setup, rpc, id, next, recordPath, bytes } = await dispatched(t);
  const refused = await executeBoundCommand({ request: next }, { stateRoot: root, clock: setup.clock, wrappingSecret: setup.wrapping, approval: setup.approval });
  assert.deepEqual([refused.error?.code, refused.error?.details?.blocker_observation, refused.error?.details?.blocker_error_code],
    ["APN_OPERATION_BLOCKED", "unavailable", "APN_RPC_CONFIG"]);
  assert.equal(typeof refused.error?.details?.blocker_error_message, "string");
  assert.deepEqual(refused.next_actions, [`apn operation status --operation ${id}`], "a resume without an RPC would not run as typed");
  assert.equal(await readFile(recordPath, "utf8"), bytes);
  assert.equal(rpc.broadcastCount, 1);
});

test("an RPC of another chain is asked its chain id alone: the blocker's hash is never sent to it and nothing is written", async (t) => {
  const { root, setup, id, next, recordPath, bytes } = await dispatched(t);
  // The production EVM reader over a logging transport: one entry per POST, as the provider would see it.
  const posts: string[][] = [];
  const call = async (method: string): Promise<unknown> => { posts.push([method]); if (method === "eth_chainId") return "0xa"; throw new Error(`unexpected ${method}`); };
  const batch = async (calls: readonly { readonly method: string }[]): Promise<readonly unknown[]> => {
    posts.push(calls.map(item => item.method)); throw new Error("unexpected batch");
  };
  const other = { evm: new EvmRpc(async method => await call(method), "https://optimism.example", undefined, async calls => await batch(calls)) } as unknown as RpcPort;
  const refused = await settleBlockerAndRetry({ request: next, rpcUrl: "https://optimism.example" }, root, async () => await setup.core.execute(next),
    () => new ApnCore({ state: setup.state, rpc: other, clock: setup.clock }).context);
  assert.deepEqual([refused.error?.details?.blocker_observation, refused.error?.details?.blocker_error_code], ["unavailable", "APN_CHAIN_MISMATCH"]);
  assert.deepEqual(refused.next_actions, [`apn operation status --operation ${id}`], "an RPC that failed the chain check is never named");
  assert.deepEqual(posts, [["eth_chainId"]], "no receipt, transaction or nonce request names the blocker");
  assert.equal(await readFile(recordPath, "utf8"), bytes);
  assert.equal((await setup.state.findOperation(id))?.state, "submitted_pending");
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
  assert.deepEqual([directAdapter.observeCommand!(saved), directAdapter.observeCommand!({ ...saved, state: "signed_not_submitted" })], [undefined, undefined],
    "no observing command is named for a state resume would not observe");
  assert.equal(directAdapter.observeCommand!({ ...saved, state: "unknown_finality" }), "apn operation resume --operation <operation-id> --rpc-url <https-url>");

  const calls: string[] = [];
  const observation = (state: OperationRecord["state"], terminal = false, record: OperationRecord = saved) => ({
    requiredOperation: async (): Promise<OperationRecord> => ({ ...record, state, terminal, transactionHash: `0x${"ab".repeat(32)}` as Hex }),
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

  // A Base USDC record (no explicit EVM binding) proves its endpoint with the Base chain assertion, before any receipt read.
  const { evm: _evm, ...legacy } = saved, legacyCalls: string[] = [];
  const base = new EvmTestRpc();
  Object.assign(base, { armEvmDirectRpcGuard: () => { legacyCalls.push("guard"); }, assertBaseChain: async () => {
    legacyCalls.push("chain"); if (base.chainId !== 8453) throw new ApnError("APN_CHAIN_MISMATCH", "RPC endpoint is not Base chain ID 8453.");
    return { chainId: 8453 as const, rpcOrigin: base.rpcOrigin }; } });
  const baseContext = new ApnCore({ state: setup.state, rpc: base, clock: setup.clock }).context;
  calls.length = 0;
  await settleDispatchedDirect(baseContext, observation("submitted_pending", false, legacy as OperationRecord), prepared.operation_id);
  assert.deepEqual([legacyCalls, calls], [["guard", "chain"], ["receipt:submitted_pending", "never-lands:true"]]);
  base.chainId = 10; legacyCalls.length = 0; calls.length = 0;
  await assert.rejects(settleDispatchedDirect(baseContext, observation("submitted_pending", false, legacy as OperationRecord), prepared.operation_id),
    { code: "APN_CHAIN_MISMATCH" });
  assert.deepEqual([legacyCalls, calls], [["guard", "chain"], []], "another chain's endpoint is never asked for the receipt");
});
