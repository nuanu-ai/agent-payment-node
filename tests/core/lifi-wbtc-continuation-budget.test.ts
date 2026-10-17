import assert from "node:assert/strict";
import test from "node:test";
import { decodeFunctionData, encodeFunctionData, getAddress, type Hex } from "viem";
import { acrossBridgeAbi, feeForwarderAbi, FEE_RECIPIENT } from "../../src/lifi/abi.js";
import { bridgeInvocationPostBudget, bridgeSendStepPostBudget } from "../../src/lifi/send-budget.js";
import { guardBridgeEffect } from "../../src/lifi/economics.js";
import { BridgeRpcPhysicalBudget, RpcReadSession } from "../../src/lifi/rpc.js";
import type { BridgeEnvelope } from "../../src/lifi/model.js";
import { LifiTestProvider, lifiFixture, lifiSteps } from "./lifi-helpers.js";
import { addressWord } from "./lifi-event-fixtures.js";
import { temporaryState } from "./helpers.js";
import { ETH_WBTC, ARB_WBTC, wbtcBudgetSpy } from "./lifi-wbtc-budget-helpers.js";

import { preparedWbtc } from "./lifi-wbtc-authority-helpers.js";
import { findStored } from "./stored-operations.js";

for (const reverse of [false, true]) for (const exhausted of [false, true]) test(`WBTC Across ${reverse ? "Arbitrum to Ethereum" : "Ethereum to Arbitrum"} ${exhausted ? "exhausted cap refuses before transport" : "continuation reads only primary batches"} inside its derived budget`, async (t) => {
  const temp = await temporaryState(); t.after(temp.cleanup);
  const now = new Date("2026-10-09T03:44:00.000Z"), prepared = (await preparedWbtc(temp.root, now)).op, spy = await wbtcBudgetSpy(now);
  const from: 1 | 42161 = reverse ? 42161 : 1, to: 1 | 42161 = reverse ? 1 : 42161, fromToken = reverse ? ARB_WBTC : ETH_WBTC, toToken = reverse ? ETH_WBTC : ARB_WBTC;
  let time = now.getTime(); const wait = async (ms: number) => { time += ms; };
  const op = { ...prepared, intent: { ...prepared.intent,
    materialization: { ...prepared.intent.materialization, request: { ...prepared.intent.materialization.request,
      fromChainId: from, toChainId: to, fromToken, toToken } },
    sourceRpcOrigin: `https://${reverse ? "arb" : "eth"}-primary.example`, destinationRpcOrigin: `https://${reverse ? "eth" : "arb"}-primary.example` },
    effects: prepared.effects.map(effect => effect.role === "approval" ? { ...effect, submissionAttempts: 1 as const, phase: "included_success" as const } : {
      ...effect, envelope: { ...effect.envelope, chainId: from, economics: { ...effect.envelope.economics, nonceAtomic: "8" } } }) };
  // The hash covers the exact request; switching direction recomputes a test intent before the guard.
  const { bridgeApprovalPolicyHash } = await import("../../src/lifi/economics.js");
  op.intent.policyHash = bridgeApprovalPolicyHash(op.intent.materialization);
  const derived = bridgeInvocationPostBudget(op), physical = new BridgeRpcPhysicalBudget(exhausted ? 0 : derived);
  const session = new RpcReadSession({ now: () => time, wait, maxHttpRequests: 8, maxHttpAttempts: 8, physicalBudget: physical });
  const source = spy.rpcFor(from, session), destination = spy.rpcFor(to, session);
  const observationSession = new RpcReadSession({ now: () => time, wait, maxHttpRequests: 8, maxHttpAttempts: 10, physicalBudget: physical });
  const observer = spy.rpcFor(from, observationSession); spy.observeMode(true, from);
  const transaction = (reverse ? spy.arbApproval : spy.approval).transaction;
  const envelope: BridgeEnvelope = { ...prepared.effects[0]!.envelope, chainId: from,
    from: getAddress(transaction.from), to: getAddress(transaction.to), data: transaction.input,
    economics: { nonceAtomic: BigInt(transaction.nonce).toString(), gasLimitAtomic: BigInt(transaction.gas).toString(),
      maxFeePerGasAtomic: BigInt(transaction.maxFeePerGas).toString(), maxPriorityFeePerGasAtomic: BigInt(transaction.maxPriorityFeePerGas).toString(),
      maximumGasCostAtomic: (BigInt(transaction.gas) * BigInt(transaction.maxFeePerGas)).toString() } };
  if (exhausted) {
    await assert.rejects(observer.observe(transaction.hash, envelope), { code: "APN_RPC_BUDGET_EXCEEDED" });
    await assert.rejects(guardBridgeEffect(op, "bridge", source, destination, () => time), { code: "APN_RPC_BUDGET_EXCEEDED" });
    assert.equal(spy.calls.length, 0); assert.equal(physical.remaining(), 0); return;
  }
  const observed = await observer.observe(transaction.hash, envelope); assert(observed);
  op.effects[0] = { ...op.effects[0]!, includedProof: observed.transaction };
  const history = structuredClone(spy.calls); spy.observeMode(false); spy.calls.length = 0;
  await guardBridgeEffect(op, "bridge", source, destination, () => time);
  const first = structuredClone(spy.calls); spy.calls.length = 0;
  await guardBridgeEffect(op, "bridge", source, destination, () => time, false);
  const second = structuredClone(spy.calls);
  // Approval observation: one primary batch, the receipt reader's chain-checked receipt, the inclusion header. The full guard
  // is one source batch (the destination role reads nothing); the re-check before the send is one account batch.
  assert.equal(history.length, 3); assert.equal(first.length, 1); assert.equal(second.length, 1);
  assert.ok([...history, ...first, ...second].every(call => !call.host.includes("archive")));
  assert.ok([...first, ...second].every(call => call.host === `${reverse ? "arb" : "eth"}-primary.example`));
  assert.ok(second[0]!.items.every(item => item.method !== "eth_call" || ["0x70a08231", "0xdd62ed3e"].includes(String((item.params[0] as { data: string }).data).slice(0, 10))));
  // The last admission is the one durable send slot. A second send cannot gain capacity by resetting a read session.
  await physical.beforePost("eth_sendRawTransaction");
  assert(history.every(call => !call.items.some(item => item.method === "eth_sendRawTransaction")));
  const clean = history.length + first.length + second.length + 1;
  assert.equal(clean, 6); assert.equal(physical.remaining(), derived - clean);
});

test("WBTC continuation keeps the original approval and submits the bridge once after an exhausted invocation", async (t) => {
  const temp = await temporaryState(); t.after(temp.cleanup);
  const { op, f } = await preparedWbtc(temp.root, new Date("2026-10-09T03:44:00.000Z"));
  f.source.failObserve = true;
  const first = await f.core.execute({ command: "bridge.approve", operationId: op.operationId }); assert(first.ok);
  const pending = (await findStored(f.core.bridges.records, op.operationId))!;
  assert.equal(pending.effects[0]!.submissionAttempts, 1); assert.equal(pending.effects[1]!.phase, "unsealed");
  f.source.failObserve = false; f.source.safeApproval = false;
  const observedOnly = await f.core.execute({ command: "operation.resume", operationId: op.operationId }); assert(observedOnly.ok);
  assert.equal(f.source.submissions.length, 1); assert.equal(f.approval.calls.length, 1);
  const account = f.source.account.bind(f.source); let exhaust = true;
  f.source.account = async (...args) => {
    if (exhaust) {
      const physical = f.rpcSessions[0]!.physicalBudget!;
      assert.equal(physical.remaining(), bridgeInvocationPostBudget(pending));
      (physical as unknown as { posts: number }).posts = physical.remaining() - 1; exhaust = false;
    }
    return await account(...args);
  };
  f.rpcSessions.length = 0;
  const depleted = await f.core.execute({ command: "operation.resume", operationId: op.operationId }); assert(depleted.ok);
  assert.equal((await findStored(f.core.bridges.records, op.operationId))!.effects[1]!.phase, "unsealed");
  assert.equal(f.source.submissions.length, 1);
  f.rpcSessions.length = 0;
  const resumed = await f.core.execute({ command: "operation.resume", operationId: op.operationId }); assert(resumed.ok);
  assert.equal(f.source.submissions.length, 2); assert.equal(f.approval.calls.length, 3);
  const sent = (await findStored(f.core.bridges.records, op.operationId))!;
  assert.equal(sent.effects[0]!.transactionHash, pending.effects[0]!.transactionHash);
  assert.equal(sent.effects[1]!.submissionAttempts, 1); assert.equal(bridgeSendStepPostBudget(sent), 0);
  f.source.safeApproval = true;
  await f.core.execute({ command: "operation.resume", operationId: op.operationId });
  await f.core.execute({ command: "operation.resume", operationId: op.operationId });
  assert.equal(f.source.submissions.length, 2);
});
