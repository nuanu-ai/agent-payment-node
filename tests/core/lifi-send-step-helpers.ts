import assert from "node:assert/strict";
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
import { bridgeSendStepPostBudget } from "../../src/lifi/send-budget.js";
import { transitionBridge } from "../../src/lifi/transitions.js";
import { lifiFixture } from "./lifi-helpers.js";
import { capturedBytecode, chainDouble, chainEnvironment, type ReceiptRoute } from "./lifi-source-observation-helpers.js";

const code = await capturedBytecode();
export const effects = (op: BridgeOperationRecord) => op.effects.map((e) => [e.role, e.phase, e.submissionAttempts]);

/** A Base USDC to Arbitrum Across operation whose approval is SAFE and whose bridge is still unsigned. */
export async function approvalSafe(root: string) {
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
export function invocation(s: Awaited<ReturnType<typeof approvalSafe>>["s"], op: BridgeOperationRecord, receipt: ReceiptRoute, spentPosts: number,
  options: { readonly stepBudget?: boolean; readonly at?: number; readonly allowance?: bigint; readonly limit?: Parameters<typeof chainDouble>[3]["limit"] } = {}) {
  const m = op.intent.materialization, bridge = op.effects[1]!.envelope;
  let time = options.at ?? s.now.getTime() + 30_000; const wait = async (ms: number) => { time += ms; };
  const chain = chainDouble([[8453, 42161, "across", m.request.fromToken], [42161, 8453, "across", m.request.toToken]], code, receipt, {
    nowSeconds: BigInt(Math.floor(time / 1000)), allowance: options.allowance ?? BigInt(m.request.amountAtomic), nonce: BigInt(bridge.economics.nonceAtomic),
    acceptSend: true, ...(options.limit === undefined ? {} : { limit: options.limit }) });
  const rpcFor = bridgeRpcFactory(chainEnvironment([8453, 42161], receipt), { transport: chain.transport, wait });
  const physical = new BridgeRpcPhysicalBudget(() => time, wait, bridgeRpcPhysicalPolicy(op), options.stepBudget === false ? 0 : bridgeSendStepPostBudget(op, 3));
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
