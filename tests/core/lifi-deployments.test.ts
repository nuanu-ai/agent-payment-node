import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import test from "node:test";
import { canonicalJson, sha256 } from "../../src/canonical.js";
import type { EvmChainId } from "../../src/evm-asset.js";
import type { EvmRpcCall } from "../../src/evm-ports.js";
import { FEE_FORWARDER, FEE_RECIPIENT } from "../../src/lifi/abi.js";
import { BRIDGE_ASSET_REGISTRY } from "../../src/lifi/asset-registry.js";
import { BridgeRpc, RpcReadSession, bridgeRpcFactory, type RpcBatchReadItem } from "../../src/lifi/rpc.js";
import { bridgeDeployment } from "../../src/lifi/deployments.js";
import { BASE_FEE_CONTRACT } from "../../src/lifi/rpc-fees.js";
import type { BridgeTool } from "../../src/lifi/model.js";

type Entry = { request: { method: string; params: unknown[] }; response: { result: unknown } };
type Capture = { chainId: EvmChainId; rpcOrigin: string; requests: Entry[];
  safeBlock: { number: string; hash: string; timestamp: string }; verification: { chainMatches: boolean; blockMatches: boolean };
  invocations: Array<{ peerChainId: EvmChainId; tool: BridgeTool }> };
const raw = await readFile(resolve("tests/core/lifi-fixtures/deployment-rpc-20260908.json"), "utf8");
assert.equal(sha256(raw), "a07fc84d38e22270965e4a43c4e42fec426256afdebe4de5a8f7898b160cbe6e");
const fixture = JSON.parse(raw) as { chains: Capture[]; verification: { fixtureRequestCount: number; allChainsPassed: boolean } };
/** The capture was recorded for canonical USDC, which is the registry row every replay pins. */
const usdc = (chainId: EvmChainId) => BRIDGE_ASSET_REGISTRY[chainId].tokens.find((row) => row.symbol === "USDC")!.address;

test("LI.FI prepare phases fit the exact two-chain proof batches and seven-request ceiling", () => {
  const zero = "0x0000000000000000000000000000000000000000";
  const proofItems = (chainId: EvmChainId, peerChainId: EvmChainId, tool: BridgeTool, token: string) => {
    const contract = bridgeDeployment(chainId, peerChainId, tool, token as `0x${string}`);
    return contract.code.length + contract.reads.length + 1 + (chainId === 8453 ? BASE_FEE_CONTRACT.code.length + BASE_FEE_CONTRACT.reads.length : 0);
  };
  assert.equal(proofItems(1, 8453, "across", zero), 16);
  assert.equal(proofItems(8453, 1, "across", zero), 24);
  assert.equal(proofItems(8453, 42161, "stargateV2", usdc(8453)), 32);
  assert.equal(proofItems(42161, 8453, "stargateV2", usdc(42161)), 24);
  const phaseARequests = 2, phaseBRequests = 2, maximumSourcePhaseCRequests = 3;
  assert.equal(phaseARequests + phaseBRequests + maximumSourcePhaseCRequests, 7);
});
function replay(capture: Capture, changed?: Entry) {
  const values = new Map<string, unknown>(), calls: Array<{ method: string; params: readonly unknown[] }> = [];
  for (const entry of capture.requests) {
    const key = canonicalJson([entry.request.method, entry.request.params]);
    if (values.has(key)) assert.deepEqual(values.get(key), entry.response.result);
    values.set(key, structuredClone(entry.response.result));
  }
  if (changed) values.set(canonicalJson([changed.request.method, changed.request.params]), changed.response.result);
  const call: EvmRpcCall = async (method, params) => {
    calls.push({ method, params }); const key = canonicalJson([method, params]);
    assert.ok(values.has(key), `Uncaptured RPC request ${key}`); return structuredClone(values.get(key));
  };
  return { rpc: new BridgeRpc(capture.chainId, capture.rpcOrigin, call), calls, call };
}

function batchedReplay(capture: Capture) {
  const baseline = replay(capture), session = new RpcReadSession({ wait: async () => {} });
  const attempt = async (body: string) => {
    const items = JSON.parse(body) as Array<{ jsonrpc: "2.0"; id: string; method: string; params: readonly unknown[] }>;
    return await Promise.all(items.map(async (item) => ({ jsonrpc: "2.0", id: item.id, result: await baseline.call(item.method, item.params) })));
  };
  const batchFactory = (bound: RpcReadSession) => async (items: readonly Omit<RpcBatchReadItem, "batchAttempt">[]) =>
    await bound.readBatch(capture.rpcOrigin, capture.chainId, items.map((item) => ({ ...item, batchAttempt: attempt })));
  return { rpc: new BridgeRpc(capture.chainId, capture.rpcOrigin, baseline.call, session, baseline.call, undefined, batchFactory), session };
}

test("LI.FI frozen deployment capture preserves the independently observed owner-versus-recipient mismatch", () => {
  assert.equal(fixture.verification.fixtureRequestCount, 119); assert.equal(fixture.verification.allChainsPassed, false);
  for (const chain of fixture.chains) {
    assert.equal(chain.verification.chainMatches, true); assert.equal(chain.verification.blockMatches, true);
    const owner = chain.requests.find((r) => r.request.method === "eth_call" &&
      (r.request.params[0] as { data: string }).data === "0x8da5cb5b")!;
    assert.equal(owner.response.result, "0x00000000000000000000000008647cc950813966142a416d40c382e2c5db73bb");
    assert.notEqual((owner.response.result as string).slice(-40), FEE_RECIPIENT.slice(2).toLowerCase());
  }
});

test("LI.FI Base and Arbitrum Stargate deployment proofs execute as one bounded HTTP batch per chain", async () => {
  const base = fixture.chains.find((chain) => chain.chainId === 8453)!, arb = fixture.chains.find((chain) => chain.chainId === 42161)!;
  const source = batchedReplay(base), destination = batchedReplay(arb);
  await source.rpc.deployment("stargateV2", 42161, usdc(8453));
  await destination.rpc.deployment("stargateV2", 8453, usdc(42161));
  assert.equal(source.session.telemetry().httpRequests, 2); assert.equal(destination.session.telemetry().httpRequests, 2);
  assert.equal(source.session.telemetry().batchCount, 2); assert.equal(destination.session.telemetry().batchCount, 2);
  assert.equal(source.session.telemetry().logicalItems, 34); // chain + safe header, then exact 32-item proof/recheck phase
  assert.equal(destination.session.telemetry().logicalItems, 26); // chain + safe header, then exact 24-item proof/recheck phase
});

test("LI.FI Base Stargate deployment sends the exact 33-item proof batch to the archive", async () => {
  const capture = fixture.chains.find((chain) => chain.chainId === 8453)!;
  const values = new Map(capture.requests.map((entry) => [canonicalJson([entry.request.method, entry.request.params]), entry.response.result]));
  const requests: Array<{ host: string; items: Array<{ id: string; method: string; params: unknown[] }> }> = [];
  const transport = { request: async (endpoint: string, _verb: string, body: string | null) => {
    const items = JSON.parse(body!) as Array<{ id: string; method: string; params: unknown[] }>;
    requests.push({ host: new URL(endpoint).host, items });
    return { status: 200, body: JSON.stringify(items.map((item) => {
      const key = canonicalJson([item.method, item.params]); assert.ok(values.has(key), `Uncaptured RPC request ${key}`);
      return { jsonrpc: "2.0", id: item.id, result: structuredClone(values.get(key)) };
    })) };
  } };
  const session = new RpcReadSession({ wait: async () => {} });
  const rpc = bridgeRpcFactory({ APN_BASE_RPC_URL: "https://base-primary.example", APN_BASE_ARCHIVE_RPC_URL: "https://base-archive.example" }, { transport, wait: async () => {} })(8453, session);
  await rpc.deployment("stargateV2", 42161, usdc(8453));
  assert.equal(requests.length, 2);
  assert.equal(requests[0]!.host, "base-primary.example"); assert.equal(requests[0]!.items.length, 2);
  assert.equal(requests[1]!.host, "base-archive.example"); assert.equal(requests[1]!.items.length, 33);
  assert.equal(requests[1]!.items[0]!.method, "eth_chainId");
  assert.ok(requests[1]!.items.slice(1).every((item) => item.method === "eth_getCode" || item.method === "eth_getStorageAt" || item.method === "eth_call" || item.method === "eth_getBlockByNumber"));
});

for (const chain of fixture.chains) {
  for (const invocation of chain.invocations) {
    test(`LI.FI actual RPC deployment ${chain.chainId}->${invocation.peerChainId} ${invocation.tool} verifies every code/configuration pin`, async () => {
      const { rpc, calls } = replay(chain); const proof = await rpc.deployment(invocation.tool, invocation.peerChainId, usdc(chain.chainId));
      assert.equal(proof.block.hash, chain.safeBlock.hash); assert.equal(proof.rpcOrigin, chain.rpcOrigin);
      assert.equal(proof.chainId, chain.chainId); assert.equal(proof.peerChainId, invocation.peerChainId);
      assert.equal(calls.filter((c) => c.method === "eth_getCode").length, invocation.tool === "across" ? (chain.chainId === 8453 ? 9 : 7) : (chain.chainId === 8453 ? 10 : 8));
      assert.ok(calls.filter((c) => ["eth_getCode", "eth_getStorageAt", "eth_call"].includes(c.method)).every((c) => c.params.at(-1) === chain.safeBlock.number));
      const historical = await rpc.deployment(invocation.tool, invocation.peerChainId, usdc(chain.chainId), proof.block); assert.deepEqual(historical, proof);
    });
  }
  test(`LI.FI deployment ${chain.chainId} rejects independently changed code, owner, proxy, facet, token, peer and fee configuration`, async () => {
    const successful = new Map<string, { tool: BridgeTool; peerChainId: EvmChainId }>();
    for (const invocation of chain.invocations) {
      const { rpc, calls } = replay(chain); await rpc.deployment(invocation.tool, invocation.peerChainId, usdc(chain.chainId));
      for (const call of calls) successful.set(canonicalJson([call.method, call.params]), invocation);
    }
    let checked = 0;
    for (const entry of chain.requests.filter((e) => ["eth_getCode", "eth_getStorageAt", "eth_call"].includes(e.request.method))) {
      const invocation = successful.get(canonicalJson([entry.request.method, entry.request.params])); assert.ok(invocation);
      const changed = structuredClone(entry), value = changed.response.result as string;
      changed.response.result = `${value.slice(0, -1)}${value.endsWith("0") ? "1" : "0"}`;
      await assert.rejects(replay(chain, changed).rpc.deployment(invocation.tool, invocation.peerChainId, usdc(chain.chainId)), { code: "APN_PROVIDER_PROTOCOL" }); checked++;
    }
    assert.ok(checked >= 33);
    const owner = structuredClone(chain.requests.find((e) => e.request.method === "eth_call" &&
      (e.request.params[0] as { to: string; data: string }).to === FEE_FORWARDER && (e.request.params[0] as { data: string }).data === "0x8da5cb5b")!);
    owner.response.result = `0x${"0".repeat(24)}${FEE_RECIPIENT.slice(2).toLowerCase()}`;
    await assert.rejects(replay(chain, owner).rpc.deployment("across", chain.invocations[0]!.peerChainId, usdc(chain.chainId)), { code: "APN_PROVIDER_PROTOCOL" });
  });
  test(`LI.FI deployment ${chain.chainId} refuses a changed chain or safe block after reading pins`, async () => {
    for (const failure of ["chain", "block"]) {
      const baseline = replay(chain), peer = chain.invocations[0]!.peerChainId;
      let chainCalls = 0;
      const call: EvmRpcCall = async (method, params) => {
        const value = await baseline.call(method, params);
        if (failure === "chain" && method === "eth_chainId" && ++chainCalls >= 4) return "0xa";
        if (failure === "block" && method === "eth_getBlockByNumber" && params[0] === chain.safeBlock.number) return { ...(value as object), hash: `0x${"ff".repeat(32)}` };
        return value;
      };
      await assert.rejects(new BridgeRpc(chain.chainId, chain.rpcOrigin, call).deployment("across", peer, usdc(chain.chainId)));
    }
  });
}
