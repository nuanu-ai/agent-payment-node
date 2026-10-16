import assert from "node:assert/strict";
import test from "node:test";
import { bridgeDeployment } from "../../src/lifi/deployments.js";
import { BRIDGE_SEND_STEP_RETRY_POSTS, bridgeInvocationPostBudget, bridgeSendStepPostBudget, bridgeSendStepPosts } from "../../src/lifi/send-budget.js";
import { BRIDGE_ASSET_REGISTRY, bridgePeerToken } from "../../src/lifi/asset-registry.js";
import { BRIDGE_ZERO_ADDRESS } from "../../src/lifi/validation.js";
import { temporaryState } from "./helpers.js";
import { approvalSafe, effects, invocation } from "./lifi-send-step-helpers.js";

for (const receipt of ["primary", "fallback", "batch", "scalar"] as const) test(`Base USDC to Arbitrum Across send step signs after one POST and sends at the third (${receipt} receipt)`, async (t) => {
  const temporary = await temporaryState(); t.after(temporary.cleanup);
  const { s, op } = await approvalSafe(temporary.root);
  assert.equal(bridgeSendStepPostBudget(op), 3 + BRIDGE_SEND_STEP_RETRY_POSTS);
  const run = invocation(s, op, receipt, 0), sent = await run.execution.resume(op);
  // Guard 1 (source check, account, fee inputs and the bridge simulation in one primary batch), seal, account re-check, send.
  assert.deepEqual(run.seals, [1]); assert.equal(run.sendPost(), 3); assert.equal(run.chain.sent.length, 1);
  assert.ok(run.chain.posts.every((post) => post.role === "primary" || post.role === "receipt"));
  assert.equal(sent.effects[1]!.submissionAttempts, 1); assert.equal(sent.terminal, false);
  const fresh = async () => { const state = await temporaryState(); t.after(state.cleanup); return await approvalSafe(state.root); };
  // Retried POSTs earlier in the invocation still leave the step room to sign and send.
  const retried = await fresh(), late = invocation(retried.s, retried.op, receipt, BRIDGE_SEND_STEP_RETRY_POSTS);
  assert.equal((await late.execution.resume(retried.op)).effects[1]!.submissionAttempts, 1); assert.equal(late.sendPost(), 3);
  // With only the guard's POST and one more left, nothing is signed: the re-check and the send must both fit after sealing.
  const edge = await fresh(), tight = invocation(edge.s, edge.op, receipt, bridgeInvocationPostBudget(edge.op) - 2);
  const unsigned = await tight.execution.resume(edge.op);
  assert.deepEqual(effects(unsigned)[1], ["bridge", "unsealed", 0]); assert.deepEqual(tight.seals, []); assert.equal(tight.chain.sent.length, 0);
  const room = await fresh(), exact = invocation(room.s, room.op, receipt, bridgeInvocationPostBudget(room.op) - 3);
  assert.equal((await exact.execution.resume(room.op)).effects[1]!.submissionAttempts, 1); assert.equal(exact.physical.remaining(), 0);
});

test("an earlier exhausted invocation refuses before signing and a fresh invocation sends", async (t) => {
  const temporary = await temporaryState(); t.after(temporary.cleanup);
  const { s, op } = await approvalSafe(temporary.root), limit = bridgeInvocationPostBudget(op);
  const run = invocation(s, op, "scalar", limit), refused = await run.execution.resume(op);
  assert.deepEqual(effects(refused), [["approval", "safe_success", 1], ["bridge", "unsealed", 0]]);
  assert.equal(refused.terminal, false); assert.equal(refused.failure, null);
  assert.deepEqual(run.seals, []); assert.equal(run.chain.sent.length, 0); assert.equal(run.chain.posts.length, 0);
  const fresh = invocation(s, op, "scalar", 0), sent = await fresh.execution.resume(op);
  assert.equal(sent.effects[1]!.submissionAttempts, 1); assert.equal(fresh.sendPost(), 3); assert.equal(fresh.chain.sent.length, 1);
});

test("bridge service caps the post-approval send invocation at its derived step plus observation sessions", async (t) => {
  const temporary = await temporaryState(); t.after(temporary.cleanup);
  const { s, op } = await approvalSafe(temporary.root); s.rpcSessions.length = 0;
  const resumed = await s.core.execute({ command: "operation.resume", operationId: op.operationId }); assert.equal(resumed.ok, true, resumed.error?.message);
  // Send step 7 (guard 1, re-check 1, send 1, headroom 4) plus source 18, destination 6 and residual 2.
  assert.equal(s.rpcSessions[0]!.physicalBudget!.remaining(), bridgeInvocationPostBudget(op));
  assert.equal(bridgeInvocationPostBudget(op), 7 + 18 + 6 + 2);
  assert.equal(bridgeInvocationPostBudget({ ...op, effects: op.effects.map((e) => ({ ...e, submissionAttempts: 1 as const })) }), 18 + 6 + 2);
  assert.equal(bridgeInvocationPostBudget({ ...op, terminal: true }), 0);
});

test("every admitted route's derived send step is a handful of primary POSTs", () => {
  const steps: number[] = [];
  for (const chainId of [1, 8453, 42161] as const) for (const asset of [BRIDGE_ASSET_REGISTRY[chainId].nativeCoin, ...BRIDGE_ASSET_REGISTRY[chainId].tokens]) {
    for (const peer of asset.peers) for (const tool of ["across", "stargateV2"] as const) {
      let request;
      try {
        request = { fromChainId: chainId, toChainId: peer, fromToken: asset.kind === "native" ? BRIDGE_ZERO_ADDRESS : asset.address,
          toToken: asset.kind === "native" ? BRIDGE_ZERO_ADDRESS : bridgePeerToken(asset, peer).address };
        bridgeDeployment(chainId, peer, tool, request.fromToken); bridgeDeployment(peer, chainId, tool, request.toToken);
      } catch { continue; }
      const { fromToken: _source, ...route } = request;
      steps.push(bridgeSendStepPosts(route, tool, { consent: true, effects: asset.kind === "native" ? 1 : 2 }));
    }
  }
  // Token routes: guard before and after consent, re-check, send, then the bridge's guard, re-check and send. The BNB
  // composite destination adds its routing check to each full guard.
  assert.equal(steps.length, 25); assert.equal(Math.max(...steps), 7); assert.equal(Math.min(...steps), 4);
  assert.equal(bridgeSendStepPosts({ fromChainId: 1, toChainId: 56, toToken: BRIDGE_ZERO_ADDRESS }, "across", { consent: true, effects: 1 }), 6);
});
