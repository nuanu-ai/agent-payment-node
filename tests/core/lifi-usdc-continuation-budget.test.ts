import assert from "node:assert/strict";
import test from "node:test";
import { decodeFunctionData, encodeFunctionData, type Hex } from "viem";
import { hashObject } from "../../src/canonical.js";
import { bridgeDeployment } from "../../src/lifi/deployments.js";
import { acrossBridgeAbi } from "../../src/lifi/abi.js";
import { BridgeExecution } from "../../src/lifi/execution.js";
import { BridgeAllowlistGate, bridgeUsageTarget } from "../../src/lifi/allowlist.js";
import { transitionBridge } from "../../src/lifi/transitions.js";
import { bridgeRpcPhysicalPolicy } from "../../src/lifi/rpc-execution-budget.js";
import { BridgeRpcPhysicalBudget, RpcReadSession } from "../../src/lifi/rpc.js";
import { LifiTestProvider, LIFI_SYNTHETIC_SENDER, lifiFixture, lifiSteps } from "./lifi-helpers.js";
import { addressWord } from "./lifi-event-fixtures.js";
import { temporaryState } from "./helpers.js";
import { ETH_USDC, ARB_USDC, usdcBudgetSpy } from "./lifi-usdc-budget-helpers.js";

async function pendingUsdc(root: string, now: Date) {
  const step = (await lifiSteps("eth-base", now))[0]!;
  const baseToken = step.action.toToken.address;
  const transform = (v: any): any => Array.isArray(v) ? v.map(transform) : v && typeof v === "object"
    ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k, transform(x)])) : v === 8453 ? 42161 : v === baseToken ? ARB_USDC : v;
  const usdc = transform(step), decoded = decodeFunctionData({ abi: acrossBridgeAbi, data: step.transactionRequest.data });
  const args = structuredClone(decoded.args) as unknown as any[];
  args[0].receiver = LIFI_SYNTHETIC_SENDER; args[0].destinationChainId = 42161n;
  args[2].receiverAddress = addressWord(LIFI_SYNTHETIC_SENDER); args[2].receivingAssetId = addressWord(ARB_USDC);
  usdc.action.toAddress = LIFI_SYNTHETIC_SENDER; usdc.includedSteps[1].action.toAddress = LIFI_SYNTHETIC_SENDER;
  usdc.transactionRequest.data = encodeFunctionData({ abi: acrossBridgeAbi, functionName: decoded.functionName, args: args as never });
  const f = await lifiFixture(root, "eth-base", { now, provider: new LifiTestProvider([usdc], now) });
  for (const rpc of [f.source, f.destination]) {
    const original = rpc.deployment.bind(rpc);
    rpc.deployment = async (...args) => { const d = await original(...args), c = bridgeDeployment(rpc.chainId, args[1], args[0], args[2]);
      return { ...d, contractHash: hashObject({ protocol: c, feeContract: { code: [], reads: [] } }) }; };
  }
  const quoted = await f.core.execute({ command: "bridge.routes", profile: f.profile, request: { ...f.request, recipient: LIFI_SYNTHETIC_SENDER } });
  assert(quoted.ok, JSON.stringify(quoted.error));
  const prepared = await f.core.execute({ command: "bridge.prepare", profile: f.profile,
    quote: (quoted.data as { quote_hash: string }).quote_hash, route: "route-across", idempotencyKey: "usdc-budget-test-1" });
  assert(prepared.ok, JSON.stringify(prepared.error));
  const id = (prepared.operation as { operation_id: string }).operation_id;
  f.source.op = (await f.core.bridges.records.findOperation(id))!; f.destination.op = f.source.op;
  f.source.failObserve = true;
  const approved = await f.core.execute({ command: "bridge.approve", operationId: id }); assert(approved.ok);
  const op = (await f.core.bridges.records.findOperation(id))!;
  assert.equal(op.effects[0]!.submissionAttempts, 1); assert.equal(op.effects[1]!.submissionAttempts, 0);
  assert.equal(f.source.submissions.length, 1); assert.equal(f.approval.calls.length, 1);
  return { f, op, approvalRaw: f.source.submissions[0]! };
}

for (const scenario of ["old24", "typed33", "expiry", "nonce", "deployment"] as const) test(`cold USDC Across continuation ${scenario}`, async t => {
  const oldCap = scenario === "old24";
  const temp = await temporaryState(); t.after(temp.cleanup); const now = new Date("2026-10-09T03:44:00Z");
  const { f, op, approvalRaw } = await pendingUsdc(temp.root, now), spy = await usdcBudgetSpy(now, op, approvalRaw, scenario === "nonce" || scenario === "deployment" ? scenario : undefined);
  assert.equal(bridgeRpcPhysicalPolicy(op), "canonical_usdc_across_approval_continuation");
  let time = scenario === "expiry" ? Date.parse(op.intent.expiresAt) + 1 : now.getTime(); const wait = async (ms: number) => { time += ms; };
  const physical = new BridgeRpcPhysicalBudget(() => time, wait, oldCap ? "default" : bridgeRpcPhysicalPolicy(op));
  const session = new RpcReadSession({ now: () => time, wait, maxHttpRequests: 28, maxHttpAttempts: 30, archiveDeploymentBatchMaxItems: 3, physicalBudget: physical });
  const observation = new RpcReadSession({ now: () => time, wait, maxHttpRequests: 14, maxHttpAttempts: 16, archiveDeploymentBatchMaxItems: 3, physicalBudget: physical });
  const source = spy.rpcFor(1, session), destination = spy.rpcFor(42161, session), observer = spy.rpcFor(1, observation);
  const signAt: number[] = []; let signCalls = 0; const seal = f.custody.seal.bind(f.custody); f.custody.seal = async (...args) => { signCalls++; signAt.push(spy.calls.length); return seal(...args); };
  const gate = new BridgeAllowlistGate({ state: f.state, clock: { now: () => new Date(time) } }, true);
  const execution = new BridgeExecution(f.state, source, destination, f.provider, f.custody, () => time, async (previous, patch) => {
    const next = transitionBridge(previous, patch, new Date(time).toISOString()); await f.core.bridges.records.persist(next);
    await gate.follow(next, bridgeUsageTarget(next)); return next;
  }, { source: () => observer, destination: () => destination, residual: () => source }, physical);
  const resumed = await execution.resume(op);
  const continuationTrace = structuredClone(spy.calls);

  assert.equal(resumed.effects[0]!.transactionHash, op.effects[0]!.transactionHash); assert.equal(resumed.effects[0]!.submissionAttempts, 1);
  assert.equal(f.source.submissions.length, 1); assert.equal(f.approval.calls.length, 1);
  assert(spy.calls.filter(x => x.host.includes("archive")).every(x => x.items.length <= 3));
  if (scenario !== "typed33") {
    assert.equal(signCalls, 0); assert.equal(spy.submissions.length, 0); assert.equal(resumed.effects[1]!.phase, "unsealed");
    assert.equal(resumed.effects[1]!.submissionAttempts, 0);
    if (oldCap) assert.equal(physical.remaining(), 0);
  }
  else {
    assert.equal(signCalls, 1); assert.equal(spy.submissions.length, 1); assert.equal(resumed.effects[1]!.submissionAttempts, 1);
    assert.equal(spy.calls.length, 33); assert.deepEqual(signAt, [30]); assert.equal(physical.remaining(), 0);
    await assert.rejects(physical.beforePost("eth_getBlockByNumber"), { code: "APN_RPC_BUDGET_EXCEEDED" });
    assert.equal(spy.calls.length, 33); assert.equal(bridgeRpcPhysicalPolicy(resumed), "default");
    // A fresh observation invocation may remain pending, but attempt1 must never load/sign/send the original wire again.
    const freshPhysical = new BridgeRpcPhysicalBudget(() => time, wait, bridgeRpcPhysicalPolicy(resumed));
    assert.equal(freshPhysical.remaining(), 24);
    const freshRead = new RpcReadSession({ now: () => time, wait, maxHttpRequests: 14, maxHttpAttempts: 16,
      archiveDeploymentBatchMaxItems: 3, physicalBudget: freshPhysical });
    const freshSource = spy.rpcFor(1, freshRead), freshDestination = spy.rpcFor(42161, freshRead);
    const freshExecution = new BridgeExecution(f.state, freshSource, freshDestination, f.provider, f.custody, () => time,
      async (previous, patch) => { const next = transitionBridge(previous, patch, new Date(time).toISOString());
        await f.core.bridges.records.persist(next); await gate.follow(next, bridgeUsageTarget(next)); return next; },
      { source: () => freshSource, destination: () => freshDestination, residual: () => freshSource }, freshPhysical);
    const again = await freshExecution.resume(resumed); assert.equal(again.effects[1]!.submissionAttempts, 1);
    assert(freshPhysical.remaining() < 24); assert(freshPhysical.remaining() >= 0);
    assert.equal(signCalls, 1); assert.equal(spy.submissions.length, 1);
  }
  console.log(JSON.stringify({ scenario, continuationPhysicalPosts: continuationTrace.length, laterObservationPosts: spy.calls.length - continuationTrace.length, methods: continuationTrace.map(x => ({ host: x.host, methods: x.items.map(y => y.method) })), sourceSigns: signCalls, sourceSends: spy.submissions.length }));
});

test("USDC continuation rejects lookalike pair, tool, effect and deployment pins", async t => {
  const temp = await temporaryState(); t.after(temp.cleanup); const { op } = await pendingUsdc(temp.root, new Date("2026-10-09T03:44:00Z"));
  const m = op.intent.materialization;
  for (const changed of [
    { ...op, terminal: true },
    { ...op, intent: { ...op.intent, policyHash: "0".repeat(64) } },
    { ...op, intent: { ...op.intent, materialization: { ...m, tool: "stargateV2" as const } } },
    { ...op, intent: { ...op.intent, materialization: { ...m, request: { ...m.request, toChainId: 8453 as const } } } },
    { ...op, intent: { ...op.intent, materialization: { ...m, request: { ...m.request, fromToken: ARB_USDC } } } },
    { ...op, intent: { ...op.intent, sourceDeployment: { ...op.intent.sourceDeployment, codeHash: "0".repeat(64) } } },
    { ...op, intent: { ...op.intent, destinationDeployment: { ...op.intent.destinationDeployment, configurationHash: "0".repeat(64) } } },
    { ...op, effects: op.effects.map(e => e.role === "bridge" ? { ...e, submissionAttempts: 1 as const } : e) },
    { ...op, effects: op.effects.slice(1) },
  ]) assert.equal(bridgeRpcPhysicalPolicy(changed), "default");
  assert.equal(new BridgeRpcPhysicalBudget().remaining(), 24);
});
