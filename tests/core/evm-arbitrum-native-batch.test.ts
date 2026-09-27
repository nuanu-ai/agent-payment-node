import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import https from "node:https";
import { syncBuiltinESMExports } from "node:module";
import test from "node:test";
import { toHex } from "viem";
import { ApnError } from "../../src/errors.js";
import { EvmRpc } from "../../src/evm-rpc.js";
import { checkEvmTransferFunding } from "../../src/evm-transfer-approval.js";
import { HttpsBaseRpc } from "../../src/rpc.js";
import { EVM_BLOCK_HASH, EVM_REQUEST, ensureDirectWallet, evmCore } from "./evm-helpers.js";
import { RECIPIENT, WALLET, temporaryState } from "./helpers.js";

const selection = { chainId: 42161 as const, token: "native" as const, decimals: 18 };
const transaction = { chainId: 42161 as const, from: WALLET, to: RECIPIENT, valueAtomic: "1000000000000", data: "0x" as const };
const methods = [
  ["eth_chainId", "eth_getBlockByNumber"], ["eth_getBalance"], ["eth_getBlockByNumber", "eth_chainId"],
  ["eth_chainId", "eth_getTransactionCount", "eth_estimateGas", "eth_getBlockByNumber"],
  ["eth_getBlockByNumber", "eth_chainId"],
];

function wire(options: { chain?: number; reorg?: boolean; balance?: bigint; gas?: bigint; rejectAt?: number } = {}) {
  const posts: string[][] = [];
  let scalar = 0;
  const rpc = new EvmRpc(async () => { scalar++; throw new Error("scalar fallback"); }, "https://rpc.example", undefined, async batch => {
    posts.push(batch.map(call => call.method));
    if (options.rejectAt === posts.length) throw new ApnError("APN_RPC_RATE_LIMITED", "429", { httpStatus: 429 });
    return batch.map(({ method, params }) => {
      if (method === "eth_chainId") return toHex(options.chain ?? 42161);
      if (method === "eth_getBlockByNumber") return { number: "0x3039",
        hash: options.reorg && params[0] !== "latest" ? `0x${"11".repeat(32)}` : EVM_BLOCK_HASH,
        baseFeePerGas: "0x64", transactions: [] };
      if (method === "eth_getBalance") { assert.equal(params[1], "0x3039"); return toHex(options.balance ?? 10n ** 18n); }
      if (method === "eth_getTransactionCount") { assert.equal(params[1], "pending"); return "0x7"; }
      if (method === "eth_estimateGas") return toHex(options.gas ?? 21_000n);
      throw new Error(`unexpected ${method}`);
    });
  });
  return { rpc, posts, scalarCalls: () => scalar };
}

function economics(gas = "21000") {
  return { nonceAtomic: "7", gasLimitAtomic: gas, maxFeePerGasAtomic: "200", maxPriorityFeePerGasAtomic: "0",
    maximumGasCostAtomic: (BigInt(gas) * 200n).toString() };
}

test("Arbitrum native prepare makes exactly five grouped POSTs with inclusive fee quote", async () => {
  const { rpc, posts, scalarCalls } = wire(); const reads = rpc.prepareArbitrumNative();
  const balance = await reads.balance(WALLET, selection);
  const { nonce, estimated } = await reads.nonceEstimate(WALLET, transaction);
  const quote = await reads.feeQuote({ ...economics(estimated.gasLimitAtomic), ...estimated });
  assert.equal(balance.nativeAtomic, (10n ** 18n).toString()); assert.equal(nonce, "7");
  assert.deepEqual(estimated, { gasLimitAtomic: "21000", maxFeePerGasAtomic: "200", maxPriorityFeePerGasAtomic: "0" });
  assert.equal(quote.feeModel, "arbitrum-inclusive"); assert.equal(quote.l1DataFeeUpperWei, "0");
  assert.equal(quote.operatorFeeUpperWei, "0"); assert.equal(quote.totalQuoteWei, "4200000");
  assert.deepEqual(posts, methods); assert.equal(scalarCalls(), 0);
});

test("Arbitrum batch mismatch, reorg and 429 stop without scalar fallback", async () => {
  for (const [options, code] of [
    [{ chain: 1 }, "APN_CHAIN_MISMATCH"], [{ reorg: true }, "APN_RPC_PROTOCOL"],
    [{ rejectAt: 2 }, "APN_RPC_RATE_LIMITED"],
  ] as const) {
    const { rpc, posts, scalarCalls } = wire(options);
    await assert.rejects(rpc.prepareArbitrumNative().balance(WALLET, selection), { code });
    assert.ok(posts.length <= 3); assert.equal(scalarCalls(), 0);
  }
});

test("Arbitrum production HTTPS transport reverses response IDs and uses five POSTs for each funding phase", async t => {
  const temporary = await temporaryState(); t.after(temporary.cleanup);
  const setup = evmCore(temporary.root); setup.rpc.chainId = 42161; setup.rpc.l1Fee = 0n; setup.rpc.operatorFee = 0n;
  setup.rpc.fees = { ...setup.rpc.fees, maxPriorityFeePerGasAtomic: "0" };
  await ensureDirectWallet(setup);
  const prepared = await setup.core.transfer.prepare({ ...EVM_REQUEST, asset: { chainId: 42161, token: "native" } }) as { operation_id: string };
  const operation = await setup.state.findOperation(prepared.operation_id); assert.ok(operation);
  const bodies: { method: string; params: unknown[] }[][] = [];
  let gas = BigInt(operation.economics!.gasLimitAtomic);
  let chain = 42161, reorg = false, balance = 10n ** 18n, rejectAt = 0;
  t.mock.method(https, "request", (_endpoint: URL, _options: unknown, receive: (response: unknown) => void) => {
    const request = new EventEmitter() as any;
    request.setTimeout = () => request;
    request.end = (body: string) => {
      const batch = JSON.parse(body) as { id: number; method: string; params: unknown[] }[];
      assert.ok(Array.isArray(batch)); bodies.push(batch);
      const rejected = rejectAt === bodies.length;
      const answers = batch.map(item => {
        const { method, params } = item; let result: unknown;
        if (method === "eth_chainId") result = toHex(chain);
        else if (method === "eth_getBlockByNumber") result = { number: "0x3039",
          hash: reorg && params[0] !== "latest" ? `0x${"11".repeat(32)}` : EVM_BLOCK_HASH,
          baseFeePerGas: toHex(100n), transactions: [] };
        else if (method === "eth_getBalance") { assert.equal(params[1], "0x3039"); result = toHex(balance); }
        else if (method === "eth_getTransactionCount") result = toHex(BigInt(operation.economics!.nonceAtomic));
        else if (method === "eth_estimateGas") result = toHex(gas);
        else throw new Error(`unexpected ${method}`);
        return { jsonrpc: "2.0", id: item.id, result };
      }).reverse();
      queueMicrotask(() => {
        const response = new EventEmitter() as any; const raw = JSON.stringify(answers);
        response.statusCode = rejected ? 429 : 200; response.headers = { "content-length": String(Buffer.byteLength(raw)) };
        response.resume = () => { response.emit("end"); };
        receive(response); response.emit("data", Buffer.from(raw)); response.emit("end");
      });
      return request;
    };
    return request;
  });
  syncBuiltinESMExports(); t.after(() => { t.mock.restoreAll(); syncBuiltinESMExports(); });
  const rpc = new HttpsBaseRpc("https://8.8.8.8/arbitrum", { directGuardState: setup.state });
  const reads = rpc.evm.prepareArbitrumNative();
  await reads.balance(operation.walletAddress, selection);
  const { estimated } = await reads.nonceEstimate(operation.walletAddress, transaction);
  await reads.feeQuote({ ...economics(estimated.gasLimitAtomic), ...estimated });
  assert.equal(bodies.length, 5);
  await checkEvmTransferFunding(rpc, operation, true, setup.state.root);
  assert.equal(bodies.length, 10);
  await checkEvmTransferFunding(rpc, operation, false, setup.state.root);
  assert.equal(bodies.length, 15);
  for (let index = 0; index < 3; index++) assert.deepEqual(bodies.slice(index * 5, index * 5 + 5).map(batch => batch.map(x => x.method)), methods);
  gas = BigInt(operation.economics!.gasLimitAtomic) + 1n;
  await assert.rejects(checkEvmTransferFunding(rpc, operation, false, setup.state.root), { code: "APN_FEE_BUDGET_EXCEEDED" });
  assert.equal(bodies.length, 19, "fee increase stops before final fee quote");
  gas = BigInt(operation.economics!.gasLimitAtomic);
  balance = 0n;
  await assert.rejects(checkEvmTransferFunding(rpc, operation, false, setup.state.root), { code: "APN_INSUFFICIENT_ASSET" });
  assert.equal(bodies.length, 24);
  balance = 10n ** 18n; chain = 1;
  await assert.rejects(checkEvmTransferFunding(rpc, operation, false, setup.state.root), { code: "APN_CHAIN_MISMATCH" });
  assert.equal(bodies.length, 25);
  chain = 42161; reorg = true;
  await assert.rejects(checkEvmTransferFunding(rpc, operation, false, setup.state.root), { code: "APN_RPC_PROTOCOL" });
  assert.equal(bodies.length, 28);
  reorg = false; rejectAt = 29;
  await assert.rejects(checkEvmTransferFunding(rpc, operation, false, setup.state.root), { code: "APN_RPC_RATE_LIMITED" });
  assert.equal(bodies.length, 29, "429 stops without scalar fallback");
});
