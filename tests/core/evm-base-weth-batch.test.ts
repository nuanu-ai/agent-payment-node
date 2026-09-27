import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import https from "node:https";
import { syncBuiltinESMExports } from "node:module";
import test from "node:test";
import { decodeFunctionData, toHex } from "viem";
import { requireEvmFunding } from "../../src/evm-direct.js";
import { EvmRpc } from "../../src/evm-rpc.js";
import { checkEvmTransferFunding } from "../../src/evm-transfer-approval.js";
import { HttpsBaseRpc } from "../../src/rpc.js";
import { EVM_BLOCK_HASH, EVM_REQUEST, ensureDirectWallet, evmCore } from "./evm-helpers.js";
import { activateDirectPolicy, directAdmission, evmDirectAdmissions } from "./direct-allowlist-helpers.js";
import { RECIPIENT, WALLET, temporaryState } from "./helpers.js";

const token = "0x4200000000000000000000000000000000000006" as const;
const selection = { chainId: 8453 as const, token, decimals: 18 };
const transfer = { chainId: 8453 as const, from: WALLET, to: token, valueAtomic: "0",
  data: `0xa9059cbb${RECIPIENT.slice(2).padStart(64, "0")}${(100_000_000n).toString(16).padStart(64, "0")}` as const };
const economics = (fees: { gasLimitAtomic: string; maxFeePerGasAtomic: string; maxPriorityFeePerGasAtomic: string }) =>
  ({ nonceAtomic: "7", ...fees, maximumGasCostAtomic: (BigInt(fees.gasLimitAtomic) * BigInt(fees.maxFeePerGasAtomic)).toString() });

function answer(method: string, params: readonly unknown[], options: { chain?: string; code?: string; decimals?: bigint; l1?: bigint; operator?: bigint } = {}): unknown {
  if (method === "eth_chainId") return options.chain ?? "0x2105";
  if (method === "eth_getBlockByNumber") return { number: "0x317", hash: EVM_BLOCK_HASH, baseFeePerGas: toHex(500_000_000n), transactions: [] };
  if (method === "eth_getBalance") { assert.equal(params[1], "0x317"); return toHex(10n ** 18n); }
  if (method === "eth_getCode") { assert.equal(params[0], token); assert.equal(params[1], "0x317"); return options.code ?? "0x6000"; }
  if (method === "eth_call") {
    const call = params[0] as { to: string; data: string };
    assert.equal(params[1], "0x317");
    if (call.to.toLowerCase() === token.toLowerCase()) {
      if (call.data === "0x313ce567") return toHex(options.decimals ?? 18n, { size: 32 });
      assert.ok(call.data.startsWith("0x70a08231")); return toHex(1_000_000_000n, { size: 32 });
    }
    assert.equal(call.to.toLowerCase(), "0x420000000000000000000000000000000000000f");
    const fee = decodeFunctionData({ abi: [
      { type: "function", name: "getL1FeeUpperBound", inputs: [{ name: "size", type: "uint256" }], outputs: [{ type: "uint256" }] },
      { type: "function", name: "getOperatorFee", inputs: [{ name: "gas", type: "uint256" }], outputs: [{ type: "uint256" }] },
    ], data: call.data as `0x${string}` });
    return toHex(fee.functionName === "getOperatorFee" ? options.operator ?? 3n : options.l1 ?? 5n, { size: 32 });
  }
  if (method === "eth_getTransactionCount") return "0x7";
  if (method === "eth_estimateGas") return toHex(65_000n);
  if (method === "eth_maxPriorityFeePerGas") return toHex(1_000_000_000n);
  throw new Error(`Unexpected ${method}`);
}

test("Base WETH grouped RPC pins safe token reads, chain and OP fees within eight POSTs", async () => {
  const posts: string[][] = [];
  const rpc = new EvmRpc(async () => { throw new Error("scalar fallback"); }, "https://rpc.example", undefined,
    async calls => { posts.push(calls.map(call => call.method)); return calls.map(call => answer(call.method, call.params)); });
  const reads = rpc.prepareBaseWeth();
  const balance = await reads.balance(WALLET, selection);
  const { nonce, estimated } = await reads.nonceEstimate(WALLET, transfer);
  const quote = await reads.feeQuote(economics(estimated));
  assert.equal(posts.length, 8); assert.equal(nonce, "7");
  assert.equal(balance.assetAtomic, "1000000000"); assert.equal(balance.asset.address, token);
  assert.equal(balance.asset.decimalsSource, "onchain");
  assert.deepEqual(posts[1], ["eth_getBalance", "eth_getCode", "eth_call", "eth_call"]);
  assert.equal(quote.totalQuoteWei, (BigInt(quote.maximumExecutionFeeWei) + 8n).toString());
  assert.equal(quote.l1DataFeeUpperWei !== "0", true); assert.equal(quote.operatorFeeUpperWei !== "0", true);
  assert.throws(() => requireEvmFunding(balance, "100000000", quote, (BigInt(quote.totalQuoteWei) - 1n).toString()),
    { code: "APN_FEE_BUDGET_EXCEEDED" });
  await assert.rejects(rpc.prepareBaseWeth().balance(WALLET, { chainId: 8453, token: "0x4200000000000000000000000000000000000007", decimals: 18 }), { code: "APN_INVALID_INPUT" });
  await assert.rejects(rpc.prepareBaseWeth().balance(WALLET, { chainId: 1, token, decimals: 18 }), { code: "APN_INVALID_INPUT" });
  assert.equal(posts.length, 8);
  for (const options of [{ code: "0x" }, { decimals: 6n }, { chain: "0x1" }]) {
    const bad = new EvmRpc(async () => { throw new Error("scalar fallback"); }, "https://rpc.example", undefined,
      async calls => calls.map(call => answer(call.method, call.params, options)));
    await assert.rejects(bad.prepareBaseWeth().balance(WALLET, selection),
      { code: options.code ? "APN_ASSET_MISMATCH" : options.decimals ? "APN_ASSET_MISMATCH" : "APN_CHAIN_MISMATCH" });
  }
});

test("physical HTTPS batches fit Base WETH prepare, approval and send; receipt is observed in another invocation", async t => {
  const temporary = await temporaryState(); t.after(temporary.cleanup);
  const setup = evmCore(temporary.root); setup.rpc.chainId = 8453; setup.rpc.decimals = 18;
  const wallet = await ensureDirectWallet(setup);
  setup.rpc.assetAtomic = "1000000000";
  await activateDirectPolicy(temporary.root, "default", { accounts: { evm: wallet.address },
    admissions: [...evmDirectAdmissions(), directAdmission("eip155:8453", token, { maximumPerTransferAtomic: "1000000000", dailyLimitAtomic: "1000000000" })],
    now: setup.clock.now() });
  const prepared = await setup.core.transfer.prepare({ ...EVM_REQUEST, asset: selection, amount: "0.0000000001" }) as { operation_id: string };
  const operation = await setup.state.findOperation(prepared.operation_id); assert.ok(operation);
  const batches: string[][] = []; let posts = 0; let sends = 0;
  t.mock.method(https, "request", (_endpoint: URL, _options: unknown, receive: (response: unknown) => void) => {
    const request = new EventEmitter() as any; request.setTimeout = () => request;
    request.end = (body: string) => {
      posts += 1;
      const envelope = JSON.parse(body) as { id: number; method: string; params: unknown[] } | { id: number; method: string; params: unknown[] }[];
      if (Array.isArray(envelope)) batches.push(envelope.map(item => item.method));
      else if (envelope.method === "eth_sendRawTransaction") sends += 1;
      const raw = JSON.stringify(Array.isArray(envelope)
        ? envelope.map(item => ({ jsonrpc: "2.0", id: item.id, result: answer(item.method, item.params) })).reverse()
        : { jsonrpc: "2.0", id: envelope.id, result: envelope.method === "eth_chainId" ? "0x2105" :
          envelope.method === "eth_getTransactionReceipt" ? null : `0x${"3".repeat(64)}` });
      queueMicrotask(() => {
        const response = new EventEmitter() as any; response.statusCode = 200;
        response.headers = { "content-length": String(Buffer.byteLength(raw)) };
        response.resume = () => { response.emit("end"); }; receive(response);
        response.emit("data", Buffer.from(raw)); response.emit("end");
      });
      return request;
    };
    return request;
  });
  syncBuiltinESMExports(); t.after(() => { t.mock.restoreAll(); syncBuiltinESMExports(); });
  const rpc = new HttpsBaseRpc("https://8.8.8.8/base", { directGuardState: setup.state });
  rpc.armEvmDirectRpcGuard();
  const grouped = rpc.evm.prepareBaseWeth();
  await grouped.balance(wallet.address, selection);
  const { estimated } = await grouped.nonceEstimate(wallet.address, transfer);
  await grouped.feeQuote(economics(estimated));
  assert.equal(posts, 8, "prepare");
  await checkEvmTransferFunding(rpc, operation, true, setup.state.root);
  assert.equal(posts, 16, "approval before signature");
  await checkEvmTransferFunding(rpc, operation, false, setup.state.root);
  assert.equal(posts, 22, "approval before send");
  await rpc.submitRawTransaction("0x01");
  assert.equal(posts, 23); assert.equal(sends, 1);
  assert.equal(batches.slice(16).flat().some(method => method === "eth_getTransactionReceipt"), false);
  const observe = new HttpsBaseRpc("https://8.8.8.8/base", { directGuardState: setup.state });
  observe.armEvmDirectRpcGuard();
  const beforeObserve = posts;
  assert.equal(await observe.evm.receipt(8453, `0x${"3".repeat(64)}`), null);
  assert.equal(posts - beforeObserve, 2); assert.equal(sends, 1);
});

test("Base WETH successful approval persists pending, and observe-only recovery proves receipt without rebroadcast", async t => {
  const temporary = await temporaryState(); t.after(temporary.cleanup);
  const setup = evmCore(temporary.root); setup.rpc.chainId = 8453; setup.rpc.decimals = 18;
  const wallet = await ensureDirectWallet(setup); setup.rpc.sender = wallet.address;
  setup.rpc.assetAtomic = "1000000000";
  await activateDirectPolicy(temporary.root, "default", { accounts: { evm: wallet.address },
    admissions: [...evmDirectAdmissions(), directAdmission("eip155:8453", token, { maximumPerTransferAtomic: "1000000000", dailyLimitAtomic: "1000000000" })],
    now: setup.clock.now() });
  const prepared = await setup.core.transfer.prepare({ ...EVM_REQUEST, asset: selection, amount: "0.0000000001" }) as { operation_id: string };
  const approved = await setup.core.transfer.approve(prepared.operation_id) as { state: string };
  assert.equal(approved.state, "submitted_pending"); assert.equal(setup.rpc.broadcastCount, 1);
  const observed = await setup.core.transfer.resume(prepared.operation_id, undefined, true) as { state: string };
  assert.equal(observed.state, "completed"); assert.equal(setup.rpc.broadcastCount, 1);
});

test("full Base WETH exact ERC20 receipt evidence stays inside a fresh 24 POST observation budget", async t => {
  const temporary = await temporaryState(); t.after(temporary.cleanup);
  const setup = evmCore(temporary.root); setup.rpc.chainId = 8453; setup.rpc.decimals = 18;
  const wallet = await ensureDirectWallet(setup); setup.rpc.sender = wallet.address; setup.rpc.assetAtomic = "1000000000";
  await activateDirectPolicy(temporary.root, "default", { accounts: { evm: wallet.address },
    admissions: [...evmDirectAdmissions(), directAdmission("eip155:8453", token, { maximumPerTransferAtomic: "1000000000", dailyLimitAtomic: "1000000000" })],
    now: setup.clock.now() });
  const prepared = await setup.core.transfer.prepare({ ...EVM_REQUEST, asset: selection, amount: "0.0000000001" }) as { operation_id: string };
  await setup.core.transfer.approve(prepared.operation_id);
  const operation = await setup.state.findOperation(prepared.operation_id); assert.ok(operation?.transactionHash && operation.economics && operation.evm);
  const receipt = await setup.rpc.evm.receipt(8453, operation.transactionHash); assert.ok(receipt);
  const frozenEconomics = operation.economics;
  const priorHash = `0x${"a".repeat(64)}`;
  let posts = 0;
  t.mock.method(https, "request", (_endpoint: URL, _options: unknown, receive: (response: unknown) => void) => {
    const request = new EventEmitter() as any; request.setTimeout = () => request;
    request.end = (body: string) => {
      posts += 1;
      const envelope = JSON.parse(body) as { id: number; method: string; params: unknown[] };
      const { method, params } = envelope;
      let result: unknown;
      if (method === "eth_chainId") result = "0x2105";
      else if (method === "eth_getTransactionReceipt") result = { transactionHash: operation.transactionHash,
        status: "0x1", blockNumber: "0x303a", blockHash: EVM_BLOCK_HASH,
        logs: receipt.logs.map(log => ({ ...log, transactionHash: operation.transactionHash,
          blockNumber: "0x303a", blockHash: EVM_BLOCK_HASH, removed: false })) };
      else if (method === "eth_getBlockByNumber") result = params[0] === "0x3039"
        ? { number: "0x3039", hash: priorHash, parentHash: `0x${"9".repeat(64)}`, transactions: [] }
        : { number: "0x303a", hash: EVM_BLOCK_HASH, parentHash: priorHash, transactions: [] };
      else if (method === "eth_getTransactionByHash") result = { hash: operation.transactionHash, blockHash: EVM_BLOCK_HASH,
        blockNumber: "0x303a", chainId: "0x2105", type: "0x2", from: wallet.address, to: token, value: "0x0",
        input: operation.transactionData, nonce: toHex(BigInt(frozenEconomics.nonceAtomic)),
        gas: toHex(BigInt(frozenEconomics.gasLimitAtomic)), maxFeePerGas: toHex(BigInt(frozenEconomics.maxFeePerGasAtomic)),
        maxPriorityFeePerGas: toHex(BigInt(frozenEconomics.maxPriorityFeePerGasAtomic)), accessList: [] };
      else if (method === "eth_call") {
        const call = params[0] as { to: string; data: string };
        assert.equal(call.to, token);
        const sender = call.data.toLowerCase().endsWith(wallet.address.slice(2).toLowerCase());
        result = toHex(sender ? params[1] === "0x3039" ? 1_000_000_000n : 900_000_000n :
          params[1] === "0x3039" ? 0n : 100_000_000n, { size: 32 });
      } else throw new Error(`Unexpected ${method}`);
      const raw = JSON.stringify({ jsonrpc: "2.0", id: envelope.id, result });
      queueMicrotask(() => {
        const response = new EventEmitter() as any; response.statusCode = 200;
        response.headers = { "content-length": String(Buffer.byteLength(raw)) };
        response.resume = () => { response.emit("end"); }; receive(response);
        response.emit("data", Buffer.from(raw)); response.emit("end");
      });
      return request;
    };
    return request;
  });
  syncBuiltinESMExports(); t.after(() => { t.mock.restoreAll(); syncBuiltinESMExports(); });
  const rpc = new HttpsBaseRpc("https://8.8.8.8/base", { directGuardState: setup.state }); rpc.armEvmDirectRpcGuard();
  const observed = await rpc.evm.receipt(8453, operation.transactionHash); assert.ok(observed);
  const evidence = await rpc.evm.evidence(operation, observed);
  assert.equal(evidence.transactionVerified, true); assert.equal(evidence.tokenBalanceDeltasVerified, true);
  assert.equal(posts, 14); assert.ok(posts <= 24); assert.equal(setup.rpc.broadcastCount, 1);
});
