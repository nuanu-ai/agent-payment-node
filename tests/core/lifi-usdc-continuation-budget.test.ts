import assert from "node:assert/strict";
import test from "node:test";
import { decodeFunctionData, encodeFunctionData, type Hex } from "viem";
import { acrossBridgeAbi } from "../../src/lifi/abi.js";
import { BridgeExecution } from "../../src/lifi/execution.js";
import { BridgeAllowlistGate, bridgeUsageTarget } from "../../src/lifi/allowlist.js";
import { transitionBridge } from "../../src/lifi/transitions.js";
import { bridgeInvocationPostBudget, bridgeSendStepPostBudget } from "../../src/lifi/send-budget.js";
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

for (const scenario of ["derived", "tight", "expiry", "nonce", "deployment"] as const) test(`cold USDC Across continuation ${scenario}`, async t => {
  const temp = await temporaryState(); t.after(temp.cleanup); const now = new Date("2026-10-09T03:44:00Z");
  const { f, op, approvalRaw } = await pendingUsdc(temp.root, now), spy = await usdcBudgetSpy(now, op, approvalRaw, scenario === "nonce" || scenario === "deployment" ? scenario : undefined);
  let time = scenario === "expiry" ? Date.parse(op.intent.expiresAt) + 1 : now.getTime(); const wait = async (ms: number) => { time += ms; };
  // The approval observation (primary batch, receipt reader, inclusion header) and the bridge guard take four POSTs;
  // signing needs two more for the account re-check and the single send.
  const physical = new BridgeRpcPhysicalBudget(scenario === "tight" ? 5 : bridgeInvocationPostBudget(op));
  const step = bridgeSendStepPostBudget(op), session = new RpcReadSession({ now: () => time, wait, maxHttpRequests: step, maxHttpAttempts: step, physicalBudget: physical });
  const observation = new RpcReadSession({ now: () => time, wait, maxHttpRequests: 8, maxHttpAttempts: 10, physicalBudget: physical });
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
  assert.ok(spy.calls.every(x => !x.host.includes("archive")));
  if (scenario === "tight") {
    assert.equal(signCalls, 0); assert.equal(spy.submissions.length, 0); assert.equal(resumed.effects[1]!.phase, "unsealed");
    assert.equal(spy.calls.length, 4); assert.equal(physical.remaining(), 1); assert.equal(resumed.terminal, false);
  }
  else if (scenario !== "derived") {
    assert.equal(signCalls, 0); assert.equal(spy.submissions.length, 0); assert.equal(resumed.effects[1]!.phase, "unsealed");
    assert.equal(resumed.effects[1]!.submissionAttempts, 0); assert.equal(resumed.state, "failed_after_approval");
  }
  else {
    assert.equal(signCalls, 1); assert.equal(spy.submissions.length, 1); assert.equal(resumed.effects[1]!.submissionAttempts, 1);
    assert.deepEqual(signAt, [4]); assert.equal(spy.calls.length, 7);
    assert.equal(spy.calls.filter(x => x.items.some(y => y.method === "eth_sendRawTransaction")).length, 1);
    // A fresh observation invocation may remain pending, but it must never load/sign/send the original wire again.
    const freshPhysical = new BridgeRpcPhysicalBudget(bridgeInvocationPostBudget(resumed));
    const freshRead = new RpcReadSession({ now: () => time, wait, maxHttpRequests: 8, maxHttpAttempts: 10, physicalBudget: freshPhysical });
    const freshSource = spy.rpcFor(1, freshRead), freshDestination = spy.rpcFor(42161, freshRead);
    const freshExecution = new BridgeExecution(f.state, freshSource, freshDestination, f.provider, f.custody, () => time,
      async (previous, patch) => { const next = transitionBridge(previous, patch, new Date(time).toISOString());
        await f.core.bridges.records.persist(next); await gate.follow(next, bridgeUsageTarget(next)); return next; },
      { source: () => freshSource, destination: () => freshDestination, residual: () => freshSource }, freshPhysical);
    const again = await freshExecution.resume(resumed); assert.equal(again.effects[1]!.submissionAttempts, 1);
    assert(freshPhysical.remaining() >= 0);
    assert.equal(signCalls, 1); assert.equal(spy.submissions.length, 1);
  }
  console.log(JSON.stringify({ scenario, continuationPhysicalPosts: continuationTrace.length, laterObservationPosts: spy.calls.length - continuationTrace.length, methods: continuationTrace.map(x => ({ host: x.host, methods: x.items.map(y => y.method) })), sourceSigns: signCalls, sourceSends: spy.submissions.length }));
});

test("the derived continuation cap is route-generic and ends with the operation", async t => {
  const temp = await temporaryState(); t.after(temp.cleanup); const { op } = await pendingUsdc(temp.root, new Date("2026-10-09T03:44:00Z"));
  const m = op.intent.materialization;
  // A lookalike pair or another tool gets its own plan-derived cap, not a refusal and not a borrowed pair constant.
  for (const changed of [
    { ...op, intent: { ...op.intent, materialization: { ...m, request: { ...m.request, toChainId: 8453 as const, toToken: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913" as const } } } },
    { ...op, intent: { ...op.intent, materialization: { ...m, tool: "stargateV2" as const } } },
  ]) assert.equal(bridgeInvocationPostBudget(changed), bridgeInvocationPostBudget(op));
  assert.equal(bridgeInvocationPostBudget({ ...op, terminal: true }), 0);
});
