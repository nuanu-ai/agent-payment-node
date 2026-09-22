import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import test from "node:test";
import { decodeFunctionData, encodeFunctionData } from "viem";
import { canonicalJson } from "../../src/canonical.js";
import { acrossBridgeAbi } from "../../src/lifi/abi.js";
import { bridgeDeployment } from "../../src/lifi/deployments.js";
import { RpcReadSession, bridgeRpcFactory } from "../../src/lifi/rpc.js";
import { addressWord } from "./lifi-event-fixtures.js";
import { LIFI_RECIPIENT, LIFI_SYNTHETIC_SENDER, LifiTestProvider, lifiFixture, lifiSteps } from "./lifi-helpers.js";
import { temporaryState } from "./helpers.js";

type Request = { id: string; method: string; params: unknown[] };
type Capture = { chainId: 1 | 8453 | 42161; requests: Array<{ request: { method: string; params: unknown[] }; response: { result: unknown } }> };

async function prepareSpy(now: Date) {
  const fixture = JSON.parse(await readFile(resolve("tests/core/lifi-fixtures/deployment-rpc-20260908.json"), "utf8")) as { chains: Capture[] };
  const runtimes = JSON.parse(await readFile(resolve("tests/core/lifi-fixtures/wrapped-native-runtime-blockscout-20260922.json"), "utf8")) as {
    contracts: Array<{ chainId: number; address: string; deployedBytecode: string }>;
  };
  const runtime = new Map(runtimes.contracts.map((row) => [`${row.chainId}:${row.address.toLowerCase()}`, row.deployedBytecode]));
  const nativeReads = new Map<string, string>();
  for (const [chainId, peerChainId] of [[1, 8453], [8453, 1]] as const) {
    for (const row of bridgeDeployment(chainId, peerChainId, "across", "0x0000000000000000000000000000000000000000").reads) {
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
      const code = runtime.get(`${chainId}:${String(item.params[0]).toLowerCase()}`);
      if (code !== undefined) return code;
    }
    if (item.method === "eth_call") {
      const call = item.params[0] as { to?: unknown; data?: unknown }, data = String(call.data ?? "");
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
  { pair: "eth-base" as const, tool: "across" as const, archiveSizes: {
    "eth-archive.example": [3, 3, 3, 3, 3, 2], "base-archive.example": [3, 3, 3, 3, 3, 3, 3, 3, 1],
  }, requests: 19, native: true },
  { pair: "base-arb" as const, tool: "stargateV2" as const, archiveSizes: {
    "base-archive.example": [3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3], "arb-archive.example": [3, 3, 3, 3, 3, 3, 3, 3, 1],
  }, requests: 24, native: false },
]) test(`LI.FI ${flow.pair} ${flow.tool} complete prepare caps archive HTTP batches at three items`, async (t) => {
  const temporary = await temporaryState(); t.after(temporary.cleanup);
    const now = new Date(flow.native ? "2026-09-20T10:54:00.000Z" : "2026-09-08T12:00:00.000Z");
    const spy = await prepareSpy(now); const provider = flow.native ? await nativeEthBase(now) : undefined;
    const f = await lifiFixture(temporary.root, flow.pair, { rpcFor: spy.rpcFor, now,
      ...(provider === undefined ? {} : { provider, maxNativeDebitWei: "3000000000000000" }) });
    const prepared = await f.prepare(flow.tool);
    assert.ok(prepared.operation); assert.equal(f.provider.materializeCalls, 1);
    assert.match(prepared.operation.intent.sourceDeployment.codeHash, /^[0-9a-f]{64}$/u);
    assert.match(prepared.operation.intent.destinationDeployment.codeHash, /^[0-9a-f]{64}$/u);
    assert.equal(spy.calls.length, flow.requests);
    const archive = spy.calls.filter((call) => call.host.includes("archive"));
    for (const [host, sizes] of Object.entries(flow.archiveSizes)) {
      assert.deepEqual(archive.filter((call) => call.host === host).map((call) => call.items.length), sizes);
    }
    assert.ok(archive.every((call) => call.items.length <= 3));
    assert.equal(archive.filter((call) => call.items.some((item) => item.method === "eth_chainId")).length, 2);
    const primary = spy.calls.filter((call) => call.host.includes("primary"));
    assert.equal(primary.length, 4);
    assert.equal(primary.filter((call) => call.items.some((item) => item.method === "eth_getBalance")).length, 1);
    assert.equal(primary.filter((call) => call.items.some((item) => item.method === "eth_estimateGas")).length, 1);
    assert.ok(primary.every((call) => !call.items.some((item) => item.method === "eth_getBalance" && item.params[1] === "latest")));
    for (const call of primary) {
      const stateTag = call.items.find((item) => item.method === "eth_getBalance")?.params[1];
      const baseFeeCalls = call.items.filter((item) => item.method === "eth_call" &&
        ["0x420000000000000000000000000000000000000f", "0x4200000000000000000000000000000000000015"]
          .includes(String((item.params[0] as { to?: unknown }).to).toLowerCase()));
      if (baseFeeCalls.length > 0) {
        assert.equal(baseFeeCalls.length, 3); assert.notEqual(stateTag, undefined);
        assert.ok(baseFeeCalls.every((item) => item.params[1] === stateTag && item.params[1] !== "latest"));
      }
    }
    if (flow.pair === "base-arb") {
      const beforeApproval = spy.calls.length; f.approval.accepted = false;
      const rejected = await f.core.execute({ command: "bridge.approve", operationId: prepared.id });
      assert.equal(rejected.ok, true, JSON.stringify(rejected.error));
      assert.equal((rejected.operation as { state: string }).state, "failed_before_effect");
      const execution = spy.calls.slice(beforeApproval), executionArchive = execution.filter((call) => call.host.includes("archive"));
      assert.equal(execution.length, 24); assert.equal(execution.filter((call) => call.host.includes("primary")).length, 4);
      assert.deepEqual(executionArchive.filter((call) => call.host === "base-archive.example").map((call) => call.items.length),
        [3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3]);
      assert.deepEqual(executionArchive.filter((call) => call.host === "arb-archive.example").map((call) => call.items.length),
        [3, 3, 3, 3, 3, 3, 3, 3, 1]);
      assert.ok(executionArchive.every((call) => call.items.length <= 3));
      assert.equal(spy.sessions.at(-1)!.telemetry().httpRequests, 24);
      assert.equal(spy.sessions.at(-1)!.telemetry().remainingHttpRequests, 4);
    }
});
