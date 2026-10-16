import assert from "node:assert/strict";
import test from "node:test";
import { toHex } from "viem";
import { ApnError } from "../../src/errors.js";
import { DIRECT_EVM_NETWORKS, directEvmListRows, type DirectEvmChainId } from "../../src/evm-direct-networks.js";
import { armDirectEvmStep } from "../../src/evm-direct.js";
import { directEvmStepBudget } from "../../src/evm-direct-reads.js";
import { EvmRpc } from "../../src/evm-rpc.js";
import type { Address, Economics, Hex, OperationRecord } from "../../src/model.js";
import type { RpcPort, RpcReceipt } from "../../src/ports.js";
import { EVM_BLOCK_HASH } from "./evm-helpers.js";
import { RECIPIENT, WALLET } from "./helpers.js";

interface Options { chain?: number; code?: string; decimals?: bigint | "missing"; baseFee?: bigint; tip?: bigint; balance?: bigint; failPhase?: number }
const word = (value: bigint) => toHex(value, { size: 32 });
const economics = (fees: { gasLimitAtomic: string; maxFeePerGasAtomic: string; maxPriorityFeePerGasAtomic: string }): Economics =>
  ({ nonceAtomic: "7", ...fees, maximumGasCostAtomic: (BigInt(fees.gasLimitAtomic) * BigInt(fees.maxFeePerGasAtomic)).toString() });

function answer(chainId: number, options: Options) {
  return (method: string, params: readonly unknown[]): unknown => {
    if (method === "eth_chainId") return toHex(options.chain ?? chainId);
    if (method === "eth_getBlockByNumber") return { number: "0x3039", hash: EVM_BLOCK_HASH, baseFeePerGas: toHex(options.baseFee ?? 7n) };
    if (method === "eth_getBalance") { assert.equal(params[1], "latest"); return toHex(10n ** 18n); }
    if (method === "eth_getCode") return options.code ?? "0x6000";
    if (method === "eth_call") {
      const call = params[0] as { to: string; data: string };
      if (call.to === "0x420000000000000000000000000000000000000F") { assert.equal(params[1], "0x3039"); return word(1000n); }
      assert.equal(params[1], "latest");
      if (call.data === "0x313ce567") return options.decimals === "missing" ? "0x" : word(options.decimals ?? 6n);
      return word(options.balance ?? 10n ** 9n);
    }
    if (method === "eth_getTransactionCount") return "0x7";
    if (method === "eth_estimateGas") return "0xfde8";
    if (method === "eth_maxPriorityFeePerGas") return toHex(options.tip ?? 9n);
    throw new Error(`unexpected ${method}`);
  };
}

function reader(chainId: number, options: Options = {}) {
  const posts: string[][] = []; let scalar = 0;
  const reply = answer(chainId, options);
  const rpc = new EvmRpc(async () => { scalar += 1; throw new Error("no scalar fallback"); }, "https://rpc.example", undefined, async calls => {
    posts.push(calls.map(({ method }) => method));
    if (options.failPhase === posts.length) throw new ApnError("APN_RPC_RATE_LIMITED", "synthetic cooldown", { httpStatus: 429 });
    return calls.map(({ method, params }) => reply(method, params));
  });
  return { rpc, posts, scalar: () => scalar };
}

function listedToken(chainId: DirectEvmChainId): { readonly token: Address; readonly decimals: number } | undefined {
  const row = directEvmListRows(chainId).find(entry => entry.kind === "token" && entry.identifier !== null);
  return row === undefined ? undefined : { token: row.identifier as Address, decimals: row.decimals };
}

test("every direct network reads balances in one POST, nonce and estimate in one, and OP-stack oracle fees in one more", async () => {
  for (const network of DIRECT_EVM_NETWORKS) {
    const listed = listedToken(network.chainId);
    for (const asset of ["native", ...(listed === undefined ? [] : [listed])] as const) {
      const token = asset === "native" ? "native" as const : asset.token, decimals = asset === "native" ? 18 : asset.decimals;
      const { rpc, posts, scalar } = reader(network.chainId, { decimals: BigInt(decimals) });
      const reads = rpc.directReads(network.chainId);
      const balance = await reads.balance(WALLET, { chainId: network.chainId, token, decimals });
      assert.equal(balance.asset.decimals, decimals); assert.equal(balance.blockHash, EVM_BLOCK_HASH);
      const transaction = { chainId: network.chainId, from: WALLET, to: token === "native" ? RECIPIENT : token, valueAtomic: token === "native" ? "1" : "0", data: "0x" as Hex };
      const { nonce, estimated } = await reads.nonceEstimate(WALLET, transaction);
      const quote = await reads.feeQuote(economics(estimated));
      const opStack = network.feeModel === "op-stack", inclusive = network.feeModel === "arbitrum-inclusive";
      assert.equal(posts.length, opStack ? 3 : 2, `${network.name} ${token}`);
      assert.equal(posts[0]![0], "eth_chainId");
      assert.equal(posts.flat().filter(method => method === "eth_chainId").length, 1);
      assert.deepEqual(posts[0]!.slice(1), token === "native" ? ["eth_getBlockByNumber", "eth_getBalance"] :
        ["eth_getBlockByNumber", "eth_getBalance", "eth_getCode", "eth_call", "eth_call"]);
      assert.equal(posts[1]!.includes("eth_maxPriorityFeePerGas"), !inclusive);
      assert.equal(nonce, "7"); assert.equal(estimated.maxPriorityFeePerGasAtomic, inclusive ? "0" : "9");
      assert.equal(quote.l1DataFeeUpperWei, opStack ? "1000" : "0");
      assert.equal(quote.feeModel, inclusive ? "arbitrum-inclusive" : network.feeModel === "monad-gas-limit" ? "monad-gas-limit" : undefined);
      assert.equal(scalar(), 0);
      await rpc.directReads(network.chainId).balance(WALLET, { chainId: network.chainId, token, decimals });
      assert.equal(posts.at(-1)![0], "eth_getBlockByNumber", "a second step on the same endpoint does not re-ask its chain");
    }
  }
});

test("the reader refuses bad identity, metadata and transport after the failing POST, with no scalar fallback", async () => {
  const selection = { chainId: 1 as const, token: "0xA0b86991c6218b36c1D19D4a2e9Eb0cE3606eB48" as Address, decimals: 6 };
  for (const [options, code] of [
    [{ chain: 8453 }, "APN_CHAIN_MISMATCH"], [{ code: "0x" }, "APN_ASSET_MISMATCH"], [{ decimals: 18n }, "APN_ASSET_MISMATCH"],
    [{ decimals: "missing" }, "APN_ASSET_MISMATCH"], [{ failPhase: 1 }, "APN_RPC_RATE_LIMITED"],
  ] as const) {
    const { rpc, posts, scalar } = reader(1, options);
    await assert.rejects(rpc.directReads(1).balance(WALLET, selection), { code });
    assert.equal(posts.length, 1); assert.equal(scalar(), 0);
  }
  const limited = reader(1, { failPhase: 2 });
  await limited.rpc.directReads(1).balance(WALLET, selection).catch(() => undefined);
  const reads = limited.rpc.directReads(1);
  await assert.rejects(reads.nonceEstimate(WALLET, { chainId: 1, from: WALLET, to: RECIPIENT, valueAtomic: "1", data: "0x" }),
    { code: "APN_RPC_RATE_LIMITED", details: { phase: "nonce_estimate", httpStatus: 429 } });
  await assert.rejects(reads.feeQuote(economics({ gasLimitAtomic: "21000", maxFeePerGasAtomic: "1", maxPriorityFeePerGasAtomic: "1" })),
    { code: "APN_RPC_PROTOCOL" }, "a quote needs this step's own fee head");
  await assert.rejects(reader(1).rpc.directReads(1).balance(WALLET, { ...selection, chainId: 8453 }), { code: "APN_INVALID_INPUT" });
  const bnb = { chainId: 56 as const, from: WALLET, to: RECIPIENT, valueAtomic: "1", data: "0x" as Hex };
  assert.equal((await reader(56, { baseFee: 0n }).rpc.directReads(56).nonceEstimate(WALLET, bnb)).estimated.maxFeePerGasAtomic, "9");
  await assert.rejects(reader(56, { baseFee: 0n, tip: 0n }).rpc.directReads(56).nonceEstimate(WALLET, bnb), { code: "APN_RPC_PROTOCOL" });
  await assert.rejects(reader(8453).rpc.directReads(1).balance(WALLET, selection), { code: "APN_CHAIN_MISMATCH" });
});

test("a proven endpoint answers a different expected chain with a mismatch and no POST", async () => {
  const { rpc, posts } = reader(1);
  await rpc.directReads(1).balance(WALLET, { chainId: 1, token: "native" });
  await rpc.assertChain(1);
  await assert.rejects(rpc.directReads(8453).balance(WALLET, { chainId: 8453, token: "native" }), { code: "APN_CHAIN_MISMATCH" });
  await assert.rejects(rpc.assertChain(8453), { code: "APN_CHAIN_MISMATCH" });
  assert.equal(posts.length, 1);
});

test("receipt and evidence are one POST each; a safe-finality network reads its safe head inside the evidence POST", async () => {
  const hash = `0x${"d".repeat(64)}` as Hex, posts: string[][] = [];
  let safe = "0x3039";
  const transaction = { hash, blockHash: EVM_BLOCK_HASH, blockNumber: "0x303a", chainId: "0xa4b1", type: "0x2", from: WALLET, to: RECIPIENT,
    value: "0x1", input: "0x", nonce: "0x7", gas: "0x5208", maxFeePerGas: "0x2", maxPriorityFeePerGas: "0x0", accessList: [] };
  const rpc = new EvmRpc(async () => { throw new Error("no scalar fallback"); }, "https://rpc.example", undefined, async calls => {
    posts.push(calls.map(({ method }) => method));
    return calls.map(({ method, params }) => method === "eth_chainId" ? "0xa4b1" : method === "eth_getTransactionReceipt"
      ? { transactionHash: hash, status: "0x1", blockNumber: "0x303a", blockHash: EVM_BLOCK_HASH, logs: [] }
      : method === "eth_getTransactionByHash" ? transaction
      : { number: params[0] === "safe" ? safe : params[0], hash: params[0] === "safe" && safe !== "0x303a" ? `0x${"a".repeat(64)}` : EVM_BLOCK_HASH });
  });
  const receipt = await rpc.receipt(42161, hash) as RpcReceipt;
  const operation = { chainId: 42161, walletAddress: WALLET, transactionHash: hash, transactionData: "0x",
    economics: { nonceAtomic: "7", gasLimitAtomic: "21000", maxFeePerGasAtomic: "2", maxPriorityFeePerGasAtomic: "0", maximumGasCostAtomic: "42000" },
    evm: { transactionTo: RECIPIENT, valueAtomic: "1" } } as unknown as OperationRecord;
  await assert.rejects(rpc.evidence(operation, receipt), { code: "APN_RPC_PROTOCOL", details: { reason: "evm_safe_head_lag" } });
  safe = "0x303a";
  const evidence = await rpc.evidence(operation, receipt);
  assert.equal(evidence.transactionVerified, true); assert.equal(evidence.safeBlockNumberAtomic, "12346");
  assert.deepEqual(posts, [["eth_chainId", "eth_getTransactionReceipt"],
    ["eth_getBlockByNumber", "eth_getTransactionByHash", "eth_getBlockByNumber"],
    ["eth_getBlockByNumber", "eth_getTransactionByHash", "eth_getBlockByNumber"]]);
});

test("each step's POST cap is derived from its read plan and armed for every listed network", () => {
  assert.deepEqual(DIRECT_EVM_NETWORKS.map(network => [network.chainId, directEvmStepBudget(network.chainId, "prepare"),
    directEvmStepBudget(network.chainId, "approve"), directEvmStepBudget(network.chainId, "resume")]),
  DIRECT_EVM_NETWORKS.map(network => network.feeModel === "op-stack" ? [network.chainId, 6, 12, 12] : [network.chainId, 4, 10, 12]));
  assert.equal(directEvmStepBudget(1329, "balance"), 2);
  const armed: (number | undefined)[] = [];
  for (const network of DIRECT_EVM_NETWORKS) armDirectEvmStep({ armEvmDirectRpcGuard: (cap?: number) => armed.push(cap) } as unknown as RpcPort, network.chainId, "approve");
  assert.equal(armed.length, DIRECT_EVM_NETWORKS.length); assert.ok(armed.every(cap => cap === 10 || cap === 12));
});
