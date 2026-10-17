import assert from "node:assert/strict";
import test from "node:test";
import { keccak256, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { hashObject } from "../../src/canonical.js";
import { ApnError } from "../../src/errors.js";
import { BridgeAllowlistGate, bridgeUsageTarget } from "../../src/lifi/allowlist.js";
import { BRIDGE_ASSET_REGISTRY } from "../../src/lifi/asset-registry.js";
import { bridgeDeployment } from "../../src/lifi/deployments.js";
import { BridgeExecution } from "../../src/lifi/execution.js";
import { bridgeSourceObservationRequests } from "../../src/lifi/observation-budget.js";
import { BRIDGE_CANONICAL_OBSERVATION_POSTS } from "../../src/lifi/rpc-observation.js";
import type { BridgeOperationRecord } from "../../src/lifi/operation-model.js";
import { bridgeInvocationPostBudget, bridgeSendStepPostBudget } from "../../src/lifi/send-budget.js";
import { BRIDGE_RECEIPT_FEE_RULE_HASH } from "../../src/lifi/rpc-fees.js";
import { BridgeRpcPhysicalBudget, RpcProviderScheduler, RpcReadSession, bridgeRpcFactory } from "../../src/lifi/rpc.js";
import { transitionBridge } from "../../src/lifi/transitions.js";
import { approvalData } from "../../src/lifi/transaction.js";
import { BRIDGE_DIAMOND, BRIDGE_ZERO_ADDRESS } from "../../src/lifi/validation.js";
import { temporaryState } from "./helpers.js";
import { LIFI_SYNTHETIC_KEY, lifiFixture } from "./lifi-helpers.js";
import { INCLUDED_BLOCK, capturedBytecode, chainDouble, chainEnvironment, type ChainRoute, type ReceiptRoute } from "./lifi-source-observation-helpers.js";

const code = await capturedBytecode();
const BASE_USDC = BRIDGE_ASSET_REGISTRY[8453].tokens[0]!.address;
const SOURCE_ROUTES: ChainRoute[] = ([1, 8453, 42161] as const).flatMap((chainId) => [BRIDGE_ASSET_REGISTRY[chainId].nativeCoin, ...BRIDGE_ASSET_REGISTRY[chainId].tokens]
  .flatMap((asset) => asset.peers.flatMap((peer) => (["across", "stargateV2"] as const).flatMap((tool): ChainRoute[] => {
    const token = asset.kind === "native" ? BRIDGE_ZERO_ADDRESS : asset.address;
    try { bridgeDeployment(chainId, peer, tool, token); return [[chainId, peer, tool, token]]; } catch { return []; }
  }))));
const receipts = (chainId: number): ReceiptRoute[] => chainId === 8453 ? ["primary", "fallback", "batch", "scalar"] : ["primary", "fallback", "batch"];
/** Clean POSTs per receipt route: the first batch, the receipt route's own reads, and the inclusion header. */
const EXPECTED: Record<ReceiptRoute, number> = { primary: 2, fallback: 3, batch: 3, scalar: 4 };

/** One source effect observation through the production RPC adapter, then a re-poll that already knows its inclusion block. */
async function observeSource(route: ChainRoute, receipt: ReceiptRoute, maxHttpRequests: number) {
  const [chainId, , , token] = route, native = token === BRIDGE_ZERO_ADDRESS, amount = 10_000_000n;
  let now = Date.parse("2026-10-15T20:14:00Z"); const wait = async (ms: number) => { now += ms; };
  const chain = chainDouble([route], code, receipt, { nowSeconds: BigInt(now / 1000) });
  const raw = await privateKeyToAccount(LIFI_SYNTHETIC_KEY).signTransaction({ chainId, type: "eip1559", nonce: 2, gas: 56_240n,
    maxFeePerGas: 16_500_000n, maxPriorityFeePerGas: 1_500_000n, to: native ? BRIDGE_DIAMOND : token, value: native ? amount : 0n,
    data: native ? "0x" : approvalData(BRIDGE_DIAMOND, amount.toString()) });
  const { hash } = chain.include(raw, native ? undefined : { token, spender: BRIDGE_DIAMOND, amount });
  const factory = bridgeRpcFactory(chainEnvironment([chainId], receipt), { transport: chain.transport, wait });
  const session = () => new RpcReadSession({ now: () => now, wait, maxHttpRequests, maxHttpAttempts: maxHttpRequests + 2,
    physicalBudget: new BridgeRpcPhysicalBudget(maxHttpRequests + 2) });
  const observed = await factory(chainId, session()).observe(hash); assert(observed?.transaction.safeBlock);
  const first = chain.posts.length;
  const again = await factory(chainId, session()).observe(hash, undefined, undefined, { includedBlock: observed.transaction.block });
  assert.deepEqual(again, observed);
  return { posts: chain.posts.slice(0, first), repoll: chain.posts.slice(first), observed };
}

test("Base USDC to Arbitrum Across source observation needs no archive and no deployment re-proof in any receipt route", async () => {
  const route: ChainRoute = [8453, 42161, "across", BASE_USDC], limit = bridgeSourceObservationRequests(1);
  assert.equal(limit, 2 * BRIDGE_CANONICAL_OBSERVATION_POSTS);
  const counts: Record<string, number> = {};
  for (const receipt of receipts(8453)) {
    const r = await observeSource(route, receipt, BRIDGE_CANONICAL_OBSERVATION_POSTS); counts[receipt] = r.posts.length;
    // Only an empty primary receipt reads its explicit fallback; no state is ever read at a historical block.
    assert.ok(r.posts.every((post) => post.role !== "archive" || (receipt === "fallback" && post.methods.includes("eth_getTransactionReceipt"))));
    assert.ok(r.posts.every((post) => !post.methods.some((method) => ["eth_getCode", "eth_getStorageAt", "eth_call"].includes(method))));
    assert.equal(r.observed.transaction.feeEvidence.ruleHash, BRIDGE_RECEIPT_FEE_RULE_HASH); assert.equal(r.observed.transaction.feeEvidence.baseOracle, null);
    // A re-poll of an effect already seen included is one batch with its inclusion header (plus its receipt route).
    assert.equal(r.repoll.length, r.posts.length - 1);
  }
  assert.deepEqual(counts, EXPECTED);
});

for (const route of SOURCE_ROUTES) test(`source observation ${route[0]}->${route[1]} ${route[2]} ${route[3] === BRIDGE_ZERO_ADDRESS ? "native" : route[3]} stays within its derived request budget`, async () => {
  for (const receipt of receipts(route[0])) {
    const r = await observeSource(route, receipt, BRIDGE_CANONICAL_OBSERVATION_POSTS);
    assert.equal(r.posts.length, EXPECTED[receipt], receipt);
    assert.ok(r.posts.every((post) => !post.methods.some((method) => ["eth_getCode", "eth_getStorageAt"].includes(method))));
  }
});

/** A Base USDC to Arbitrum Across operation whose one approval was sent while its observation failed, as in QA operation faa9ec23. */
async function approvalSent(root: string) {
  const s = await lifiFixture(root, "base-arb");
  const { id } = await s.prepare("across"); s.source.failObserve = true;
  const approved = await s.core.execute({ command: "bridge.approve", operationId: id }); assert.equal(approved.ok, true, approved.error?.message);
  const op = (await s.core.bridges.records.findOperation(id))!;
  assert.deepEqual(op.effects.map((e) => [e.role, e.phase, e.submissionAttempts]), [["approval", "submitted_pending", 1], ["bridge", "unsealed", 0]]);
  assert.equal(op.failure?.reason, "source_observation_unavailable"); assert.equal(s.source.submissions.length, 1);
  const m = op.intent.materialization, approval = { token: m.request.fromToken, spender: m.approvalAddress, amount: BigInt(m.request.amountAtomic) };
  const chain = (receipt: ReceiptRoute, at: number) => chainDouble([[8453, 42161, "across", m.request.fromToken], [42161, 8453, "across", m.request.toToken]],
    code, receipt, { nowSeconds: BigInt(Math.floor(at / 1000)), allowance: approval.amount });
  return { s, id, op, raw: s.source.submissions[0]!, approval, chain };
}
const effects = (op: BridgeOperationRecord) => op.effects.map((e) => [e.role, e.phase, e.submissionAttempts]);

test("operation resume ends an expired Base USDC Across approval as failed_after_approval with its fee and residual allowance", async (t) => {
  const temporary = await temporaryState(); t.after(temporary.cleanup);
  const { s, id, op, raw, approval, chain } = await approvalSent(temporary.root), later = Date.parse(op.intent.expiresAt) + 120_000;
  const reads = chain("scalar", later), paid = reads.include(raw, approval);
  const restart = await lifiFixture(temporary.root, "base-arb", { now: s.now, provider: s.provider, initializeWallet: false, clockNow: () => new Date(later),
    rpcFor: bridgeRpcFactory(chainEnvironment([8453, 42161], "scalar"), { transport: reads.transport }) });
  const resumed = await restart.core.execute({ command: "operation.resume", operationId: id }); assert.equal(resumed.ok, true, resumed.error?.message);
  const record = (await restart.core.bridges.records.findOperation(id))!;
  assert.equal(record.state, "failed_after_approval"); assert.equal(record.terminal, true);
  assert.deepEqual(effects(record), [["approval", "safe_success", 1], ["bridge", "unsealed", 0]]);
  assert.equal(record.effects[0]!.safeProof!.actualTotalFeeWei, (paid.gasUsed * paid.price + paid.l1Fee).toString());
  assert.equal(record.failure?.reason, "unsent_apn_reprepare_required");
  assert.equal(record.failure?.residualAllowance?.amountAtomic, op.intent.materialization.request.amountAtomic);
  const observed = record.observationTelemetry!.filter((entry) => entry.stage === "source_observation").at(-1)!;
  // The scalar receipt reader costs 4 POSTs; the expired bridge needs no guard read and the residual is one account batch.
  assert.equal(observed.outcome, "success"); assert.equal(observed.physicalRequests, 4);
  assert.equal(reads.posts.length, 5); assert.equal(s.source.submissions.length, 1);
  assert.ok(reads.posts.every((post) => post.role !== "archive"));
});

for (const receipt of ["primary", "scalar"] as const) test(`resume after a sent approval completes its observation (${receipt} receipt); an exhausted invocation stays recoverable`, async (t) => {
  const temporary = await temporaryState(); t.after(temporary.cleanup);
  const { s, op, raw, approval, chain } = await approvalSent(temporary.root), m = op.intent.materialization;
  let time = s.now.getTime() + 30_000; const wait = async (ms: number) => { time += ms; };
  const gate = new BridgeAllowlistGate({ state: s.state, clock: { now: () => new Date(time) } }, true);
  const invocation = (spentPosts: number) => {
    const reads = chain(receipt, time); reads.include(raw, approval);
    const rpcFor = bridgeRpcFactory(chainEnvironment([8453, 42161], receipt), { transport: reads.transport, wait });
    const physical = new BridgeRpcPhysicalBudget(bridgeInvocationPostBudget(op)), scheduler = new RpcProviderScheduler();
    const common = { now: () => time, wait, providerScheduler: scheduler, physicalBudget: physical };
    const limit = bridgeSourceObservationRequests(op.effects.length), step = bridgeSendStepPostBudget(op);
    const session = new RpcReadSession({ ...common, maxHttpRequests: step, maxHttpAttempts: step });
    const observer = new RpcReadSession({ ...common, maxHttpRequests: limit, maxHttpAttempts: limit + 2 });
    (physical as unknown as { posts: number }).posts = spentPosts;
    return { reads, physical, execution: new BridgeExecution(s.state, rpcFor(8453, session), rpcFor(42161, session), s.provider, s.custody, () => time,
      async (previous, patch) => { const next = transitionBridge(previous, patch, new Date(time).toISOString());
        await s.core.bridges.records.persist(next); await gate.follow(next, bridgeUsageTarget(next)); return next; },
      { source: () => rpcFor(8453, observer), destination: () => rpcFor(42161, session),
        residual: () => rpcFor(8453, new RpcReadSession({ ...common, maxHttpRequests: 2, maxHttpAttempts: 3 })) }, physical) };
  };
  // QA's first resume: the invocation is spent, so observation cannot start a request. That is a deferral, not unknown finality.
  const spent = invocation(bridgeInvocationPostBudget(op)), first = await spent.execution.resume(op);
  assert.equal(spent.reads.posts.length, 0); assert.equal(first.integrityHash, op.integrityHash); assert.equal(first.terminal, false);
  assert.deepEqual(effects(first), effects(op));
  // The next resume keeps only the approval observation's POSTs: it completes, and the bridge guard that no longer fits is deferred.
  const fresh = invocation(bridgeInvocationPostBudget(op) - EXPECTED[receipt]), resumed = await fresh.execution.resume(first);
  assert.deepEqual(effects(resumed), [["approval", "safe_success", 1], ["bridge", "unsealed", 0]]); assert.equal(resumed.terminal, false);
  assert.equal(resumed.effects[0]!.safeProof!.block.numberAtomic, INCLUDED_BLOCK.toString()); assert.equal(resumed.failure, null);
  const observed = resumed.observationTelemetry!.filter((entry) => entry.stage === "source_observation").at(-1)!;
  assert.equal(observed.outcome, "success"); assert.equal(observed.physicalRequests, EXPECTED[receipt]);
  assert.equal(fresh.physical.remaining(), 0); assert.equal(s.source.submissions.length, 1);
  assert(fresh.reads.posts.every((post) => !post.methods.includes("eth_sendRawTransaction")));
});
