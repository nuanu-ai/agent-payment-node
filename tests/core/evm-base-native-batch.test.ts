import assert from "node:assert/strict";
import test from "node:test";
import { decodeFunctionData, toHex } from "viem";
import { ApnError } from "../../src/errors.js";
import { EvmRpc } from "../../src/evm-rpc.js";
import type { EvmRpcBatchCall, EvmTransactionInput } from "../../src/evm-ports.js";
import { EVM_BLOCK_HASH } from "./evm-helpers.js";
import { RECIPIENT, WALLET } from "./helpers.js";

const ORACLE = "0x420000000000000000000000000000000000000F";
const ABI = [
  { type: "function", name: "getL1FeeUpperBound", inputs: [{ name: "size", type: "uint256" }], outputs: [{ type: "uint256" }] },
  { type: "function", name: "getOperatorFee", inputs: [{ name: "gas", type: "uint256" }], outputs: [{ type: "uint256" }] },
] as const;
const transaction: EvmTransactionInput = { chainId: 8453, from: WALLET, to: RECIPIENT, valueAtomic: "1000000000000000", data: "0x" };

function baseWire(options: { chainId?: number; balance?: bigint; reorg?: boolean; rejectAt?: number } = {}) {
  const posts: readonly { readonly method: string; readonly params: readonly unknown[] }[][] = [];
  const calls: EvmRpcBatchCall = async (batch) => {
    (posts as { readonly method: string; readonly params: readonly unknown[] }[][]).push([...batch]);
    if (options.rejectAt === posts.length) throw new ApnError("APN_RPC_RATE_LIMITED", "Synthetic rate limit", { httpStatus: 429 });
    return batch.map(({ method, params }) => {
      if (method === "eth_chainId") return toHex(options.chainId ?? 8453);
      if (method === "eth_getBlockByNumber") return { number: "0x3039", hash: options.reorg && params[0] !== "latest" ? `0x${"11".repeat(32)}` : EVM_BLOCK_HASH,
        baseFeePerGas: "0x64", transactions: [] };
      if (method === "eth_getBalance") { assert.equal(params[1], "0x3039"); return toHex(options.balance ?? 10n ** 18n); }
      if (method === "eth_getTransactionCount") { assert.equal(params[1], "pending"); return "0x7"; }
      if (method === "eth_estimateGas") return "0x5208";
      if (method === "eth_maxPriorityFeePerGas") return "0x3";
      if (method === "eth_call") {
        const [input, tag] = params as [{ to: string; data: `0x${string}` }, string];
        assert.equal(input.to, ORACLE); assert.equal(tag, "0x3039");
        const decoded = decodeFunctionData({ abi: ABI, data: input.data });
        if (decoded.functionName === "getL1FeeUpperBound") { assert.deepEqual(decoded.args, [512n]); return toHex(5000n, { size: 32 }); }
        assert.deepEqual(decoded.args, [21000n]); return toHex(7n, { size: 32 });
      }
      throw new Error(`Unexpected ${method}`);
    });
  };
  const scalar = async () => { throw new Error("Base native funding must not fall back to scalar RPC"); };
  return { posts, rpc: new EvmRpc(scalar, "https://rpc.example", undefined, calls) };
}

function economics(fees: { gasLimitAtomic: string; maxFeePerGasAtomic: string; maxPriorityFeePerGasAtomic: string }) {
  return { nonceAtomic: "7", ...fees, maximumGasCostAtomic: (BigInt(fees.gasLimitAtomic) * BigInt(fees.maxFeePerGasAtomic)).toString() };
}

test("Base native prepare uses six physical batch POSTs and preserves oracle fee upper bounds", async () => {
  const { posts, rpc } = baseWire(); const reads = rpc.prepareBaseNative();
  const balance = await reads.balance(WALLET, { chainId: 8453, token: "native", decimals: 18 });
  const { nonce, estimated } = await reads.nonceEstimate(WALLET, transaction);
  const quote = await reads.feeQuote(economics(estimated));
  assert.equal(posts.length, 6); assert.equal(nonce, "7"); assert.equal(balance.nativeAtomic, (10n ** 18n).toString());
  assert.equal(estimated.maxFeePerGasAtomic, "203"); assert.equal(quote.l1DataFeeUpperWei, "5000");
  assert.equal(quote.operatorFeeUpperWei, "7"); assert.equal(quote.totalQuoteWei, (21000n * 203n + 5007n).toString());
  assert.deepEqual(posts.map((batch) => batch.map(({ method }) => method)), [
    ["eth_chainId", "eth_getBlockByNumber"], ["eth_getBalance"], ["eth_getBlockByNumber", "eth_chainId"],
    ["eth_chainId", "eth_getTransactionCount", "eth_estimateGas", "eth_maxPriorityFeePerGas", "eth_getBlockByNumber"],
    ["eth_call", "eth_call"], ["eth_getBlockByNumber", "eth_chainId"],
  ]);
});

test("Base native post-sign funding reads remain six POSTs without a nonce estimate", async () => {
  const { posts, rpc } = baseWire(); const reads = rpc.prepareBaseNative();
  await reads.balance(WALLET, { chainId: 8453, token: "native", decimals: 18 });
  await reads.feeQuote(economics({ gasLimitAtomic: "21000", maxFeePerGasAtomic: "203", maxPriorityFeePerGasAtomic: "3" }));
  assert.equal(posts.length, 6);
  assert.equal(posts.flat().some(({ method }) => method === "eth_getTransactionCount" || method === "eth_estimateGas"), false);
});

test("Base native batch failures stop without scalar fallback or another POST", async () => {
  for (const options of [{ rejectAt: 2 }, { chainId: 1 }, { reorg: true }]) {
    const { posts, rpc } = baseWire(options);
    await assert.rejects(rpc.prepareBaseNative().balance(WALLET, { chainId: 8453, token: "native", decimals: 18 }),
      { code: options.rejectAt ? "APN_RPC_RATE_LIMITED" : options.chainId ? "APN_CHAIN_MISMATCH" : "APN_RPC_PROTOCOL" });
    assert.ok(posts.length <= 3);
  }
});
