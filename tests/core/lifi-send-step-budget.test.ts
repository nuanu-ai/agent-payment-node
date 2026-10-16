import assert from "node:assert/strict";
import test from "node:test";
import { bridgeDeployment } from "../../src/lifi/deployments.js";
import { BRIDGE_SEND_STEP_RETRY_POSTS, bridgeSendStepPostBudget, bridgeSendStepPosts } from "../../src/lifi/send-budget.js";
import { BRIDGE_ASSET_REGISTRY, bridgePeerToken } from "../../src/lifi/asset-registry.js";
import { BRIDGE_ZERO_ADDRESS } from "../../src/lifi/validation.js";
import { temporaryState } from "./helpers.js";
import { approvalSafe, effects, invocation } from "./lifi-send-step-helpers.js";

for (const receipt of ["primary", "fallback", "batch", "scalar"] as const) test(`Base USDC to Arbitrum Across send step signs and sends with derived headroom (${receipt} receipt)`, async (t) => {
  const temporary = await temporaryState(); t.after(temporary.cleanup);
  const { s, op } = await approvalSafe(temporary.root), limit = bridgeSendStepPostBudget(op, 3);
  assert.equal(limit, 24 + BRIDGE_SEND_STEP_RETRY_POSTS);
  const run = invocation(s, op, receipt, 0), sent = await run.execution.resume(op);
  // Guard 21 (two safe heads, 10 Base and 7 Arbitrum deployment chunks, two account batches), seal, guard 2, send.
  assert.deepEqual(run.seals, [21]); assert.equal(run.sendPost(), 24); assert.equal(run.chain.sent.length, 1);
  assert.equal(sent.effects[1]!.submissionAttempts, 1); assert.equal(sent.terminal, false);
  // Four further retried POSTs before the send still fit; the 0.5.40 cap of 24 leaves the signed bridge unsent after one.
  const fresh = async () => { const state = await temporaryState(); t.after(state.cleanup); return await approvalSafe(state.root); };
  const retried = await fresh(), late = invocation(retried.s, retried.op, receipt, BRIDGE_SEND_STEP_RETRY_POSTS);
  assert.equal((await late.execution.resume(retried.op)).effects[1]!.submissionAttempts, 1); assert.equal(late.sendPost(), 24);
  const old = await fresh(), edge = invocation(old.s, old.op, receipt, 1, { stepBudget: false });
  const sealed = await edge.execution.resume(old.op);
  assert.deepEqual(effects(sealed)[1], ["bridge", "sealed", 0]); assert.equal(edge.chain.sent.length, 0); assert.equal(edge.physical.remaining(), 0);
});

test("an earlier exhausted send-step budget refuses before signing and a fresh invocation sends", async (t) => {
  const temporary = await temporaryState(); t.after(temporary.cleanup);
  const { s, op } = await approvalSafe(temporary.root), limit = bridgeSendStepPostBudget(op, 3);
  for (const spent of [limit - 10, limit - 21]) {
    const run = invocation(s, op, "scalar", spent), refused = await run.execution.resume(op);
    assert.deepEqual(effects(refused), [["approval", "safe_success", 1], ["bridge", "unsealed", 0]]);
    assert.equal(refused.terminal, false); assert.equal(refused.failure, null);
    assert.deepEqual(run.seals, []); assert.equal(run.chain.sent.length, 0); assert.equal(run.physical.remaining(), 0);
  }
  const fresh = invocation(s, op, "scalar", 0), sent = await fresh.execution.resume(op);
  assert.equal(sent.effects[1]!.submissionAttempts, 1); assert.equal(fresh.sendPost(), 24); assert.equal(fresh.chain.sent.length, 1);
});

test("bridge service caps the post-approval send invocation at its derived step plus headroom", async (t) => {
  const temporary = await temporaryState(); t.after(temporary.cleanup);
  const { s, op } = await approvalSafe(temporary.root); s.rpcSessions.length = 0;
  const resumed = await s.core.execute({ command: "operation.resume", operationId: op.operationId }); assert.equal(resumed.ok, true, resumed.error?.message);
  assert.equal(s.rpcSessions[0]!.physicalBudget!.remaining(), 28);
});

test("every admitted route's derived send step, consent refresh and retry headroom fit the command session caps", () => {
  const steps: number[] = [];
  for (const chainId of [1, 8453, 42161] as const) for (const asset of [BRIDGE_ASSET_REGISTRY[chainId].nativeCoin, ...BRIDGE_ASSET_REGISTRY[chainId].tokens]) {
    for (const peer of asset.peers) for (const tool of ["across", "stargateV2"] as const) {
      let request;
      try {
        request = { fromChainId: chainId, toChainId: peer, fromToken: asset.kind === "native" ? BRIDGE_ZERO_ADDRESS : asset.address,
          toToken: asset.kind === "native" ? BRIDGE_ZERO_ADDRESS : bridgePeerToken(asset, peer).address };
        bridgeDeployment(chainId, peer, tool, request.fromToken); bridgeDeployment(peer, chainId, tool, request.toToken);
      } catch { continue; }
      const reads = bridgeSendStepPosts(request, tool, { consent: true, retained: null }, 3) - 1;
      assert(reads <= 28 && reads + BRIDGE_SEND_STEP_RETRY_POSTS <= 30, `${chainId}->${peer} ${tool}: ${reads}`); steps.push(reads + 1);
    }
  }
  assert.equal(steps.length, 25); assert.equal(Math.max(...steps), 26);
});
