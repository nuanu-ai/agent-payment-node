import assert from "node:assert/strict";
import { ApnError } from "../../src/errors.js";
import { BridgeAllowlistGate, bridgeUsageTarget } from "../../src/lifi/allowlist.js";
import { BridgeExecution } from "../../src/lifi/execution.js";
import { bridgeDestinationObservationRequests, bridgeSourceObservationRequests } from "../../src/lifi/observation-budget.js";
import type { BridgeOperationRecord } from "../../src/lifi/operation-model.js";
import { BridgeRpcPhysicalBudget, RpcProviderScheduler, RpcReadSession, bridgeRpcFactory } from "../../src/lifi/rpc.js";
import { bridgeInvocationPostBudget, bridgeSendStepPostBudget } from "../../src/lifi/send-budget.js";
import { transitionBridge } from "../../src/lifi/transitions.js";
import { lifiFixture } from "./lifi-helpers.js";
import { capturedBytecode, chainDouble, chainEnvironment, type ReceiptRoute } from "./lifi-source-observation-helpers.js";
import { findStored } from "./stored-operations.js";

const code = await capturedBytecode();
export const effects = (op: BridgeOperationRecord) => op.effects.map((e) => [e.role, e.phase, e.submissionAttempts]);

/** A Base USDC to Arbitrum Across operation whose approval is SAFE and whose bridge is still unsigned. */
export async function approvalSafe(root: string) {
  const s = await lifiFixture(root, "base-arb");
  const { id, operation: prepared } = await s.prepare("across"), account = s.source.account.bind(s.source);
  // The approval invocation ends after its own SAFE observation, before the bridge guard.
  s.source.account = async (...args) => {
    if (s.source.submissions.length === 1) throw new ApnError("APN_RPC_BUDGET_EXCEEDED", "Synthetic exhausted approval invocation.");
    return await account(...args);
  };
  s.rpcSessions.length = 0;
  const approved = await s.core.execute({ command: "bridge.approve", operationId: id }); assert.equal(approved.ok, true, approved.error?.message);
  // The service derives the foreground approval invocation cap from the read plans: send step 11 (guard 1 before and 1 after
  // consent, account re-check 1, send 1, the bridge's account guard, re-check and send 3, headroom 4) plus the source
  // observation (2 effects x 2 passes x 4 + 2), destination (4 + 2) and residual (1 + 1) sessions.
  assert.equal(s.rpcSessions[0]!.physicalBudget!.remaining(), bridgeInvocationPostBudget(prepared));
  assert.equal(bridgeInvocationPostBudget(prepared), 11 + 18 + 6 + 2);
  const op = (await findStored(s.core.bridges.records, id))!;
  assert.deepEqual(effects(op), [["approval", "safe_success", 1], ["bridge", "unsealed", 0]]);
  return { s, op };
}

/** One send-step invocation wired as `BridgeService.execution` wires it, over the chain double. */
export function invocation(s: Awaited<ReturnType<typeof approvalSafe>>["s"], op: BridgeOperationRecord, receipt: ReceiptRoute, spentPosts: number,
  options: { readonly at?: number; readonly allowance?: bigint; readonly limit?: Parameters<typeof chainDouble>[3]["limit"] } = {}) {
  const m = op.intent.materialization, bridge = op.effects[1]!.envelope;
  let time = options.at ?? s.now.getTime() + 30_000; const wait = async (ms: number) => { time += ms; };
  const chain = chainDouble([[8453, 42161, "across", m.request.fromToken], [42161, 8453, "across", m.request.toToken]], code, receipt, {
    nowSeconds: BigInt(Math.floor(time / 1000)), allowance: options.allowance ?? BigInt(m.request.amountAtomic), nonce: BigInt(bridge.economics.nonceAtomic),
    acceptSend: true, ...(options.limit === undefined ? {} : { limit: options.limit }) });
  const rpcFor = bridgeRpcFactory(chainEnvironment([8453, 42161], receipt), { transport: chain.transport, wait });
  const physical = new BridgeRpcPhysicalBudget(bridgeInvocationPostBudget(op));
  (physical as unknown as { posts: number }).posts = spentPosts;
  const common = { now: () => time, wait, providerScheduler: new RpcProviderScheduler(), physicalBudget: physical };
  const sourceRequests = bridgeSourceObservationRequests(op.effects.length), destinationRequests = bridgeDestinationObservationRequests(m.request, false);
  const step = Math.max(1, bridgeSendStepPostBudget(op)), session = new RpcReadSession({ ...common, maxHttpRequests: step, maxHttpAttempts: step });
  const seals: number[] = [], seal = s.custody.seal.bind(s.custody);
  s.custody.seal = async (...args) => { seals.push(chain.posts.length); return await seal(...args); };
  const gate = new BridgeAllowlistGate({ state: s.state, clock: { now: () => new Date(time) } }, true);
  const execution = new BridgeExecution(s.state, rpcFor(8453, session), rpcFor(42161, session), s.provider, s.custody, () => time,
    async (previous, patch) => { const next = transitionBridge(previous, patch, new Date(time).toISOString());
      await s.core.bridges.records.persist(next); await gate.follow(next, bridgeUsageTarget(next)); return next; },
    { source: () => rpcFor(8453, new RpcReadSession({ ...common, maxHttpRequests: sourceRequests, maxHttpAttempts: sourceRequests + 2 })),
      destination: () => rpcFor(42161, new RpcReadSession({ ...common, maxHttpRequests: destinationRequests, maxHttpAttempts: destinationRequests + 2 })),
      residual: () => rpcFor(8453, new RpcReadSession({ ...common, maxHttpRequests: 1, maxHttpAttempts: 2 })) }, physical);
  const sendPost = () => chain.posts.findIndex((post) => post.methods.includes("eth_sendRawTransaction")) + 1;
  return { chain, physical, execution, seals, sendPost };
}
