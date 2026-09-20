import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { canonicalJson, sha256 } from "../../src/canonical.js";
import type { EvmRpcCall } from "../../src/evm-ports.js";
import { AssetUsageLedger } from "../../src/asset-usage-ledger.js";
import { bridgeExecutionDestination } from "../../src/lifi/asset-registry.js";
import { bridgeDeployment } from "../../src/lifi/deployments.js";
import { BridgeRpc } from "../../src/lifi/rpc.js";
import { BRIDGE_ZERO_ADDRESS } from "../../src/lifi/validation.js";
import { lifiFixture } from "./lifi-helpers.js";
import { temporaryState } from "./helpers.js";

test("immutable Monad RPC baseline pins safe finality, Across, WMON, implementation, buffers and trace capability", async () => {
  const raw = await readFile(resolve("tests/core/lifi-fixtures/deployment-monad-rpc-20260920.json"), "utf8");
  assert.equal(sha256(raw), "81823a83110faf31e1834af5bb420007b26fbcc261976a549749db6de1381ee3");
  const capture = JSON.parse(raw) as any;
  assert.equal(capture.mode, "public_read_only_no_signing_no_send");
  assert.equal(capture.safeBlock.number, "0x658f460");
  const values = new Map(capture.requests.map((row: any) => [canonicalJson([row.request.method, row.request.params]), row.response.result]));
  const call: EvmRpcCall = async (method, params) => {
    const key = canonicalJson([method, params]); assert.equal(values.has(key), true, key); return structuredClone(values.get(key));
  };
  const block = { numberAtomic: BigInt(capture.safeBlock.number).toString(), hash: capture.safeBlock.hash,
    timestampAtomic: BigInt(capture.safeBlock.timestamp).toString() };
  const proof = await new BridgeRpc(143, capture.rpcOrigin, call).deployment("across", 1, BRIDGE_ZERO_ADDRESS, block);
  assert.deepEqual({ chainId: proof.chainId, peerChainId: proof.peerChainId, blockHash: proof.block.hash },
    { chainId: 143, peerChainId: 1, blockHash: capture.safeBlock.hash });
  const unavailable: EvmRpcCall = async (method, params) => {
    if (method === "debug_traceTransaction") throw new Error("method unavailable");
    return await call(method, params);
  };
  await assert.rejects(new BridgeRpc(143, capture.rpcOrigin, unavailable).deployment("across", 1, BRIDGE_ZERO_ADDRESS, block));
});

test("Ethereum to Monad admits only the exact direct native Across self route and terminalizes usage", async (t) => {
  const temporary = await temporaryState(); t.after(temporary.cleanup);
  const s = await lifiFixture(temporary.root, "eth-monad");
  s.provider.statusValue = "completed_observed";
  const { id, operation } = await s.prepare("across", "monad-direct-001");
  assert.deepEqual({
    from: operation.intent.materialization.request.fromChainId,
    to: operation.intent.materialization.request.toChainId,
    sourceToken: operation.intent.materialization.request.fromToken,
    destinationToken: operation.intent.materialization.request.toToken,
    tool: operation.intent.materialization.tool,
    recipient: operation.intent.materialization.request.recipient,
  }, { from: 1, to: 143, sourceToken: BRIDGE_ZERO_ADDRESS, destinationToken: BRIDGE_ZERO_ADDRESS,
    tool: "across", recipient: operation.intent.owner.address });
  assert.equal(operation.effects.length, 1);
  const completed = await s.core.execute({ command: "bridge.approve", operationId: id });
  assert.equal(completed.ok, true, completed.error?.message);
  const record = (await s.core.bridges.records.findOperation(id))!;
  assert.equal(record.state, "completed");
  assert.equal(record.destinationProof?.chainId, 143);
  assert.equal(record.destinationProof?.nativeTransfer?.to, record.intent.owner.address);
  assert.equal(record.destinationProof?.nativeTransfer?.valueAtomic, record.destinationProof?.amountAtomic);
  assert.ok(BigInt(record.destinationProof!.nativeBalance!.deltaAtomic) >= BigInt(record.intent.materialization.request.minOutputAtomic));
  assert.equal(s.source.submissions.length, 1);
  const binding = record.intent.allowlist!;
  const lease = await new AssetUsageLedger(temporary.root).load({ account: binding.account, chain: binding.chain, asset: binding.asset },
    record.usageLease!.reservationId);
  assert.equal(lease?.state, "finalized");
});

test("Monad wrong tool and composite materializations fail before any signing or send", async (t) => {
  for (const mutation of ["tool", "composite"] as const) {
    const temporary = await temporaryState(); t.after(temporary.cleanup);
    const s = await lifiFixture(temporary.root, "eth-monad");
    s.provider.mutateMaterialization = (step) => {
      if (mutation === "tool") step.tool = "stargateV2";
      else step.includedSteps.push(structuredClone(step.includedSteps[1]));
    };
    const routes = await s.core.execute({ command: "bridge.routes", profile: s.profile, request: s.request });
    const result = await s.core.execute({ command: "bridge.prepare", profile: s.profile,
      quote: (routes.data as any).quote_hash, route: (routes.data as any).routes[0].route_id, idempotencyKey: `monad-refuse-${mutation}` });
    assert.equal(result.ok, false, mutation);
    assert.equal(s.source.submissions.length, 0);
    assert.equal(s.wrapping.loads, 0);
  }
});

test("Monad safe finality and exact native proof are required; ambiguous send stays observe only", async (t) => {
  const unsafeRoot = await temporaryState(); t.after(unsafeRoot.cleanup);
  const unsafe = await lifiFixture(unsafeRoot.root, "eth-monad");
  unsafe.provider.statusValue = "completed_observed"; unsafe.destination.destinationSafe = false;
  const first = await unsafe.prepare("across", "monad-unsafe-001");
  await unsafe.core.execute({ command: "bridge.approve", operationId: first.id });
  assert.notEqual((await unsafe.core.bridges.records.findOperation(first.id))!.state, "completed");
  assert.equal(unsafe.source.submissions.length, 1);

  const ambiguousRoot = await temporaryState(); t.after(ambiguousRoot.cleanup);
  const ambiguous = await lifiFixture(ambiguousRoot.root, "eth-monad", {
    policy: { maximumPerTransferAtomic: "200000000000000", dailyLimitAtomic: "200000000000000" },
  });
  ambiguous.source.sendTimeout = true; ambiguous.source.failObserve = true;
  const prepared = await ambiguous.prepare("across", "monad-ambiguous-001");
  await ambiguous.core.execute({ command: "bridge.approve", operationId: prepared.id });
  assert.equal((await ambiguous.core.bridges.records.findOperation(prepared.id))!.state, "unknown_finality");
  for (let i = 0; i < 2; i++) await ambiguous.core.execute({ command: "operation.resume", operationId: prepared.id });
  assert.equal(ambiguous.source.submissions.length, 1);
  const routes = await ambiguous.core.execute({ command: "bridge.routes", profile: ambiguous.profile, request: ambiguous.request });
  const capped = await ambiguous.core.execute({ command: "bridge.prepare", profile: ambiguous.profile,
    quote: (routes.data as any).quote_hash, route: (routes.data as any).routes[0].route_id, idempotencyKey: "monad-cap-002" });
  assert.equal(capped.ok, false); assert.equal(capped.error?.code, "APN_OPERATION_BLOCKED");
});

test("Monad admission does not change Linea or admit reverse and non Across deployment directions", async (t) => {
  assert.equal(bridgeExecutionDestination(143), true);
  assert.throws(() => bridgeDeployment(143, 1, "stargateV2", BRIDGE_ZERO_ADDRESS), /stargate_pool_asset_unreviewed/u);
  assert.throws(() => bridgeDeployment(1, 143, "stargateV2", BRIDGE_ZERO_ADDRESS), /stargate_pool_asset_unreviewed/u);
  assert.throws(() => bridgeDeployment(143, 8453, "across", BRIDGE_ZERO_ADDRESS), /finite_chain/u);
  const temporary = await temporaryState(); t.after(temporary.cleanup);
  const linea = await lifiFixture(temporary.root, "eth-linea");
  const prepared = await linea.prepare("across", "linea-compatible-001");
  assert.equal(prepared.operation.intent.materialization.request.toChainId, 59144);
  assert.notEqual(prepared.operation.intent.allowlist, null);
});
