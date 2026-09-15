import { encodeAbiParameters } from "viem";
import { HttpsBaseRpc, parseRpcLogEnvelope, parseRpcResultEnvelope } from "../../src/rpc.js";
import { tokenDomainSeparator } from "../../src/x402-policy.js";
import { x402Network } from "../../src/x402-network.js";
import assert from "node:assert/strict";
import test from "node:test";
import { decodeFunctionData, toHex } from "viem";
import { EvmRpc } from "../../src/evm-rpc.js";
import type { EvmRpcCall } from "../../src/evm-ports.js";
import type { Address, Hex } from "../../src/model.js";
import { EVM_BLOCK_HASH, EVM_REQUEST, EVM_TOKEN, evmCore } from "./evm-helpers.js";
import { RECIPIENT, WALLET, temporaryState } from "./helpers.js";

const BLOCK = { number: "0x3039", hash: EVM_BLOCK_HASH, baseFeePerGas: "0x1", parentHash: `0x${"a".repeat(64)}` };
const HASH = `0x${"d".repeat(64)}` as Hex;
const ECONOMICS = { nonceAtomic: "7", gasLimitAtomic: "65000", maxFeePerGasAtomic: "3", maxPriorityFeePerGasAtomic: "1", maximumGasCostAtomic: "195000" };

test("production RPC envelope parser rejects duplicate, conflicting and extra JSON-RPC members", () => {
  assert.deepEqual(parseRpcResultEnvelope('{"jsonrpc":"2.0","id":"1","result":[]}', "1"), []);
  assert.deepEqual(parseRpcLogEnvelope('{"jsonrpc":"2.0","id":"1","result":[]}', "1"), { kind: "complete", value: [] });
  for (const raw of [
    '{"jsonrpc":"2.0","id":"1","result":[],"result":[]}',
    '{"jsonrpc":"2.0","id":"1","id":"1","result":[]}',
    '{"jsonrpc":"2.0","id":"1","result":[],"error":{"message":"pruned"}}',
    '{"jsonrpc":"2.0","id":"1","result":[],"extra":true}',
  ]) assert.throws(() => parseRpcResultEnvelope(raw, "1"), { code: "APN_RPC_PROTOCOL" });
  for (const raw of [
    '{"jsonrpc":"2.0","id":"1","error":{"message":"pruned"},"error":{"message":"pruned"}}',
    '{"jsonrpc":"2.0","id":"1","id":"1","error":{"message":"pruned"}}',
    '{"jsonrpc":"2.0","id":"1","error":{"message":"pruned"},"extra":true}',
  ]) assert.throws(() => parseRpcLogEnvelope(raw, "1"), { code: "APN_RPC_PROTOCOL" });
});

class Wire {
  chain = "0x2105";
  decimals: unknown = toHex(8n, { size: 32 });
  code: unknown = "0x6080";
  blockChanged = false;
  blocks = 0;
  readonly calls: { method: string; params: readonly unknown[] }[] = [];
  receipt: Record<string, unknown> = { transactionHash: HASH, status: "0x1", blockNumber: BLOCK.number, blockHash: BLOCK.hash, logs: [] };
  call: EvmRpcCall = async (method, params) => {
    this.calls.push({ method, params });
    if (method === "eth_chainId") return this.chain;
    if (method === "eth_getBlockByNumber") {
      this.blocks += 1;
      return { ...BLOCK, hash: this.blockChanged && this.blocks > 1 ? HASH : BLOCK.hash };
    }
    if (method === "eth_getBalance") return "0xde0b6b3a7640000";
    if (method === "eth_getCode") return this.code;
    if (method === "eth_estimateGas") return "0xfde8";
    if (method === "eth_maxPriorityFeePerGas") return "0x1";
    if (method === "eth_getTransactionCount") return "0x7";
    if (method === "eth_getTransactionReceipt") return this.receipt;
    if (method === "eth_call") {
      const input = params[0] as { to: Address; data: Hex };
      if (input.data === "0x313ce567") {
        if (this.decimals instanceof Error) throw this.decimals;
        return this.decimals;
      }
      if (input.data.startsWith("0x70a08231")) return toHex(250000000n, { size: 32 });
      const decoded = decodeFunctionData({ abi: [
        { type: "function", name: "getL1FeeUpperBound", inputs: [{ name: "size", type: "uint256" }], outputs: [{ type: "uint256" }] },
        { type: "function", name: "getOperatorFee", inputs: [{ name: "gas", type: "uint256" }], outputs: [{ type: "uint256" }] },
      ], data: input.data });
      assert.equal(input.to, "0x420000000000000000000000000000000000000F");
      assert.equal(decoded.args?.[0], decoded.functionName === "getL1FeeUpperBound" ? 512n : 65000n);
      return toHex(decoded.functionName === "getL1FeeUpperBound" ? 1000n : 100n, { size: 32 });
    }
    throw new Error(`unexpected ${method}`);
  };
}

test("EVM RPC pins exact asset metadata and balances and includes Base L1/operator fees", async () => {
  const wire = new Wire(), rpc = new EvmRpc(wire.call, "https://rpc.example");
  const balance = await rpc.balance(WALLET, { chainId: 8453, token: EVM_TOKEN });
  assert.equal(balance.asset.decimals, 8); assert.equal(balance.assetAtomic, "250000000");
  assert.ok(wire.calls.filter(({ method }) => ["eth_call", "eth_getBalance", "eth_getCode"].includes(method)).every(({ params }) => params[1] === BLOCK.number));
  const quote = await rpc.feeQuote(8453, ECONOMICS);
  assert.equal(quote.totalQuoteWei, "196100"); assert.equal(quote.totalFeeEnforcedOnchain, false);
  const fees = await rpc.estimate({ chainId: 8453, from: WALLET, to: RECIPIENT, valueAtomic: "123", data: "0x" });
  assert.equal(fees.maxFeePerGasAtomic, "3");
  assert.equal((wire.calls.find(({ method }) => method === "eth_estimateGas")!.params[0] as { value: string }).value, "0x7b");
});

test("EVM RPC refuses wrong chain, absent contract, malformed decimals and reorgs; explicit missing-metadata fallback is labelled", async () => {
  const selection = { chainId: 8453 as const, token: EVM_TOKEN };
  const wire = new Wire(), rpc = new EvmRpc(wire.call, "https://rpc.example");
  wire.chain = "0x1";
  await assert.rejects(rpc.balance(WALLET, selection), { code: "APN_CHAIN_MISMATCH" });
  wire.chain = "0x2105"; wire.code = "0x";
  await assert.rejects(rpc.balance(WALLET, selection), { code: "APN_ASSET_MISMATCH" });
  wire.code = "0x6000"; wire.decimals = "0x08";
  await assert.rejects(rpc.balance(WALLET, selection), { code: "APN_RPC_PROTOCOL" });
  wire.decimals = new Error("optional method absent");
  await assert.rejects(rpc.balance(WALLET, selection), { code: "APN_ASSET_METADATA_REQUIRED" });
  assert.equal((await rpc.balance(WALLET, { ...selection, decimals: 8 })).asset.decimalsSource, "caller");
  wire.decimals = toHex(8, { size: 32 });
  await assert.rejects(rpc.balance(WALLET, { ...selection, decimals: 6 }), { code: "APN_ASSET_MISMATCH" });
  wire.blockChanged = true; wire.blocks = 0;
  await assert.rejects(rpc.balance(WALLET, selection), { code: "APN_RPC_PROTOCOL" });
});

test("receipt codec rejects log substitution, removed logs, malformed status and chain switches", async () => {
  const wire = new Wire(), rpc = new EvmRpc(wire.call, "https://rpc.example");
  const log = { transactionHash: HASH, blockHash: BLOCK.hash, blockNumber: BLOCK.number, removed: false, address: EVM_TOKEN, data: toHex(1, { size: 32 }), topics: [] };
  wire.receipt.logs = [log];
  assert.equal((await rpc.receipt(8453, HASH))?.status, "success");
  for (const change of [{ removed: true }, { transactionHash: BLOCK.hash }, { blockHash: HASH }, { blockNumber: "0x1" }, { topics: Array(5).fill(HASH) }]) {
    wire.receipt.logs = [{ ...log, ...change }];
    await assert.rejects(rpc.receipt(8453, HASH), { code: "APN_RPC_PROTOCOL" });
  }
  wire.receipt.logs = []; wire.receipt.status = "0x2";
  await assert.rejects(rpc.receipt(8453, HASH), { code: "APN_RPC_PROTOCOL" });
  wire.receipt.status = "0x1";
  const switched = new EvmRpc(async (method, params) => {
    const result = await wire.call(method, params);
    if (method === "eth_getTransactionReceipt") wire.chain = "0x1";
    return result;
  }, "https://rpc.example");
  await assert.rejects(switched.receipt(8453, HASH), { code: "APN_CHAIN_MISMATCH" });
});

for (const chainId of [8453, 1, 42161] as const) test(`chain ${chainId} on-chain evidence verifies signed fields and exact pinned token deltas; logs or receipt status alone cannot prove delivery`, async (context) => {
  const temporary = await temporaryState(); context.after(temporary.cleanup);
  const setup = evmCore(temporary.root); setup.rpc.chainId = chainId;
  if (chainId !== 8453) { setup.rpc.l1Fee = 0n; setup.rpc.operatorFee = 0n; }
  const wallet = await setup.core.wallet.ensure("default") as { address: Address }; setup.rpc.sender = wallet.address;
  const prepared = await setup.core.transfer.prepare({ ...EVM_REQUEST, asset: { chainId, token: EVM_TOKEN }, amount: "1" }) as { operation_id: string };
  await setup.core.transfer.approve(prepared.operation_id);
  const operation = (await setup.state.findOperation(prepared.operation_id))!;
  const receipt = (await setup.rpc.evm.receipt(chainId, operation.transactionHash!))!;
  let recipientReceived = 100000000n, transactionValue = "0x0", wrongParent = false, balanceCalls = 0;
  const call: EvmRpcCall = async (method, params) => {
    if (method === "eth_chainId") return toHex(chainId);
    if (method === "eth_getBlockByNumber") return { ...BLOCK, number: params[0] === "safe" ? "0x303a" : params[0], hash: params[0] === "0x303a" || params[0] === "safe" ? EVM_BLOCK_HASH : HASH, parentHash: wrongParent ? EVM_BLOCK_HASH : HASH };
    if (method === "eth_getTransactionByHash") return { hash: operation.transactionHash, blockHash: EVM_BLOCK_HASH, blockNumber: "0x303a", chainId: toHex(chainId), type: "0x2", from: operation.walletAddress, to: EVM_TOKEN, value: transactionValue, input: operation.transactionData, nonce: "0x7", gas: toHex(BigInt(operation.economics!.gasLimitAtomic)), maxFeePerGas: toHex(BigInt(operation.economics!.maxFeePerGasAtomic)), maxPriorityFeePerGas: toHex(BigInt(operation.economics!.maxPriorityFeePerGasAtomic)), accessList: [] };
    if (method === "eth_call") {
      balanceCalls += 1;
      const input = params[0] as { data: string };
      const sender = input.data.toLowerCase().endsWith(wallet.address.slice(2).toLowerCase());
      return toHex(sender ? params[1] === "0x3039" ? 200000000n : 100000000n : params[1] === "0x3039" ? 0n : recipientReceived, { size: 32 });
    }
    throw new Error(`unexpected ${method}`);
  };
  const rpc = new EvmRpc(call, "https://rpc.example");
  assert.equal((await rpc.evidence(operation, receipt)).tokenBalanceDeltasVerified, true);
  recipientReceived = 99000000n;
  assert.equal((await rpc.evidence(operation, receipt)).tokenBalanceDeltasVerified, false);
  transactionValue = "0x1";
  assert.equal((await rpc.evidence(operation, receipt)).transactionVerified, false);
  transactionValue = "0x0"; wrongParent = true;
  await assert.rejects(rpc.evidence(operation, receipt), { code: "APN_RPC_PROTOCOL" });
  wrongParent = false; const before = balanceCalls;
  assert.equal((await rpc.evidence(operation, { ...receipt, status: "reverted" })).transactionVerified, true);
  assert.equal(balanceCalls, before);
});

test("Ethereum fees are execution-only without Base oracle calls, while chain mismatch still fails closed", async () => {
  const wire = new Wire(); wire.chain = "0x1";
  const rpc = new EvmRpc(wire.call, "https://rpc.example");
  const quote = await rpc.feeQuote(1, ECONOMICS);
  assert.equal(quote.l1DataFeeUpperWei, "0"); assert.equal(quote.operatorFeeUpperWei, "0");
  assert.equal(quote.totalQuoteWei, ECONOMICS.maximumGasCostAtomic);
  assert.equal(wire.calls.filter(({ method }) => method === "eth_call").length, 0);
  const balance = await rpc.balance(WALLET, { chainId: 1, token: EVM_TOKEN });
  assert.equal(balance.asset.chainId, 1); assert.equal(balance.asset.decimals, 8);
  wire.chain = "0x2105";
  await assert.rejects(rpc.feeQuote(1, ECONOMICS), { code: "APN_CHAIN_MISMATCH" });
});

for (const chainId of [1, 42161] as const) test(`production x402 RPC binds chain ${chainId} token, chain, log filters and bounded copies without weakening Base assertions`, async () => {
  const base = new HttpsBaseRpc("https://rpc.example");
  const ethereum = base.forX402Network(chainId); assert.notEqual(base, ethereum);
  let chain = toHex(chainId);
  const calls: Array<{ method: string; params: readonly unknown[] }> = [];
  const call = async (method: string, params: readonly unknown[]): Promise<unknown> => {
    calls.push({ method, params });
    if (method === "eth_chainId") return chain;
    if (method === "eth_getBlockByNumber") return { number: "0x3039", hash: EVM_BLOCK_HASH, timestamp: "0x6a91d200" };
    if (method === "eth_getLogs") return [];
    if (method === "eth_call") {
      const input = params[0] as { to: string; data: string };
      assert.equal(input.to, x402Network(chainId).token); assert.equal(params[1], "0x3039");
      if (input.data.startsWith("0x70a08231")) return toHex(50000000n, { size: 32 });
      if (input.data === "0x06fdde03") return encodeAbiParameters([{ type: "string" }], ["USD Coin"]);
      if (input.data === "0x54fd4d50") return encodeAbiParameters([{ type: "string" }], ["2"]);
      if (input.data === "0x3644e515") return tokenDomainSeparator("USD Coin", "2", chainId);
      if (input.data.startsWith("0xe94a0102")) return toHex(0n, { size: 32 });
    }
    throw new Error(`unexpected synthetic read ${method}`);
  };
  const wire = (rpc: unknown) => {
    (rpc as { call: typeof call }).call = call;
    (rpc as { callX402Logs: (params: readonly unknown[]) => Promise<unknown> }).callX402Logs = async (params) => ({ kind: "complete", value: await call("eth_getLogs", params) });
  };
  wire(ethereum); wire(base);
  assert.equal((await ethereum.assertX402Chain(chainId)).chainId, chainId);
  await assert.rejects(ethereum.assertBaseChain(), { code: "APN_CHAIN_MISMATCH" });
  await assert.rejects(ethereum.assertX402Chain(8453), { code: "APN_CHAIN_MISMATCH" });
  assert.equal((await ethereum.getX402PrepareEvidence(WALLET)).domainSeparator, tokenDomainSeparator("USD Coin", "2", chainId));
  await ethereum.getX402AuthorizationState(WALLET, HASH, { tag: "safe" });
  await ethereum.getX402AuthorizationUsedLogs({ authorizer: WALLET, nonce: HASH, fromBlock: "12345", toBlock: "12345" });
  const filter = calls.find(({ method }) => method === "eth_getLogs")!.params[0] as { address: string };
  assert.equal(filter.address, x402Network(chainId).token);
  const bounded = ethereum.withTotalTimeout(20000); wire(bounded);
  assert.equal((await bounded.assertX402Chain!(chainId)).chainId, chainId);
  chain = "0x2105";
  await assert.rejects(bounded.assertX402Chain!(chainId), { code: "APN_CHAIN_MISMATCH" });
  assert.equal((await base.assertBaseChain()).chainId, 8453);
  assert.equal(calls.some(({ method }) => method.startsWith("eth_send")), false);
});

test("Arbitrum gas quote includes all estimated gas once, with no Base oracle or priority fee request", async () => {
  const wire = new Wire(); wire.chain = "0xa4b1";
  const rpc = new EvmRpc(wire.call, "https://rpc.example");
  const fees = await rpc.estimate({ chainId: 42161, from: WALLET, to: RECIPIENT, valueAtomic: "123", data: "0x" });
  assert.equal(fees.gasLimitAtomic, "65000");
  assert.equal(fees.maxFeePerGasAtomic, "2"); assert.equal(fees.maxPriorityFeePerGasAtomic, "0");
  const economics = { ...ECONOMICS, ...fees, maximumGasCostAtomic: "130000" };
  const quote = await rpc.feeQuote(42161, economics);
  assert.equal(quote.feeModel, "arbitrum-inclusive"); assert.equal(quote.totalQuoteWei, "130000");
  assert.equal(quote.maximumExecutionFeeWei, "130000"); assert.equal(quote.l1DataFeeUpperWei, "0"); assert.equal(quote.operatorFeeUpperWei, "0");
  assert.equal(wire.calls.some(({ method }) => method === "eth_call" || method === "eth_maxPriorityFeePerGas"), false);
  const { validateEvmFeeQuote } = await import("../../src/evm-direct.js");
  assert.equal(validateEvmFeeQuote(quote, economics), quote);
  for (const override of [{ feeModel: undefined }, { feeModel: "ethereum" }, { chainId: 1 }, { l1DataFeeUpperWei: "1", totalQuoteWei: "130001" }]) {
    assert.throws(() => validateEvmFeeQuote({ ...quote, ...override }, economics), { code: "APN_STATE_CORRUPT" });
  }
  wire.chain = "0x1";
  await assert.rejects(rpc.feeQuote(42161, economics), { code: "APN_CHAIN_MISMATCH" });
});

test("Arbitrum receipt and supersession evidence refuse latest-only or reorged safe heads", async (context) => {
  const temporary = await temporaryState(); context.after(temporary.cleanup);
  const setup = evmCore(temporary.root); setup.rpc.chainId = 42161; setup.rpc.l1Fee = 0n; setup.rpc.operatorFee = 0n;
  await setup.core.wallet.ensure("default");
  const prepared = await setup.core.transfer.prepare({ ...EVM_REQUEST, asset: { chainId: 42161, token: "native" } }) as { operation_id: string };
  await setup.core.transfer.approve(prepared.operation_id);
  const operation = (await setup.state.findOperation(prepared.operation_id))!;
  const receipt = (await setup.rpc.evm.receipt(42161, operation.transactionHash!))!;
  let safeNumber = "0x3039", safeReads = 0, reorg = false;
  const transaction = { hash: operation.transactionHash, blockHash: EVM_BLOCK_HASH, blockNumber: "0x303a", chainId: "0xa4b1", type: "0x2",
    from: operation.walletAddress, to: operation.evm!.transactionTo, value: toHex(BigInt(operation.evm!.valueAtomic)), input: "0x",
    nonce: toHex(BigInt(operation.economics!.nonceAtomic)), gas: toHex(BigInt(operation.economics!.gasLimitAtomic)),
    maxFeePerGas: toHex(BigInt(operation.economics!.maxFeePerGasAtomic)), maxPriorityFeePerGas: toHex(BigInt(operation.economics!.maxPriorityFeePerGasAtomic)), accessList: [] };
  const tags: string[] = [];
  const rpc = new EvmRpc(async (method, params) => {
    if (method === "eth_chainId") return "0xa4b1";
    if (method === "eth_getTransactionByHash") return transaction;
    if (method === "eth_getBlockByNumber") {
      tags.push(String(params[0]));
      if (params[0] === "safe") safeReads += 1;
      const number = params[0] === "safe" ? safeNumber : String(params[0]);
      return { ...BLOCK, number, hash: reorg && safeReads > 1 ? HASH : number === "0x303a" ? EVM_BLOCK_HASH : HASH, transactions: number === "0x303a" ? [transaction] : [] };
    }
    throw new Error(`unexpected ${method}`);
  }, "https://rpc.example");
  await assert.rejects(rpc.evidence(operation, receipt), { code: "APN_RPC_PROTOCOL" });
  assert.equal(await rpc.confirmedAtNonce(42161, operation.walletAddress, operation.economics!.nonceAtomic, "12346"), null);
  safeNumber = "0x303a"; safeReads = 0;
  const evidence = await rpc.evidence(operation, receipt);
  assert.equal(evidence.safeBlockNumberAtomic, "12346"); assert.equal(evidence.safeBlockHash, EVM_BLOCK_HASH);
  assert.equal(await rpc.confirmedAtNonce(42161, operation.walletAddress, operation.economics!.nonceAtomic, "12346"), operation.transactionHash);
  assert.equal(tags.includes("latest"), false);
  reorg = true; safeReads = 0;
  await assert.rejects(rpc.evidence(operation, receipt), { code: "APN_RPC_PROTOCOL" });
});
