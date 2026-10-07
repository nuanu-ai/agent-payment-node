import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import https from "node:https";
import { syncBuiltinESMExports } from "node:module";
import test from "node:test";
import { keccak256, toHex } from "viem";
import { ApnCore } from "../../src/core.js";
import { ApnError } from "../../src/errors.js";
import { requireEvmFunding } from "../../src/evm-direct.js";
import { EvmRpc } from "../../src/evm-rpc.js";
import { checkEvmTransferFunding } from "../../src/evm-transfer-approval.js";
import { HttpsBaseRpc } from "../../src/rpc.js";
import { StateStore } from "../../src/state.js";
import { EVM_BLOCK_HASH, EVM_REQUEST, ensureDirectWallet, evmCore } from "./evm-helpers.js";
import { activateDirectPolicy, directAdmission, evmDirectAdmissions } from "./direct-allowlist-helpers.js";
import { RECIPIENT, WALLET, temporaryState } from "./helpers.js";

const token = "0xFd086bC7CD5C481DCC9C85ebE478A1C0b69FCbb9" as const;
const selection = { chainId: 42161 as const, token, decimals: 6 };
const transaction = { chainId: 42161 as const, from: WALLET, to: token, valueAtomic: "0",
  data: `0xa9059cbb${RECIPIENT.slice(2).padStart(64, "0")}${(100_000n).toString(16).padStart(64, "0")}` as const };
const economics = (fees: { gasLimitAtomic: string; maxFeePerGasAtomic: string; maxPriorityFeePerGasAtomic: string }) =>
  ({ nonceAtomic: "7", ...fees, maximumGasCostAtomic: (BigInt(fees.gasLimitAtomic) * BigInt(fees.maxFeePerGasAtomic)).toString() });

function answer(method: string, params: readonly unknown[], options: { chain?: number; code?: string; decimals?: bigint;
  reorg?: boolean; balance?: bigint; gas?: bigint; baseFee?: bigint; missingDecimals?: boolean } = {}): unknown {
  if (method === "eth_chainId") return toHex(options.chain ?? 42161);
  if (method === "eth_getBlockByNumber") return { number: "0x3039",
    hash: options.reorg && params[0] !== "latest" ? `0x${"1".repeat(64)}` : EVM_BLOCK_HASH,
    baseFeePerGas: toHex(options.baseFee ?? 100n), transactions: [] };
  if (method === "eth_getBalance") { assert.equal(params[1], "0x3039"); return toHex(10n ** 18n); }
  if (method === "eth_getCode") { assert.equal(params[0], token); assert.equal(params[1], "0x3039"); return options.code ?? "0x6000"; }
  if (method === "eth_call") {
    const call = params[0] as { to: string; data: string };
    assert.equal(call.to, token); assert.equal(params[1], "0x3039");
    return call.data === "0x313ce567" ? options.missingDecimals ? "0x" : toHex(options.decimals ?? 6n, { size: 32 }) : toHex(options.balance ?? 1_000_000n, { size: 32 });
  }
  if (method === "eth_getTransactionCount") return "0x7";
  if (method === "eth_estimateGas") return toHex(options.gas ?? 65_000n);
  throw new Error(`unexpected ${method}`);
}

test("Arbitrum USD₮0 grouped reads use five pinned POSTs and refuse bad identity, metadata and transport", async () => {
  const posts: string[][] = []; let scalar = 0;
  const rpc = new EvmRpc(async () => { scalar++; throw new Error("scalar fallback"); }, "https://rpc.example", undefined,
    async calls => { posts.push(calls.map(call => call.method)); return calls.map(call => answer(call.method, call.params)); });
  const reads = rpc.prepareArbitrumUsdt0();
  const balance = await reads.balance(WALLET, selection);
  const { nonce, estimated } = await reads.nonceEstimate(WALLET, transaction);
  const quote = await reads.feeQuote(economics(estimated));
  assert.equal(posts.length, 5); assert.equal(scalar, 0); assert.equal(nonce, "7");
  assert.deepEqual(posts[1], ["eth_getBalance", "eth_getCode", "eth_call", "eth_call"]);
  assert.equal(balance.assetAtomic, "1000000"); assert.equal(balance.asset.decimalsSource, "onchain");
  assert.equal(estimated.maxPriorityFeePerGasAtomic, "0"); assert.equal(quote.feeModel, "arbitrum-inclusive");
  assert.throws(() => requireEvmFunding(balance, "1000001", quote, quote.totalQuoteWei), { code: "APN_INSUFFICIENT_ASSET" });
  assert.throws(() => requireEvmFunding(balance, "100000", quote, (BigInt(quote.totalQuoteWei) - 1n).toString()),
    { code: "APN_FEE_BUDGET_EXCEEDED" });
  await assert.rejects(rpc.prepareArbitrumUsdt0().balance(WALLET, { ...selection, token: "0x4200000000000000000000000000000000000006" }), { code: "APN_INVALID_INPUT" });
  for (const [options, code] of [
    [{ code: "0x" }, "APN_ASSET_MISMATCH"], [{ decimals: 18n }, "APN_ASSET_MISMATCH"],
    [{ missingDecimals: true }, "APN_ASSET_MISMATCH"],
    [{ chain: 1 }, "APN_CHAIN_MISMATCH"], [{ reorg: true }, "APN_RPC_PROTOCOL"],
  ] as const) {
    let scalarCalls = 0;
    const bad = new EvmRpc(async () => { scalarCalls++; throw new Error("scalar fallback"); }, "https://rpc.example", undefined,
      async calls => calls.map(call => answer(call.method, call.params, options)));
    await assert.rejects(bad.prepareArbitrumUsdt0().balance(WALLET, selection), { code });
    assert.equal(scalarCalls, 0);
  }
  const limited = new EvmRpc(async () => { throw new Error("scalar fallback"); }, "https://rpc.example", undefined,
    async () => { throw new ApnError("APN_RPC_RATE_LIMITED", "429", { httpStatus: 429 }); });
  await assert.rejects(limited.prepareArbitrumUsdt0().balance(WALLET, selection), { code: "APN_RPC_RATE_LIMITED" });
  const noGasPrice = new EvmRpc(async () => { throw new Error("scalar fallback"); }, "https://rpc.example", undefined,
    async calls => calls.map(call => answer(call.method, call.params, { baseFee: 0n })));
  await noGasPrice.prepareArbitrumUsdt0().balance(WALLET, selection);
  await assert.rejects(noGasPrice.prepareArbitrumUsdt0().nonceEstimate(WALLET, transaction), { code: "APN_RPC_PROTOCOL" });
});

test("mock HTTPS Arbitrum USD₮0 approval reaches signed send in eleven physical POSTs", async t => {
  const temporary = await temporaryState(); t.after(temporary.cleanup);
  const setup = evmCore(temporary.root); setup.rpc.chainId = 42161; setup.rpc.decimals = 6;
  setup.rpc.l1Fee = 0n; setup.rpc.operatorFee = 0n;
  setup.rpc.fees = { ...setup.rpc.fees, maxPriorityFeePerGasAtomic: "0" };
  const wallet = await ensureDirectWallet(setup); setup.rpc.assetAtomic = "1000000";
  await activateDirectPolicy(temporary.root, "default", { accounts: { evm: wallet.address },
    admissions: [...evmDirectAdmissions(), directAdmission("eip155:42161", token,
      { maximumPerTransferAtomic: "1000000", dailyLimitAtomic: "1000000" })], now: setup.clock.now() });
  const prepared = await setup.core.transfer.prepare({ ...EVM_REQUEST, asset: selection, amount: "0.1" }) as { operation_id: string };
  const operation = await setup.state.findOperation(prepared.operation_id); assert.ok(operation);
  const batches: string[][] = []; let posts = 0, sends = 0;
  t.mock.method(https, "request", (_endpoint: URL, _options: unknown, receive: (response: unknown) => void) => {
    const request = new EventEmitter() as any; request.setTimeout = () => request;
    request.end = (body: string) => {
      posts++;
      const envelope = JSON.parse(body) as { id: number; method: string; params: unknown[] } | { id: number; method: string; params: unknown[] }[];
      if (Array.isArray(envelope)) batches.push(envelope.map(item => item.method));
      else { assert.equal(envelope.method, "eth_sendRawTransaction"); sends++; }
      const raw = JSON.stringify(Array.isArray(envelope)
        ? envelope.map(item => ({ jsonrpc: "2.0", id: item.id, result: answer(item.method, item.params) })).reverse()
        : { jsonrpc: "2.0", id: envelope.id, result: `0x${"3".repeat(64)}` });
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
  const rpc = new HttpsBaseRpc("https://8.8.8.8/arbitrum", { directGuardState: setup.state }); rpc.armEvmDirectRpcGuard();
  const grouped = rpc.evm.prepareArbitrumUsdt0();
  await grouped.balance(wallet.address, selection);
  const { estimated } = await grouped.nonceEstimate(wallet.address, { ...transaction, from: wallet.address });
  await grouped.feeQuote(economics(estimated)); assert.equal(posts, 5);
  await checkEvmTransferFunding(rpc, operation, true, setup.state.root); assert.equal(posts, 10);
  await checkEvmTransferFunding(rpc, operation, false, setup.state.root); assert.equal(posts, 15);
  await rpc.submitRawTransaction("0x01"); assert.equal(posts, 16); assert.equal(sends, 1);
  assert.equal(posts - 5, 11); assert.ok(posts < 24);
  assert.equal(batches.some(batch => batch.includes("eth_getTransactionReceipt")), false);
});

test("Arbitrum USD₮0 approval signs once and leaves fast receipt for explicit observation", async t => {
  const temporary = await temporaryState(); t.after(temporary.cleanup);
  const setup = evmCore(temporary.root); setup.rpc.chainId = 42161; setup.rpc.decimals = 6;
  setup.rpc.l1Fee = 0n; setup.rpc.operatorFee = 0n;
  setup.rpc.fees = { ...setup.rpc.fees, maxPriorityFeePerGasAtomic: "0" };
  const wallet = await ensureDirectWallet(setup); setup.rpc.sender = wallet.address; setup.rpc.assetAtomic = "1000000";
  await activateDirectPolicy(temporary.root, "default", { accounts: { evm: wallet.address },
    admissions: [...evmDirectAdmissions(), directAdmission("eip155:42161", token,
      { maximumPerTransferAtomic: "1000000", dailyLimitAtomic: "1000000" })], now: setup.clock.now() });
  const prepared = await setup.core.transfer.prepare({ ...EVM_REQUEST, asset: selection, amount: "0.1" }) as { operation_id: string };
  const approved = await setup.core.transfer.approve(prepared.operation_id) as { state: string };
  assert.equal(approved.state, "submitted_pending"); assert.equal(setup.rpc.broadcastCount, 1);
  const observed = await setup.core.transfer.resume(prepared.operation_id, undefined, true) as { state: string };
  assert.equal(observed.state, "completed"); assert.equal(setup.rpc.broadcastCount, 1);
});

test("v0.5.31-compatible signed Arbitrum USD₮0 operation observes the same hash without signing or dispatch", async t => {
  const temporary = await temporaryState(); t.after(temporary.cleanup);
  let signedRaw: `0x${string}` | undefined;
  const setup = evmCore(temporary.root, undefined, undefined, undefined, native => ({ request: async request => {
    const result = await native.request(request);
    if (request.operation === "directTransfer.approveAndSign") {
      signedRaw = (result as { rawTransaction: `0x${string}` }).rawTransaction;
      setup.rpc.fees = { ...setup.rpc.fees, gasLimitAtomic: "99999" };
    }
    return result;
  } }));
  setup.rpc.chainId = 42161; setup.rpc.decimals = 6; setup.rpc.l1Fee = 0n; setup.rpc.operatorFee = 0n;
  setup.rpc.fees = { ...setup.rpc.fees, maxPriorityFeePerGasAtomic: "0" };
  const wallet = await ensureDirectWallet(setup); setup.rpc.assetAtomic = "1000000";
  await activateDirectPolicy(temporary.root, "default", { accounts: { evm: wallet.address },
    admissions: [...evmDirectAdmissions(), directAdmission("eip155:42161", token,
      { maximumPerTransferAtomic: "1000000", dailyLimitAtomic: "1000000" })], now: setup.clock.now() });
  const frozenFees = setup.rpc.fees;
  const prepared = await setup.core.transfer.prepare({ ...EVM_REQUEST, asset: selection, amount: "0.1" }) as { operation_id: string };
  await assert.rejects(setup.core.transfer.approve(prepared.operation_id), { code: "APN_FEE_BUDGET_EXCEEDED" });
  const saved = await setup.state.findOperation(prepared.operation_id);
  assert.ok(saved); assert.ok(signedRaw);
  assert.equal(saved.schemaVersion, "apn.state.v1");
  assert.equal(saved.state, "signed_not_submitted");
  assert.equal(saved.rawTransactionHash, keccak256(signedRaw));
  assert.equal(setup.rpc.broadcastCount, 0);

  const posts: string[][] = []; let sends = 0, newSigns = 0, latestNonceReads = 0;
  t.mock.method(https, "request", (_endpoint: URL, _options: unknown, receive: (response: unknown) => void) => {
    const request = new EventEmitter() as any; request.setTimeout = () => request;
    request.end = (body: string) => {
      const envelope = JSON.parse(body) as { id: number; method: string; params: unknown[] } | { id: number; method: string; params: unknown[] }[];
      const calls = Array.isArray(envelope) ? envelope : [envelope];
      posts.push(calls.map(call => call.method));
      const replies = calls.map(call => {
        if (call.method === "eth_getTransactionReceipt") return { jsonrpc: "2.0", id: call.id, result: null };
        if (call.method === "eth_sendRawTransaction") {
          sends++;
          assert.deepEqual(call.params, [signedRaw], "resume must send the sealed v0.5.31 raw effect unchanged");
          return { jsonrpc: "2.0", id: call.id, result: keccak256(signedRaw!) };
        }
        if (call.method === "eth_getTransactionCount" && call.params[1] === "latest") latestNonceReads++;
        return { jsonrpc: "2.0", id: call.id, result: answer(call.method, call.params) };
      });
      const raw = JSON.stringify(Array.isArray(envelope) ? replies.reverse() : replies[0]);
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

  const state = new StateStore(temporary.root);
  const rpc = new HttpsBaseRpc("https://8.8.8.8/arbitrum", { directGuardState: state });
  const core = new ApnCore({ state, rpc, clock: setup.clock, native: { request: async request => {
    if (request.operation === "directTransfer.approveAndSign") newSigns++;
    return await setup.local.request(request);
  } } });
  const resumed = await core.transfer.resume(prepared.operation_id) as { state: string };
  assert.equal(resumed.state, "unknown_finality", "a missing receipt cannot establish paid completion or allow another send");
  assert.equal(newSigns, 0); assert.equal(sends, 0); assert.equal(latestNonceReads, 0);
  assert.equal(posts.length, 2, "recovery asserts the selected chain and reads the receipt");
  assert.ok(posts.length <= 24);
  const retained = await state.findOperation(prepared.operation_id);
  assert.equal(retained?.rawTransactionHash, saved.rawTransactionHash);
  assert.equal(retained?.transactionHash, saved.transactionHash);
});
