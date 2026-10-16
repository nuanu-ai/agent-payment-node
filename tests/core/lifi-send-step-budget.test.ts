import assert from "node:assert/strict";
import test from "node:test";
import { hashObject } from "../../src/canonical.js";
import { ApnError } from "../../src/errors.js";
import { BridgeAllowlistGate, bridgeUsageTarget } from "../../src/lifi/allowlist.js";
import { bridgeDeployment } from "../../src/lifi/deployments.js";
import { BridgeExecution } from "../../src/lifi/execution.js";
import { bridgeDestinationObservationRequests, bridgeSourceObservationRequests } from "../../src/lifi/observation-budget.js";
import type { BridgeOperationRecord } from "../../src/lifi/operation-model.js";
import { bridgeRpcPhysicalPolicy } from "../../src/lifi/rpc-execution-budget.js";
import { BASE_FEE_CONTRACT } from "../../src/lifi/rpc-fees.js";
import { BridgeRpcPhysicalBudget, RpcProviderScheduler, RpcReadSession, bridgeRpcFactory } from "../../src/lifi/rpc.js";
import { BRIDGE_SEND_STEP_RETRY_POSTS, bridgeSendStepPostBudget, bridgeSendStepPosts } from "../../src/lifi/send-budget.js";
import { BRIDGE_ASSET_REGISTRY, bridgePeerToken } from "../../src/lifi/asset-registry.js";
import { BRIDGE_ZERO_ADDRESS } from "../../src/lifi/validation.js";
import { transitionBridge } from "../../src/lifi/transitions.js";
import { temporaryState } from "./helpers.js";
import { lifiFixture } from "./lifi-helpers.js";
import { capturedBytecode, chainDouble, chainEnvironment, type ReceiptRoute } from "./lifi-source-observation-helpers.js";

const code = await capturedBytecode();
const effects = (op: BridgeOperationRecord) => op.effects.map((e) => [e.role, e.phase, e.submissionAttempts]);

/** A Base USDC to Arbitrum Across operation whose approval is SAFE and whose bridge is still unsigned. */
async function approvalSafe(root: string) {
  const s = await lifiFixture(root, "base-arb");
  for (const rpc of [s.source, s.destination]) rpc.deployment = async (tool, peer, token, block) => {
    const contract = bridgeDeployment(rpc.chainId, peer, tool, token), fee = rpc.chainId === 8453 ? BASE_FEE_CONTRACT : { code: [], reads: [] };
    return { chainId: rpc.chainId, peerChainId: peer, tool, block: block ?? await rpc.block("safe"), rpcOrigin: rpc.origin,
      contractHash: hashObject({ protocol: contract, feeContract: fee }), codeHash: hashObject([...contract.code, ...fee.code]),
      configurationHash: hashObject([...contract.reads, ...fee.reads]) };
  };
  const { id } = await s.prepare("across"), account = s.source.account.bind(s.source);
  // The approval invocation ends after its own SAFE observation, before the bridge guard.
  s.source.account = async (...args) => {
    if (s.source.submissions.length === 1) throw new ApnError("APN_RPC_BUDGET_EXCEEDED", "Synthetic exhausted approval invocation.");
    return await account(...args);
  };
  s.rpcSessions.length = 0;
  const approved = await s.core.execute({ command: "bridge.approve", operationId: id }); assert.equal(approved.ok, true, approved.error?.message);
  // The service caps the foreground approval invocation at its derived step: guard 21, consent refresh 2, guard 2, send 1, headroom 4.
  assert.equal(s.rpcSessions[0]!.physicalBudget!.remaining(), 30);
  const op = (await s.core.bridges.records.findOperation(id))!;
  assert.deepEqual(effects(op), [["approval", "safe_success", 1], ["bridge", "unsealed", 0]]);
  return { s, op };
}

/** One send-step invocation wired as `BridgeService.execution` wires it, over the chain double. */
function invocation(s: Awaited<ReturnType<typeof approvalSafe>>["s"], op: BridgeOperationRecord, receipt: ReceiptRoute, spentPosts: number, stepBudget = true) {
  const m = op.intent.materialization, bridge = op.effects[1]!.envelope;
  let time = s.now.getTime() + 30_000; const wait = async (ms: number) => { time += ms; };
  const chain = chainDouble([[8453, 42161, "across", m.request.fromToken], [42161, 8453, "across", m.request.toToken]], code, receipt, {
    nowSeconds: BigInt(Math.floor(time / 1000)), allowance: BigInt(m.request.amountAtomic), nonce: BigInt(bridge.economics.nonceAtomic), acceptSend: true });
  const rpcFor = bridgeRpcFactory(chainEnvironment([8453, 42161], receipt), { transport: chain.transport, wait });
  const physical = new BridgeRpcPhysicalBudget(() => time, wait, bridgeRpcPhysicalPolicy(op), stepBudget ? bridgeSendStepPostBudget(op, 3) : 0);
  (physical as unknown as { posts: number }).posts = spentPosts;
  const common = { now: () => time, wait, archiveDeploymentBatchMaxItems: 3, providerScheduler: new RpcProviderScheduler(), physicalBudget: physical };
  const sourceRequests = bridgeSourceObservationRequests(m.request.fromChainId, m.request.toChainId, m.tool, m.request.fromToken, 3);
  const destinationRequests = bridgeDestinationObservationRequests(m.request, m.tool, false, 3);
  const session = new RpcReadSession({ ...common, maxHttpRequests: 28, maxHttpAttempts: 30 });
  const seals: number[] = [], seal = s.custody.seal.bind(s.custody);
  s.custody.seal = async (...args) => { seals.push(chain.posts.length); return await seal(...args); };
  const gate = new BridgeAllowlistGate({ state: s.state, clock: { now: () => new Date(time) } }, true);
  const execution = new BridgeExecution(s.state, rpcFor(8453, session), rpcFor(42161, session), s.provider, s.custody, () => time,
    async (previous, patch) => { const next = transitionBridge(previous, patch, new Date(time).toISOString());
      await s.core.bridges.records.persist(next); await gate.follow(next, bridgeUsageTarget(next)); return next; },
    { source: () => rpcFor(8453, new RpcReadSession({ ...common, maxHttpRequests: sourceRequests, maxHttpAttempts: sourceRequests + 2 })),
      destination: () => rpcFor(42161, new RpcReadSession({ ...common, maxHttpRequests: destinationRequests, maxHttpAttempts: destinationRequests + 2 })),
      residual: () => rpcFor(8453, new RpcReadSession({ ...common, maxHttpRequests: 2, maxHttpAttempts: 3 })) }, physical);
  const sendPost = () => chain.posts.findIndex((post) => post.methods.includes("eth_sendRawTransaction")) + 1;
  return { chain, physical, execution, seals, sendPost };
}

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
  const old = await fresh(), edge = invocation(old.s, old.op, receipt, 1, false);
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
