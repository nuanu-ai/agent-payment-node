import assert from "node:assert/strict";
import test from "node:test";
import { keccak256, type Hex } from "viem";
import type { BridgeChainId } from "../../src/lifi/chains.js";
import { bridgeProtocolEmitter } from "../../src/lifi/deployments.js";
import type { BridgeLog, DecodedBridgeCall } from "../../src/lifi/model.js";
import { bridgeSourceProof } from "../../src/lifi/protocol-evidence.js";
import { transitionBridge } from "../../src/lifi/transitions.js";
import { BRIDGE_RPC_ENV, bridgeRpcFactory } from "../../src/lifi/rpc.js";
import { BRIDGE_DIAMOND } from "../../src/lifi/validation.js";
import { BRIDGE_FEE_RULE_HASH } from "../../src/lifi/rpc-fees.js";
import { temporaryState } from "./helpers.js";
import { addressWord, makeDestinationReceipt, makeSourceReceipt } from "./lifi-event-fixtures.js";
import { LIFI_SYNTHETIC_SENDER, lifiFixture } from "./lifi-helpers.js";
import { lifecycleDouble } from "./lifi-lifecycle-double.js";
import { capturedBytecode } from "./lifi-source-observation-helpers.js";
import { findStored } from "./stored-operations.js";

const code = await capturedBytecode();
const APPROVAL_TOPIC = keccak256(Buffer.from("Approval(address,address,uint256)"));

test("one Base USDC to Arbitrum USDC Across bridge runs its whole lifecycle on keyless primary RPCs", async (t) => {
  const temporary = await temporaryState(); t.after(temporary.cleanup);
  let decoded: DecodedBridgeCall | undefined, amount = 0n;
  const env: Record<string, string> = {};
  for (const chainId of [8453, 42161] as const) {
    env[BRIDGE_RPC_ENV[chainId]] = `https://rpc-${chainId}.example`;
  }
  const setup = await lifiFixture(temporary.root, "base-arb");
  const request = setup.request;
  const chain = lifecycleDouble([[8453, 42161, "across", request.fromToken], [42161, 8453, "across", request.toToken]], code, {
    nowSeconds: BigInt(Math.floor(setup.now.getTime() / 1000)), owner: LIFI_SYNTHETIC_SENDER, nonce: 7n,
    allowanceAfterApproval: BigInt(request.amountAtomic),
    sourceLogs: (to) => to === BRIDGE_DIAMOND.toLowerCase() ? makeSourceReceipt(decoded!).logs : [{ address: request.fromToken,
      topics: [APPROVAL_TOPIC, addressWord(LIFI_SYNTHETIC_SENDER), addressWord(BRIDGE_DIAMOND)], data: `0x${amount.toString(16).padStart(64, "0")}` as Hex }],
  });
  const f = await lifiFixture(temporary.root, "base-arb", { now: setup.now, provider: setup.provider, initializeWallet: false,
    rpcFor: bridgeRpcFactory(env, { transport: chain.transport, wait: async () => {} }) });
  const steps: Array<{ step: string; posts: number; primary: number; archive: number; byChain: Record<number, number> }> = [];
  let mark = 0;
  const step = (name: string) => {
    const posts = chain.posts.slice(mark); mark = chain.posts.length;
    steps.push({ step: name, posts: posts.length, primary: posts.filter((p) => p.role === "primary").length,
      archive: posts.filter((p) => p.role === "archive").length,
      byChain: Object.fromEntries(([8453, 42161] as BridgeChainId[]).map((id) => [id, posts.filter((p) => p.chainId === id).length])) });
  };
  const { id, operation } = await f.prepare("across"); step("prepare");
  decoded = operation.intent.decoded; amount = BigInt(operation.intent.materialization.request.amountAtomic);
  const resume = async () => {
    const result = await f.core.execute({ command: "operation.resume", operationId: id }); assert.equal(result.ok, true, JSON.stringify(result.error));
    return (await findStored(f.core.bridges.records, id))!;
  };
  const approved = await f.core.execute({ command: "bridge.approve", operationId: id }); assert.equal(approved.ok, true, JSON.stringify(approved.error));
  step("approve: guards, approval send");
  chain.mine(8453);
  let op = await resume(); step("resume: approval included, bridge guard and send");
  assert.equal(op.effects[1]!.submissionAttempts, 1, JSON.stringify(op.failure));
  chain.mine(8453);
  op = await resume(); step("resume: both effects included, not safe");
  chain.finalize(8453);
  // Every resume a polling agent needs until the source side is proven; a deferred read budget shows as an extra resume.
  for (let poll = 1; op.state !== "destination_pending" && poll <= 4; poll += 1) { op = await resume(); step(`resume: source safe (poll ${poll})`); }
  assert.equal(op.state, "destination_pending", JSON.stringify(op.failure));
  const source = bridgeSourceProof(op.intent.materialization, op.intent.decoded, makeSourceReceipt(op.intent.decoded));
  const fill = makeDestinationReceipt(op.intent.decoded, source).logs as readonly BridgeLog[];
  f.provider.statusValue = "completed_observed";
  f.provider.hint = await chain.destination(42161, bridgeProtocolEmitter(42161, "across", request.toToken), fill);
  chain.finalize(42161);
  for (let poll = 1; op.state !== "completed" && poll <= 3; poll += 1) { op = await resume(); step(`resume: destination proof (poll ${poll})`); }
  assert.equal(op.state, "completed", JSON.stringify(op.failure));
  assert.equal(chain.sent.length, 2);
  const total = steps.reduce((sum, row) => sum + row.posts, 0), archivePosts = steps.reduce((sum, row) => sum + row.archive, 0);
  console.log(JSON.stringify({ total, archivePosts, steps }));
  assert.equal(archivePosts, 0);
});

test("an approval inclusion proved with the legacy Base oracle evidence finishes under receipt-derived fees without a state flip", async (t) => {
  const temporary = await temporaryState(); t.after(temporary.cleanup);
  let decoded: DecodedBridgeCall | undefined, amount = 0n;
  const env: Record<string, string> = {};
  for (const chainId of [8453, 42161] as const) env[BRIDGE_RPC_ENV[chainId]] = `https://rpc-${chainId}.example`;
  const setup = await lifiFixture(temporary.root, "base-arb"), request = setup.request;
  const chain = lifecycleDouble([[8453, 42161, "across", request.fromToken], [42161, 8453, "across", request.toToken]], code, {
    nowSeconds: BigInt(Math.floor(setup.now.getTime() / 1000)), owner: LIFI_SYNTHETIC_SENDER, nonce: 7n,
    allowanceAfterApproval: BigInt(request.amountAtomic),
    sourceLogs: (to) => to === BRIDGE_DIAMOND.toLowerCase() ? makeSourceReceipt(decoded!).logs : [{ address: request.fromToken,
      topics: [APPROVAL_TOPIC, addressWord(LIFI_SYNTHETIC_SENDER), addressWord(BRIDGE_DIAMOND)], data: `0x${amount.toString(16).padStart(64, "0")}` as Hex }],
  });
  const rpcFor = bridgeRpcFactory(env, { transport: chain.transport, wait: async () => {} });
  const f = await lifiFixture(temporary.root, "base-arb", { now: setup.now, provider: setup.provider, initializeWallet: false, rpcFor });
  const { id, operation } = await f.prepare("across");
  decoded = operation.intent.decoded; amount = BigInt(operation.intent.materialization.request.amountAtomic);
  assert.equal((await f.core.execute({ command: "bridge.approve", operationId: id })).ok, true);
  chain.mine(8453);
  // Rewrite the approval's inclusion as 0.5.42 recorded it: same inclusion, with the oracle-proven fee evidence that release
  // wrote for a zero Jovian operator fee (GasPriceOracle getOperatorFee(gasUsed) returned 0 at the inclusion block).
  let op = (await findStored(f.core.bridges.records, id))!;
  const approval = op.effects[0]!;
  const observed = await rpcFor(8453).observe(approval.transactionHash!, approval.envelope);
  assert.ok(observed); assert.equal(observed.transaction.operatorFeeWei, "0");
  const p = observed.transaction, legacy = { transaction: { ...p, feeEvidence: { ...p.feeEvidence, ruleHash: BRIDGE_FEE_RULE_HASH, baseOracle: {
    oracle: "0x420000000000000000000000000000000000000F" as Hex, from: "0x0000000000000000000000000000000000000000" as Hex,
    callData: `0x275aedd2${BigInt(p.gasUsedAtomic).toString(16).padStart(64, "0")}` as Hex, rawReturn: `0x${"0".repeat(64)}` as Hex,
    blockHash: p.block.hash, requireCanonical: true as const, version: "1.6.0" as const, regime: "jovian" as const, scalarAtomic: "0", constantWei: "0" } } } };
  op = transitionBridge(op, { effects: op.effects.map((effect) => effect.role === "approval"
    ? { ...effect, phase: "included_success" as const, includedProof: legacy.transaction } : effect) }, op.updatedAt);
  await f.core.bridges.records.persist(op);
  const before = op.transitions.length;
  chain.finalize(8453);
  const resumed = await f.core.execute({ command: "operation.resume", operationId: id }); assert.equal(resumed.ok, true, JSON.stringify(resumed.error));
  op = (await findStored(f.core.bridges.records, id))!;
  assert.equal(op.effects[0]!.phase, "safe_success"); assert.equal(op.effects[0]!.safeProof!.feeEvidence.baseOracle, null);
  assert.equal(op.effects[0]!.safeProof!.actualTotalFeeWei, legacy.transaction.actualTotalFeeWei);
  assert.ok(op.transitions.slice(before).every((entry) => entry.state !== "unknown_finality" || entry.effects[1]!.submissionAttempts === 1),
    "the legacy inclusion is the same inclusion: no unknown_finality flip before the bridge is sent");
});
