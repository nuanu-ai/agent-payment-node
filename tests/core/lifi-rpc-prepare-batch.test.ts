import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import test from "node:test";
import { decodeFunctionData, encodeFunctionData, encodeFunctionResult, type Hex } from "viem";
import { canonicalJson, hashObject } from "../../src/canonical.js";
import { ApnError } from "../../src/errors.js";
import { acrossBridgeAbi } from "../../src/lifi/abi.js";
import { bridgeDeployment } from "../../src/lifi/deployments.js";
import { RpcReadSession, bridgeRpcFactory } from "../../src/lifi/rpc.js";
import { bridgeDeploymentCheck } from "../../src/lifi/deployment-check.js";
import { BRIDGE_ZERO_ADDRESS } from "../../src/lifi/validation.js";
import { MULTICALL3_ABI } from "../../src/portfolio/evm-reader.js";
import { MULTICALL3_ADDRESS } from "../../src/portfolio/registry.js";
import { addressWord } from "./lifi-event-fixtures.js";
import { LIFI_RECIPIENT, LIFI_SYNTHETIC_SENDER, LifiTestProvider, lifiFixture, lifiSteps } from "./lifi-helpers.js";
import { temporaryState } from "./helpers.js";

type Request = { id: string; method: string; params: unknown[] };
const BASE_USDC = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913" as const, ARB_USDC = "0xaf88d065e77c8cC2239327C5EDb3A432268e5831" as const;
type Capture = { chainId: 1 | 8453 | 42161; requests: Array<{ request: { method: string; params: unknown[] }; response: { result: unknown } }> };

async function prepareSpy(now: Date, aggregateMode: "valid" | "failed" | "malformed" | "reversed" | "delegation" = "valid") {
  const fixture = JSON.parse(await readFile(resolve("tests/core/lifi-fixtures/deployment-rpc-20260908.json"), "utf8")) as { chains: Capture[] };
  const runtimes = JSON.parse(await readFile(resolve("tests/core/lifi-fixtures/wrapped-native-runtime-blockscout-20260922.json"), "utf8")) as {
    contracts: Array<{ chainId: number; address: string; deployedBytecode: string }>;
  };
  const runtime = new Map(runtimes.contracts.map((row) => [`${row.chainId}:${row.address.toLowerCase()}`, row.deployedBytecode]));
  const multicallCode = (await readFile(resolve("tests/core/fixtures/multicall3-runtime-code.hex"), "utf8")).trim();
  const nativeReads = new Map<string, string>();
  for (const [chainId, peerChainId, tool, token] of [[1, 8453, "across", BRIDGE_ZERO_ADDRESS], [8453, 1, "across", BRIDGE_ZERO_ADDRESS],
    [8453, 42161, "stargateV2", BASE_USDC], [42161, 8453, "stargateV2", ARB_USDC]] as const) {
    for (const row of bridgeDeployment(chainId, peerChainId, tool, token).reads) {
      nativeReads.set(canonicalJson([chainId, row.kind, row.address.toLowerCase(), row.data]), row.expected);
    }
  }
  const chainByHost: Record<string, 1 | 8453 | 42161> = {
    "eth-primary.example": 1, "eth-archive.example": 1, "base-primary.example": 8453,
    "base-archive.example": 8453, "arb-primary.example": 42161, "arb-archive.example": 42161,
  };
  const values = new Map<number, Map<string, unknown>>();
  const blocks = new Map<number, Record<string, unknown>>();
  const latestBlocks = new Map<number, Record<string, unknown>>();
  for (const chain of fixture.chains) {
    values.set(chain.chainId, new Map(chain.requests.map((entry) => [canonicalJson([entry.request.method, entry.request.params]), entry.response.result])));
    const safe = chain.requests.find((entry) => entry.request.method === "eth_getBlockByNumber")!.response.result as Record<string, unknown>;
    blocks.set(chain.chainId, { ...safe, baseFeePerGas: "0x3b9aca00" });
    latestBlocks.set(chain.chainId, { ...safe, number: `0x${(BigInt(String(safe.number)) + 1n).toString(16)}`,
      hash: `0x${chain.chainId.toString(16).padStart(64, "0")}`, timestamp: `0x${Math.floor(now.getTime() / 1000).toString(16)}`, baseFeePerGas: "0x3b9aca00" });
  }
  const calls: Array<{ host: string; items: Request[] }> = [];
  const resultFor = (chainId: number, item: Request): unknown => {
    if (aggregateMode === "delegation" && item.method === "eth_getCode" &&
      String(item.params[0]).toLowerCase() !== MULTICALL3_ADDRESS.toLowerCase()) return `0xef0100${"1".repeat(40)}`;
    const captured = values.get(chainId)!.get(canonicalJson([item.method, item.params]));
    if (captured !== undefined) return structuredClone(captured);
    if (item.method === "eth_chainId") return `0x${chainId.toString(16)}`;
    if (item.method === "eth_getBlockByNumber") {
      const latest = latestBlocks.get(chainId)!;
      return structuredClone(item.params[0] === "latest" || item.params[0] === latest.number ? latest : blocks.get(chainId));
    }
    if (item.method === "eth_maxPriorityFeePerGas") return "0x3b9aca00";
    if (item.method === "eth_getBalance") return "0xde0b6b3a7640000";
    if (item.method === "eth_getTransactionCount") return "0x7";
    if (item.method === "eth_estimateGas") return "0x186a0";
    if (item.method === "eth_getCode") {
      if (String(item.params[0]).toLowerCase() === MULTICALL3_ADDRESS.toLowerCase()) return multicallCode;
      const code = runtime.get(`${chainId}:${String(item.params[0]).toLowerCase()}`);
      if (code !== undefined) return code;
    }
    if (item.method === "eth_call") {
      const call = item.params[0] as { to?: unknown; data?: unknown }, data = String(call.data ?? "");
      if (String(call.to).toLowerCase() === MULTICALL3_ADDRESS.toLowerCase()) {
        if (aggregateMode === "malformed") return "0x1234";
        const decoded = decodeFunctionData({ abi: MULTICALL3_ABI, data: data as Hex });
        assert.equal(decoded.functionName, "aggregate3");
        const results = decoded.args[0].map((entry, index) => ({
          success: true, returnData: resultFor(chainId, { id: String(index), method: "eth_call", params: [{ to: entry.target, data: entry.callData }, item.params[1]] }) as Hex,
        }));
        if (aggregateMode === "failed" && results[0] !== undefined) results[0] = { success: false, returnData: "0x" };
        if (aggregateMode === "reversed") results.reverse();
        return encodeFunctionResult({ abi: MULTICALL3_ABI, functionName: "aggregate3", result: results });
      }
      const expected = nativeReads.get(canonicalJson([chainId, "call", String(call.to).toLowerCase(), data]));
      if (expected !== undefined) return expected;
      if (data.startsWith("0x70a08231")) return `0x${(100_000_000n).toString(16).padStart(64, "0")}`;
      return `0x${"0".repeat(64)}`;
    }
    if (item.method === "eth_getStorageAt") {
      const expected = nativeReads.get(canonicalJson([chainId, "storage", String(item.params[0]).toLowerCase(), item.params[1]]));
      if (expected !== undefined) return expected;
    }
    throw new Error(`Unstubbed RPC ${chainId} ${canonicalJson([item.method, item.params])}`);
  };
  const transport = { request: async (endpoint: string, _verb: string, body: string | null) => {
    const host = new URL(endpoint).host, chainId = chainByHost[host]; assert.ok(chainId);
    const parsed = JSON.parse(body!) as Request | Request[], items = Array.isArray(parsed) ? parsed : [parsed];
    calls.push({ host, items });
    const responses = items.map((item) => ({ jsonrpc: "2.0", id: item.id, result: resultFor(chainId, item) }));
    return { status: 200, body: JSON.stringify(Array.isArray(parsed) ? responses : responses[0]) };
  } };
  const rpcFor = bridgeRpcFactory({
    APN_ETHEREUM_RPC_URL: "https://eth-primary.example", APN_ETHEREUM_ARCHIVE_RPC_URL: "https://eth-archive.example",
    APN_BASE_RPC_URL: "https://base-primary.example", APN_BASE_ARCHIVE_RPC_URL: "https://base-archive.example",
    APN_ARBITRUM_RPC_URL: "https://arb-primary.example", APN_ARBITRUM_ARCHIVE_RPC_URL: "https://arb-archive.example",
  }, { transport, wait: async () => {} });
  const sessions: RpcReadSession[] = [];
  return { rpcFor: ((chainId, session) => {
    if (session !== undefined) sessions.push(session);
    return rpcFor(chainId, session);
  }) satisfies typeof rpcFor, calls, sessions };
}

async function nativeEthBase(now: Date): Promise<LifiTestProvider> {
  const step = structuredClone((await lifiSteps("eth-linea", now))[0]!);
  const baseNative = { ...step.action.toToken, chainId: 8453, address: "0x0000000000000000000000000000000000000000" };
  step.action.toChainId = 8453; step.action.toToken = baseNative; step.action.toAddress = LIFI_RECIPIENT;
  const cross = step.includedSteps[1]; cross.action.toChainId = 8453; cross.action.toToken = structuredClone(baseNative); cross.action.toAddress = LIFI_RECIPIENT;
  const decoded = decodeFunctionData({ abi: acrossBridgeAbi, data: step.transactionRequest.data });
  const args = structuredClone(decoded.args) as unknown as any[];
  args[0].receiver = LIFI_RECIPIENT; args[0].destinationChainId = 8453n;
  args[2].receiverAddress = addressWord(LIFI_RECIPIENT); args[2].refundAddress = addressWord(LIFI_SYNTHETIC_SENDER);
  args[2].receivingAssetId = addressWord("0x4200000000000000000000000000000000000006");
  step.transactionRequest.data = encodeFunctionData({ abi: acrossBridgeAbi, functionName: decoded.functionName, args: args as never });
  return new LifiTestProvider([step], now);
}

for (const flow of [
  { pair: "eth-base" as const, tool: "across" as const, native: true },
  { pair: "base-arb" as const, tool: "stargateV2" as const, native: false },
]) test(`LI.FI ${flow.pair} ${flow.tool} complete prepare reads two primary batches and no archive`, async (t) => {
  const temporary = await temporaryState(); t.after(temporary.cleanup);
  const now = new Date(flow.native ? "2026-09-20T10:54:00.000Z" : "2026-09-08T12:00:00.000Z");
  const spy = await prepareSpy(now); const provider = flow.native ? await nativeEthBase(now) : undefined;
  const f = await lifiFixture(temporary.root, flow.pair, { rpcFor: spy.rpcFor, now,
    ...(provider === undefined ? {} : { provider, maxNativeDebitWei: "3000000000000000" }) });
  const prepared = await f.prepare(flow.tool), intent = prepared.operation.intent, request = intent.materialization.request;
  assert.ok(prepared.operation); assert.equal(f.provider.materializeCalls, 1);
  // One source batch (chain, head, account, Base fee inputs, the planned simulation and the deployment check), one destination head.
  assert.equal(spy.calls.length, 2); assert.ok(spy.calls.every((call) => call.host.includes("primary")));
  const [source, destination] = [spy.calls.find((call) => call.items.some((item) => item.method === "eth_getBalance"))!,
    spy.calls.find((call) => !call.items.some((item) => item.method === "eth_getBalance"))!];
  assert.ok(source.items.every((item) => !["eth_getCode", "eth_getStorageAt"].includes(item.method)));
  assert.ok(source.items.filter((item) => item.params.length === 2 && typeof item.params[1] === "string" && item.method !== "eth_getTransactionCount")
    .every((item) => item.params[1] === "latest"));
  const check = bridgeDeploymentCheck(request.fromChainId, request.toChainId, flow.tool, request.fromToken, "source");
  assert.equal(source.items.filter((item) => item.method === "eth_call").length, check.reads.length + (request.fromChainId === 8453 ? 3 : 0) +
    (flow.native ? 0 : 2));
  assert.deepEqual(destination.items.map((item) => item.method), ["eth_chainId", "eth_getBlockByNumber"]);
  assert.equal(intent.sourceDeployment.contractHash, check.contractHash);
  assert.equal(intent.sourceDeployment.configurationHash, hashObject(check.reads));
  assert.equal(intent.destinationDeployment.configurationHash, hashObject([]));
  assert.deepEqual(intent.destinationStartBlock, intent.destinationDeployment.block);
  if (flow.pair === "base-arb") {
    const beforeApproval = spy.calls.length; f.approval.accepted = false;
    const rejected = await f.core.execute({ command: "bridge.approve", operationId: prepared.id });
    assert.equal(rejected.ok, true, JSON.stringify(rejected.error));
    assert.equal((rejected.operation as { state: string }).state, "failed_before_effect");
    // The guard before consent is the source batch alone: an Arbitrum Stargate destination reads nothing before the send.
    const execution = spy.calls.slice(beforeApproval);
    assert.equal(execution.length, 1); assert.equal(execution[0]!.host, "base-primary.example");
    assert.equal(spy.sessions.at(-1)!.telemetry().httpRequests, 1);
  }
});

