import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { keccak256, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import type { ApnError } from "../../src/errors.js";
import { BRIDGE_ASSET_REGISTRY, bridgePeerToken, bridgeProviderBoundNativeDestination } from "../../src/lifi/asset-registry.js";
import { BNB_COMPOSITE, decodeBnbCompositeMessage } from "../../src/lifi/bnb-composite.js";
import { bridgeDeployment, bridgeProtocolEmitter } from "../../src/lifi/deployments.js";
import type { BridgeRouteRequest, BridgeTool } from "../../src/lifi/model.js";
import { bridgeDestinationObservationRequests } from "../../src/lifi/observation-budget.js";
import { BridgeRpcPhysicalBudget, RpcReadSession, bridgeRpcFactory } from "../../src/lifi/rpc.js";
import { BRIDGE_ZERO_ADDRESS } from "../../src/lifi/validation.js";
import { temporaryState } from "./helpers.js";
import { LIFI_RECIPIENT, LIFI_SYNTHETIC_KEY, LIFI_SYNTHETIC_SENDER, lifiFixture } from "./lifi-helpers.js";
import { capturedBytecode, chainDouble, chainEnvironment, type ReceiptRoute } from "./lifi-source-observation-helpers.js";

type Route = { readonly request: Pick<BridgeRouteRequest, "fromChainId" | "toChainId" | "fromToken" | "toToken">; readonly tool: BridgeTool };
const code = await capturedBytecode();
const bnb = JSON.parse(await readFile("tests/core/lifi-fixtures/bnb-composite-fly-20260921.json", "utf8")).decoded;
/** Every admitted destination of an execution source, with the destination token the pair admits. */
const DESTINATION_ROUTES: Route[] = ([1, 8453, 42161] as const).flatMap((chainId) => [BRIDGE_ASSET_REGISTRY[chainId].nativeCoin, ...BRIDGE_ASSET_REGISTRY[chainId].tokens]
  .flatMap((asset) => asset.peers.flatMap((peer) => (["across", "stargateV2"] as const).flatMap((tool): Route[] => {
    try {
      const fromToken = asset.kind === "native" ? BRIDGE_ZERO_ADDRESS : asset.address, toToken = asset.kind === "native" ? BRIDGE_ZERO_ADDRESS : bridgePeerToken(asset, peer).address;
      bridgeDeployment(chainId, peer, tool, fromToken); bridgeDeployment(peer, chainId, tool, toToken);
      return [{ request: { fromChainId: chainId, toChainId: peer, fromToken, toToken }, tool }];
    } catch { return []; }
  }))));
const receipts = (chainId: number): ReceiptRoute[] => chainId === 8453 ? ["primary", "fallback", "batch", "scalar"] : ["primary", "fallback", "batch"];
const label = ({ request: r, tool }: Route) => `${r.fromChainId}->${r.toChainId} ${tool} ${r.toToken === BRIDGE_ZERO_ADDRESS ? "native" : r.toToken}`;
const cap = ({ request }: Route) => bridgeDestinationObservationRequests(request, request.toChainId === 56);

/** One destination observation through the production adapter, in the order `BridgeObservation` reads it. */
async function observeDestination({ request, tool }: Route, receipt: ReceiptRoute, maxHttpRequests: number) {
  const chainId = request.toChainId, peer = request.fromChainId, token = request.toToken, amount = 10_000_000n;
  const composite = chainId === 56, delivered = bridgeProviderBoundNativeDestination(request);
  const emitter = composite ? BNB_COMPOSITE.executor : bridgeProtocolEmitter(chainId, tool, token);
  let now = Date.parse("2026-10-15T20:20:00Z"); const wait = async (ms: number) => { now += ms; };
  const chain = chainDouble([[chainId, peer, tool, token]], code, receipt, { nowSeconds: BigInt(now / 1000),
    trace: () => ({ type: "CALL", from: LIFI_SYNTHETIC_SENDER, to: emitter, value: "0x0", input: "0x",
      calls: composite ? [] : [{ type: "CALL", from: emitter, to: LIFI_RECIPIENT, value: `0x${amount.toString(16)}`, input: "0x" }] }) });
  const raw = await privateKeyToAccount(LIFI_SYNTHETIC_KEY).signTransaction({ chainId, type: "eip1559", nonce: 9, gas: 300_000n,
    maxFeePerGas: 16_500_000n, maxPriorityFeePerGas: 1_500_000n, to: emitter, value: 0n, data: "0x" });
  const { hash } = chain.include(raw);
  const session = new RpcReadSession({ now: () => now, wait, maxHttpRequests, maxHttpAttempts: maxHttpRequests + 2,
    physicalBudget: new BridgeRpcPhysicalBudget(maxHttpRequests + 2) });
  const rpc = bridgeRpcFactory(chainEnvironment([chainId], receipt), { transport: chain.transport, wait })(chainId, session);
  let outcome = "observed";
  if (composite) {
    // The composite proves its canonical receipt first, then repeats the observation with the delivery trace.
    const canonical = await rpc.observeDestination!(hash); assert(canonical?.transaction.safeBlock);
    const call = decodeBnbCompositeMessage(bnb.acrossData.message, bnb.bridgeData.transactionId, bnb.bridgeData.receiver);
    const found = await rpc.observeDestination!(hash, { recipient: LIFI_RECIPIENT, from: emitter, minimumAmountAtomic: "1",
      composite: { message: bnb.acrossData.message, call } }).catch((error: ApnError) => error);
    if (!(found instanceof Error)) assert.equal(found?.receipt.compositeTrace?.outcome, "protocol_mismatch");
    else { assert.equal(found.code, "APN_RPC_BUDGET_EXCEEDED"); outcome = `budget:${found.details?.reason}`; }
  } else {
    const found = await rpc.observeDestination!(hash, delivered ? { recipient: LIFI_RECIPIENT, from: emitter, amountAtomic: amount.toString() } : undefined)
      .catch((error: ApnError) => error);
    if (found instanceof Error) { assert.equal(found.code, "APN_RPC_BUDGET_EXCEEDED"); outcome = `budget:${found.details?.reason}`; }
    else {
      assert(found?.transaction.safeBlock);
      if (delivered) assert.equal(found.receipt.nativeTransfer?.valueAtomic, amount.toString());
    }
  }
  return { posts: chain.posts, outcome };
}

test("Base USDC and BNB composite destinations fit their derived caps in every receipt route with no deployment re-proof", async () => {
  const base: Route = { request: { fromChainId: 42161, toChainId: 8453, fromToken: BRIDGE_ASSET_REGISTRY[42161].tokens[0]!.address,
    toToken: BRIDGE_ASSET_REGISTRY[8453].tokens[0]!.address }, tool: "across" };
  const composite: Route = { request: { fromChainId: 1, toChainId: 56, fromToken: BRIDGE_ZERO_ADDRESS, toToken: BRIDGE_ZERO_ADDRESS }, tool: "across" };
  for (const [route, limit, expected] of [[base, 4, { primary: 2, fallback: 3, batch: 3, scalar: 4 }],
    [composite, 13, { primary: 7, fallback: 7, batch: 8 }]] as const) {
    assert.equal(cap(route), limit);
    const counts: Record<string, number> = {};
    for (const receipt of receipts(route.request.toChainId)) {
      const r = await observeDestination(route, receipt, limit); counts[receipt] = r.posts.length; assert.equal(r.outcome, "observed");
      assert.ok(r.posts.every((post) => !post.methods.some((method) => ["eth_getCode", "eth_getStorageAt", "eth_call"].includes(method))));
    }
    assert.deepEqual(counts, expected);
  }
  assert.equal((await observeDestination(base, "scalar", 3)).outcome, "budget:maxHttpRequests");
});

for (const route of DESTINATION_ROUTES) test(`destination observation ${label(route)} stays within its derived request budget`, async () => {
  const limit = cap(route), counts: number[] = [];
  for (const receipt of receipts(route.request.toChainId)) {
    const r = await observeDestination(route, receipt, limit); assert.equal(r.outcome, "observed", receipt);
    counts.push(r.posts.length);
  }
  assert(Math.max(...counts) <= limit, `${counts} against ${limit}`);
});

for (const [pair, limit] of [["eth-base", 4], ["eth-bnb", 13]] as const) test(`bridge service gives the ${pair} destination observation its derived ${limit}-request cap`, async (t) => {
  const temporary = await temporaryState(); t.after(temporary.cleanup);
  const s = await lifiFixture(temporary.root, pair); s.provider.statusValue = "completed_observed";
  const { id, operation } = await s.prepare("across");
  assert.equal(cap({ request: operation.intent.materialization.request, tool: "across" }), limit);
  const approved = await s.core.execute({ command: "bridge.approve", operationId: id }); assert.equal(approved.ok, true, approved.error?.message);
  assert(s.rpcSessions.some((session) => session.telemetry().remainingHttpRequests === limit && session.telemetry().remainingHttpAttempts === limit + 2));
});
