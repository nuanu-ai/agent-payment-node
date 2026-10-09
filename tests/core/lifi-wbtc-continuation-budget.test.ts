import assert from "node:assert/strict";
import test from "node:test";
import { decodeFunctionData, encodeFunctionData, getAddress, type Hex } from "viem";
import { acrossBridgeAbi, feeForwarderAbi, FEE_RECIPIENT } from "../../src/lifi/abi.js";
import { hashObject } from "../../src/canonical.js";
import { bridgeDeployment } from "../../src/lifi/deployments.js";
import { bridgeRpcPhysicalPolicy } from "../../src/lifi/rpc-execution-budget.js";
import { guardBridgeEffect } from "../../src/lifi/economics.js";
import { BridgeRpcPhysicalBudget, RpcReadSession } from "../../src/lifi/rpc.js";
import type { BridgeEnvelope } from "../../src/lifi/model.js";
import { LifiTestProvider, lifiFixture, lifiSteps } from "./lifi-helpers.js";
import { addressWord } from "./lifi-event-fixtures.js";
import { temporaryState } from "./helpers.js";
import { ETH_WBTC, ARB_WBTC, wbtcBudgetSpy } from "./lifi-wbtc-budget-helpers.js";

async function preparedWbtc(root: string, now: Date) {
  const step = (await lifiSteps("eth-base", now))[0]!;
  const transform = (value: any): any => {
    if (Array.isArray(value)) return value.map(transform);
    if (value && typeof value === "object") {
      const result = Object.fromEntries(Object.entries(value).map(([k, v]) => [k, transform(v)]));
      if (result.symbol === "USDC") Object.assign(result, { address: result.chainId === 1 ? ETH_WBTC : ARB_WBTC,
        chainId: result.chainId === 1 ? 1 : 42161, symbol: "WBTC", name: "Wrapped BTC", coinKey: "WBTC", decimals: 8 });
      return result;
    }
    if (value === 8453) return 42161;
    return ({ "10000000": "1000", "9975000": "998", "9970607": "991", "25000": "2", "997": "0", "3396": "7" } as Record<string, string>)[String(value)] ?? value;
  };
  const wbtc = transform(step), decoded = decodeFunctionData({ abi: acrossBridgeAbi, data: step.transactionRequest.data });
  const args = structuredClone(decoded.args) as unknown as any[];
  args[0].sendingAssetId = ETH_WBTC; args[0].minAmount = 998n; args[0].destinationChainId = 42161n;
  args[1][0].sendingAssetId = ETH_WBTC; args[1][0].receivingAssetId = ETH_WBTC; args[1][0].fromAmount = 1000n;
  args[1][0].callData = encodeFunctionData({ abi: feeForwarderAbi, functionName: "forwardERC20Fees", args: [ETH_WBTC, [{ recipient: FEE_RECIPIENT, amount: 2n }]] });
  args[2].sendingAssetId = addressWord(ETH_WBTC); args[2].receivingAssetId = addressWord(ARB_WBTC);
  args[2].outputAmount = 991n; args[2].outputAmountMultiplier = (991n * 10n ** 18n + 997n) / 998n;
  wbtc.transactionRequest.data = encodeFunctionData({ abi: acrossBridgeAbi, functionName: decoded.functionName, args: args as never });
  const f = await lifiFixture(root, "eth-base", { now, provider: new LifiTestProvider([wbtc], now) });
  for (const rpc of [f.source, f.destination]) {
    const original = rpc.deployment.bind(rpc);
    rpc.deployment = async (...args) => {
      const identity = await original(...args), contract = bridgeDeployment(rpc.chainId, args[1], args[0], args[2]);
      return { ...identity, contractHash: hashObject({ protocol: contract, feeContract: { code: [], reads: [] } }) };
    };
  }
  const request = { ...f.request, minOutputAtomic: "980", maxRouteFeeAtomic: "20" };
  const quote = await f.core.execute({ command: "bridge.routes", profile: f.profile, request });
  assert.equal(quote.ok, true, JSON.stringify(quote.error));
  const prepared = await f.core.execute({ command: "bridge.prepare", profile: f.profile,
    quote: (quote.data as { quote_hash: string }).quote_hash, route: "route-across", idempotencyKey: "wbtc-budget-model" });
  assert.equal(prepared.ok, true, JSON.stringify(prepared.error));
  const op = (await f.core.bridges.records.findOperation((prepared.operation as { operation_id: string }).operation_id))!;
  f.source.op = op; f.destination.op = op;
  return { op, f };
}

for (const reverse of [false, true]) for (const oldCap of [false, true]) test(`WBTC Across ${reverse ? "Arbitrum to Ethereum" : "Ethereum to Arbitrum"} ${oldCap ? "old24 refuses before send" : "continuation preserves full reads"} inside its typed finite budget`, async (t) => {
  const temp = await temporaryState(); t.after(temp.cleanup);
  const now = new Date("2026-10-09T03:44:00.000Z"), prepared = (await preparedWbtc(temp.root, now)).op, spy = await wbtcBudgetSpy(now);
  const from: 1 | 42161 = reverse ? 42161 : 1, to: 1 | 42161 = reverse ? 1 : 42161, fromToken = reverse ? ARB_WBTC : ETH_WBTC, toToken = reverse ? ETH_WBTC : ARB_WBTC;
  let time = now.getTime(); const wait = async (ms: number) => { time += ms; };
  const sourceContract = bridgeDeployment(from, to, "across", fromToken), destinationContract = bridgeDeployment(to, from, "across", toToken);
  const op = { ...prepared, intent: { ...prepared.intent,
    materialization: { ...prepared.intent.materialization, request: { ...prepared.intent.materialization.request,
      fromChainId: from, toChainId: to, fromToken, toToken } },
    sourceRpcOrigin: `https://${reverse ? "arb" : "eth"}-primary.example`, destinationRpcOrigin: `https://${reverse ? "eth" : "arb"}-primary.example`,
    sourceDeployment: { ...prepared.intent.sourceDeployment, contractHash: hashObject({ protocol: sourceContract, feeContract: { code: [], reads: [] } }), codeHash: hashObject(sourceContract.code), configurationHash: hashObject(sourceContract.reads) },
    destinationDeployment: { ...prepared.intent.destinationDeployment, contractHash: hashObject({ protocol: destinationContract, feeContract: { code: [], reads: [] } }), codeHash: hashObject(destinationContract.code), configurationHash: hashObject(destinationContract.reads) } },
    effects: prepared.effects.map(effect => effect.role === "approval" ? { ...effect, submissionAttempts: 1 as const, phase: "included_success" as const } : {
      ...effect, envelope: { ...effect.envelope, chainId: from, economics: { ...effect.envelope.economics, nonceAtomic: "8" } } }) };
  // The selection is bound to the exact pinned WBTC route, not an arbitrary numeric limit.
  op.intent.policyHash = prepared.intent.policyHash;
  // The hash covers the exact request; switching direction recomputes a test intent before the guard.
  const { bridgeApprovalPolicyHash } = await import("../../src/lifi/economics.js");
  op.intent.policyHash = bridgeApprovalPolicyHash(op.intent.materialization);
  assert.equal(bridgeRpcPhysicalPolicy(op), "canonical_wbtc_across_approval_continuation");
  const physical = new BridgeRpcPhysicalBudget(() => time, wait, oldCap ? "default" : bridgeRpcPhysicalPolicy(op));
  const session = new RpcReadSession({ now: () => time, wait, maxHttpRequests: 28, maxHttpAttempts: 30,
    archiveDeploymentBatchMaxItems: 3, physicalBudget: physical });
  const source = spy.rpcFor(from, session), destination = spy.rpcFor(to, session);
  const observationSession = new RpcReadSession({ now: () => time, wait, maxHttpRequests: 14, maxHttpAttempts: 16,
    archiveDeploymentBatchMaxItems: 3, physicalBudget: physical });
  const observer = spy.rpcFor(from, observationSession); spy.observeMode(true, from);
  const transaction = (reverse ? spy.arbApproval : spy.approval).transaction;
  const envelope: BridgeEnvelope = { ...prepared.effects[0]!.envelope, chainId: from,
    from: getAddress(transaction.from), to: getAddress(transaction.to), data: transaction.input,
    economics: { nonceAtomic: BigInt(transaction.nonce).toString(), gasLimitAtomic: BigInt(transaction.gas).toString(),
      maxFeePerGasAtomic: BigInt(transaction.maxFeePerGas).toString(), maxPriorityFeePerGasAtomic: BigInt(transaction.maxPriorityFeePerGas).toString(),
      maximumGasCostAtomic: (BigInt(transaction.gas) * BigInt(transaction.maxFeePerGas)).toString() } };
  const observed = await observer.observe(transaction.hash, envelope); assert(observed);
  op.effects[0] = { ...op.effects[0]!, includedProof: observed.transaction };
  await observer.deployment("across", to, fromToken, observed.transaction.block, true);
  const history = structuredClone(spy.calls); spy.observeMode(false); spy.calls.length = 0;
  if (oldCap) {
    await assert.rejects(guardBridgeEffect(op, "bridge", source, destination, () => time), { code: "APN_RPC_BUDGET_EXCEEDED" });
    assert.equal(op.effects[1]!.phase, "unsealed"); assert.equal(op.effects[1]!.submissionAttempts, 0);
    assert.equal(physical.remaining(), 0); return;
  }
  await guardBridgeEffect(op, "bridge", source, destination, () => time);
  const first = structuredClone(spy.calls); spy.calls.length = 0;
  await guardBridgeEffect(op, "bridge", source, destination, () => time);
  const second = structuredClone(spy.calls);
  assert.equal(history.length, reverse ? 13 : 11); assert.equal(first.length, 17); assert.equal(second.length, 2);
  // The last admission is the one durable send slot. A second send cannot gain capacity by resetting a read session.
  await physical.beforePost("eth_sendRawTransaction");
  assert.equal(physical.remaining(), reverse ? 0 : 2);
  if (reverse) await assert.rejects(physical.beforePost("eth_sendRawTransaction"), { code: "APN_RPC_BUDGET_EXCEEDED" });
  assert(history.every(call => !call.items.some(item => item.method === "eth_sendRawTransaction")));
  assert([...history, ...first, ...second].filter(call => call.host.includes("archive")).every(call => call.items.length <= 3));
  const clean = history.length + first.length + second.length + 1;
  assert(clean > 24); assert(clean <= 33);
  console.log(JSON.stringify({ direction: `${from}->${to}`, history: history.map(x=>({host:x.host,methods:x.items.map(y=>y.method)})), first: first.map(x=>({host:x.host,methods:x.items.map(y=>y.method)})), second: second.map(x=>({host:x.host,methods:x.items.map(y=>y.method)})), cleanPosts: clean }));
});

test("WBTC typed continuation keeps the original approval and submits the bridge once after an exhausted invocation", async (t) => {
  const temp = await temporaryState(); t.after(temp.cleanup);
  const { op, f } = await preparedWbtc(temp.root, new Date("2026-10-09T03:44:00.000Z"));
  assert.equal(bridgeRpcPhysicalPolicy(op), "default");
  f.source.failObserve = true;
  const first = await f.core.execute({ command: "bridge.approve", operationId: op.operationId }); assert(first.ok);
  const pending = (await f.core.bridges.records.findOperation(op.operationId))!;
  assert.equal(pending.effects[0]!.submissionAttempts, 1); assert.equal(pending.effects[1]!.phase, "unsealed");
  assert.equal(bridgeRpcPhysicalPolicy(pending), "canonical_wbtc_across_approval_continuation");
  for (const changed of [
    { ...pending, terminal: true },
    { ...pending, intent: { ...pending.intent, sourceDeployment: { ...pending.intent.sourceDeployment, codeHash: "0".repeat(64) } } },
    { ...pending, intent: { ...pending.intent, destinationDeployment: { ...pending.intent.destinationDeployment, configurationHash: "0".repeat(64) } } },
    { ...pending, effects: pending.effects.map(effect => effect.role === "bridge" ? { ...effect, submissionAttempts: 1 as const } : effect) },
    { ...pending, intent: { ...pending.intent, materialization: { ...pending.intent.materialization, tool: "stargateV2" as const } } },
    { ...pending, intent: { ...pending.intent, policyHash: "0".repeat(64) } },
    { ...pending, intent: { ...pending.intent, sourceDeployment: { ...pending.intent.sourceDeployment, contractHash: "0".repeat(64) } } },
    { ...pending, intent: { ...pending.intent, materialization: { ...pending.intent.materialization, request: {
      ...pending.intent.materialization.request, fromToken: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48" as const } } } },
  ]) assert.equal(bridgeRpcPhysicalPolicy(changed), "default");
  f.source.failObserve = false; f.source.safeApproval = false;
  const account = f.source.account.bind(f.source); let exhaust = true;
  f.source.account = async (...args) => {
    if (exhaust) {
      const physical = f.rpcSessions[0]!.physicalBudget!;
      assert.equal(physical.remaining(), 33);
      (physical as unknown as { posts: number }).posts = 32; exhaust = false;
    }
    return await account(...args);
  };
  f.rpcSessions.length = 0;
  const depleted = await f.core.execute({ command: "operation.resume", operationId: op.operationId }); assert(depleted.ok);
  assert.equal((await f.core.bridges.records.findOperation(op.operationId))!.effects[1]!.phase, "unsealed");
  assert.equal(f.source.submissions.length, 1);
  f.rpcSessions.length = 0;
  const resumed = await f.core.execute({ command: "operation.resume", operationId: op.operationId }); assert(resumed.ok);
  assert.equal(f.source.submissions.length, 2); assert.equal(f.approval.calls.length, 1);
  const sent = (await f.core.bridges.records.findOperation(op.operationId))!;
  assert.equal(sent.effects[0]!.transactionHash, pending.effects[0]!.transactionHash);
  assert.equal(sent.effects[1]!.submissionAttempts, 1); assert.equal(bridgeRpcPhysicalPolicy(sent), "default");
  f.source.safeApproval = true;
  await f.core.execute({ command: "operation.resume", operationId: op.operationId });
  await f.core.execute({ command: "operation.resume", operationId: op.operationId });
  assert.equal(f.source.submissions.length, 2);
});
