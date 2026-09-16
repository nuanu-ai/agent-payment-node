import assert from "node:assert/strict";
import test from "node:test";
import { encodeFunctionData, parseAbi } from "viem";
import { CircleBaseJsonRpc } from "../../src/lifi/circle-v2-source-service.js";

const payer = "0x000000000000000000000000000000000000bEEF";
const token = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";
const spender = "0x71f54F818671cD0D7ea140Da213e5C8b5C92a408";
const hash = `0x${"a".repeat(64)}`;
const oldHash = `0x${"b".repeat(64)}`;
const word = (n: bigint) => `0x${n.toString(16).padStart(64, "0")}`;
const balanceData = encodeFunctionData({ abi: parseAbi(["function balanceOf(address) view returns (uint256)"]),
  functionName: "balanceOf", args: [payer] });
const allowanceData = encodeFunctionData({ abi: parseAbi(["function allowance(address,address) view returns (uint256)"]),
  functionName: "allowance", args: [payer, spender] });
function mock(change?: (method: string, params: any[]) => unknown) {
  const requests: { method: string; params: any[] }[] = [];
  const https = { request: async (_endpoint: string, _verb: string, body: string) => {
    const query = JSON.parse(body); requests.push({ method: query.method, params: query.params });
    const result = change?.(query.method, query.params) ?? (
      query.method === "eth_chainId" ? "0x2105" :
      query.method === "eth_getBlockByNumber" ? { hash: query.params[0] === "0x62" ? oldHash : hash, baseFeePerGas: "0x3b9aca00" } :
      query.method === "eth_call" ? query.params[0].data === balanceData ? word(1_100_000n) :
        query.params[0].data === allowanceData ? word(1_050_000n) : "0x" :
      query.method === "eth_getBalance" ? "0x38d7ea4c68000" :
      query.method === "eth_getTransactionCount" ? "0x7" :
      query.method === "eth_estimateGas" ? "0x186a0" :
      query.method === "eth_maxPriorityFeePerGas" ? "0x5f5e100" : null);
    return { status: 200, body: JSON.stringify({ jsonrpc: "2.0", id: query.id, result }) };
  } } as any;
  return { rpc: new CircleBaseJsonRpc("https://base.example.org", https), requests };
}
const query = { payer, token, spender, to: spender, data: "0x1234", valueAtomic: "0",
  draftBlockNumber: "98", freshBlockNumber: "99", freshBlockHash: hash };
test("reads Base source state at canonical block hash and parses padded ERC20 words", async () => {
  const { rpc, requests } = mock();
  const result = await rpc.readSource(query);
  assert.equal(result.draftBlockHash, oldHash); assert.equal(result.usdcBalanceAtomic, "1100000");
  assert.equal(result.usdcAllowanceAtomic, "1050000"); assert.equal(result.gasLimitAtomic, "120001");
  assert.equal(result.maxFeePerGasWei, "2100000000");
  for (const read of requests.filter(r => ["eth_call", "eth_getBalance", "eth_estimateGas"].includes(r.method)))
    assert.deepEqual(read.params[1], { blockHash: hash, requireCanonical: true });
});
test("fails closed on RPC chain mismatch and changed canonical block", async () => {
  await assert.rejects(mock((method) => method === "eth_chainId" ? "0x1" : undefined).rpc.readSource(query));
  await assert.rejects(mock((method, params) => method === "eth_getBlockByNumber" && params[0] === "0x63"
    ? { hash: oldHash, baseFeePerGas: "0x1" } : undefined).rpc.readSource(query));
});
