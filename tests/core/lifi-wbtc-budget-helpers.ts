import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { decodeFunctionData, encodeFunctionResult, keccak256, parseTransaction, type Hex } from "viem";
import { canonicalJson } from "../../src/canonical.js";
import { bridgeDeployment } from "../../src/lifi/deployments.js";
import { RpcReadSession, bridgeRpcFactory } from "../../src/lifi/rpc.js";
import { privateKeyToAccount } from "viem/accounts";
import { LIFI_SYNTHETIC_KEY } from "./lifi-helpers.js";
import { approvalData } from "../../src/lifi/transaction.js";
import { MULTICALL3_ABI } from "../../src/portfolio/evm-reader.js";
import { MULTICALL3_ADDRESS } from "../../src/portfolio/registry.js";
export const ETH_WBTC = "0x2260FAC5E5542a773Aa44fBCfeDf7C193bc2C599" as const;
export const ARB_WBTC = "0x2f2a2543B76A4166549F7aaB2e75Bef0aefC5B0f" as const;
type Request = { id: string; method: string; params: unknown[] };
type Capture = { chainId: 1 | 8453 | 42161; requests: Array<{ request: { method: string; params: unknown[] }; response: { result: unknown } }> };

export async function wbtcBudgetSpy(now: Date, aggregateMode: "valid" | "failed" | "malformed" | "reversed" | "delegation" = "valid") {
  const fixture = JSON.parse(await readFile(resolve("tests/core/lifi-fixtures/deployment-rpc-20260908.json"), "utf8")) as { chains: Capture[] };
  const runtimes = JSON.parse(await readFile(resolve("tests/core/lifi-fixtures/wrapped-native-runtime-blockscout-20260922.json"), "utf8")) as {
    contracts: Array<{ chainId: number; address: string; deployedBytecode: string }>;
  };
  const wbtc = JSON.parse(await readFile(resolve("tests/core/lifi-fixtures/wbtc-runtime-readonly-20261009.json"), "utf8")) as { rows: Array<{ chainId: number; address: string; result: string }> };
  const runtime = new Map([...runtimes.contracts, ...wbtc.rows.map(row => ({ ...row, deployedBytecode: row.result }))].map((row) => [`${row.chainId}:${row.address.toLowerCase()}`, row.deployedBytecode]));
  for (const chain of fixture.chains) for (const row of chain.requests) if (row.request.method === "eth_getCode") runtime.set(`${chain.chainId}:${String(row.request.params[0]).toLowerCase()}`, String(row.response.result));
  const approval = JSON.parse(await readFile(resolve("tests/core/lifi-fixtures/wbtc-approval-readonly-20261009.json"), "utf8"));
  const arbBlock = fixture.chains.find(row => row.chainId === 42161)!.requests.find(row => row.request.method === "eth_getBlockByNumber")!.response.result as Record<string, unknown>;
  const signer = privateKeyToAccount(LIFI_SYNTHETIC_KEY);
  const raw = await signer.signTransaction({ type: "eip1559", chainId: 42161, nonce: 5, to: ARB_WBTC,
    value: 0n, data: approvalData("0x1231DEB6f5749EF6cE6943a275A1D3E7486F4EaE", "1000"), gas: 65000n,
    maxFeePerGas: 3000000000n, maxPriorityFeePerGas: 0n });
  const parsed = parseTransaction(raw), hash = keccak256(raw);
  const arbApproval = { block: { ...arbBlock, transactions: [hash] }, safe: { ...arbBlock, transactions: [hash] },
    transaction: { ...approval.transaction, hash, from: signer.address, to: ARB_WBTC, chainId: "0xa4b1", nonce: "0x5", gas: "0xfde8",
      maxFeePerGas: "0xb2d05e00", maxPriorityFeePerGas: "0x0", input: parsed.data, r: parsed.r, s: parsed.s,
      yParity: `0x${parsed.yParity}`, v: `0x${parsed.yParity}`, blockHash: arbBlock.hash, blockNumber: arbBlock.number, transactionIndex: "0x0" },
    receipt: { ...approval.receipt, transactionHash: hash, from: signer.address, to: ARB_WBTC, blockHash: arbBlock.hash,
      blockNumber: arbBlock.number, transactionIndex: "0x0", gasUsedForL1: "0x0", logs: [] } };
  let observing = false, observationChain = 1;
  const multicallCode = (await readFile(resolve("tests/core/fixtures/multicall3-runtime-code.hex"), "utf8")).trim();
  const nativeReads = new Map<string, string>();
  for (const [chainId, peerChainId] of [[1, 42161], [42161, 1]] as const) {
    for (const row of bridgeDeployment(chainId, peerChainId, "across", (chainId === 1 ? ETH_WBTC : ARB_WBTC)).reads) {
      nativeReads.set(canonicalJson([chainId, row.kind, row.address.toLowerCase(), row.data]), row.expected);
    }
  }
  const chainByHost: Record<string, 1 | 8453 | 42161> = {
    "eth-primary.example": 1, "eth-archive.example": 1, "eth-receipt.example": 1, "base-primary.example": 8453,
    "base-archive.example": 8453, "arb-primary.example": 42161, "arb-archive.example": 42161, "arb-receipt.example": 42161,
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
    if (observing && chainId === observationChain) {
      const model = observationChain === 1 ? approval : arbApproval;
      if (item.method === "eth_getTransactionByHash") return model.transaction;
      if (item.method === "eth_getTransactionReceipt") return model.receipt;
      if (item.method === "eth_getBlockByNumber") return item.params[0] === "safe" || item.params[0] === model.safe.number ? model.safe : model.block;
    }
    if (aggregateMode === "delegation" && item.method === "eth_getCode" &&
      String(item.params[0]).toLowerCase() !== MULTICALL3_ADDRESS.toLowerCase()) return `0xef0100${"1".repeat(40)}`;
    const captured = values.get(chainId)!.get(canonicalJson([item.method, item.params]));
    if (item.method === "eth_call" || item.method === "eth_getStorageAt") {
      const address = item.method === "eth_call" ? String((item.params[0] as { to: string }).to) : String(item.params[0]);
      const data = item.method === "eth_call" ? String((item.params[0] as { data: string }).data) : String(item.params[1]);
      const expected = nativeReads.get(canonicalJson([chainId, item.method === "eth_call" ? "call" : "storage", address.toLowerCase(), data]));
      if (expected !== undefined) return expected;
    }
    if (captured !== undefined) return structuredClone(captured);
    if (item.method === "eth_chainId") return `0x${chainId.toString(16)}`;
    if (item.method === "eth_getBlockByNumber") {
      const latest = latestBlocks.get(chainId)!;
      return structuredClone(item.params[0] === "latest" || item.params[0] === latest.number ? latest : blocks.get(chainId));
    }
    if (item.method === "eth_maxPriorityFeePerGas") return "0x3b9aca00";
    if (item.method === "eth_getBalance") return "0xde0b6b3a7640000";
    if (item.method === "eth_getTransactionCount") return "0x8";
    if (item.method === "eth_estimateGas") return "0x186a0";
    if (item.method === "eth_getCode") {
      const code = runtime.get(`${chainId}:${String(item.params[0]).toLowerCase()}`); if (code !== undefined) return code;
      if (String(item.params[0]).toLowerCase() === MULTICALL3_ADDRESS.toLowerCase()) return multicallCode;

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
      if (data.startsWith("0xdd62ed3e")) return `0x${1000n.toString(16).padStart(64, "0")}`;
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
    APN_ETHEREUM_RPC_URL: "https://eth-primary.example", APN_ETHEREUM_ARCHIVE_RPC_URL: "https://eth-archive.example", APN_ETHEREUM_RECEIPT_RPC_URL: "https://eth-receipt.example",
    APN_BASE_RPC_URL: "https://base-primary.example", APN_BASE_ARCHIVE_RPC_URL: "https://base-archive.example",
    APN_ARBITRUM_RPC_URL: "https://arb-primary.example", APN_ARBITRUM_ARCHIVE_RPC_URL: "https://arb-archive.example", APN_ARBITRUM_RECEIPT_RPC_URL: "https://arb-receipt.example",
  }, { transport, wait: async () => {} });
  const sessions: RpcReadSession[] = [];
  return { approval, arbApproval, observeMode(value: boolean, chain = 1) { observing = value; observationChain = chain; }, resultFor, rpcFor: ((chainId, session) => {
    if (session !== undefined) sessions.push(session);
    return rpcFor(chainId, session);
  }) satisfies typeof rpcFor, calls, sessions };
}
