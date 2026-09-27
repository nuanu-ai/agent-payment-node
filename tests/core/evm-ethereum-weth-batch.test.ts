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
import { activateDirectPolicy, directAdmission, evmDirectAdmissions } from "./direct-allowlist-helpers.js";
import { RECIPIENT, WALLET, temporaryState } from "./helpers.js";

const token = "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2" as const;
const transfer = { chainId: 1 as const, from: WALLET, to: token, valueAtomic: "0",
  data: `0xa9059cbb${RECIPIENT.slice(2).padStart(64, "0")}${(100_000_000n).toString(16).padStart(64, "0")}` as const };
const selection = { chainId: 1 as const, token, decimals: 18 };
const economics = (fees: { gasLimitAtomic: string; maxFeePerGasAtomic: string; maxPriorityFeePerGasAtomic: string }) =>
  ({ nonceAtomic: "7", ...fees, maximumGasCostAtomic: (BigInt(fees.gasLimitAtomic) * BigInt(fees.maxFeePerGasAtomic)).toString() });

function answer(method: string, params: readonly unknown[], options: { wrongChain?: boolean; reorg?: boolean; balance?: bigint; native?: bigint } = {}): unknown {
  if (method === "eth_chainId") return options.wrongChain ? "0x2105" : "0x1";
  if (method === "eth_getBlockByNumber") return { number: "0x3039", hash: options.reorg && (params[0] !== "latest") ? `0x${"1".repeat(64)}` : EVM_BLOCK_HASH,
    baseFeePerGas: toHex(500_000_000n), transactions: [] };
  if (method === "eth_getBalance") { assert.equal(params[1], "0x3039"); return toHex(options.native ?? 10n ** 18n); }
  if (method === "eth_getCode") { assert.equal(params[0], token); assert.equal(params[1], "0x3039"); return "0x6000"; }
  if (method === "eth_call") {
    const call = params[0] as { to: string; data: string };
    assert.equal(call.to, token); assert.equal(params[1], "0x3039");
    if (call.data === "0x313ce567") return toHex(18n, { size: 32 });
    assert.ok(call.data.startsWith("0x70a08231"));
    return toHex(options.balance ?? 1_000_000_000n, { size: 32 });
  }
  if (method === "eth_getTransactionCount") return "0x7";
  if (method === "eth_estimateGas") return toHex(65_000n);
  if (method === "eth_maxPriorityFeePerGas") return toHex(1_000_000_000n);
  throw new Error(`Unexpected ${method}`);
}

test("Ethereum WETH grouped reads preserve pinned token, chain and fee proof within 8 POSTs", async () => {
  const posts: string[][] = [];
  const rpc = new EvmRpc(async () => { throw new Error("scalar fallback"); }, "https://rpc.example", undefined, async batch => {
    posts.push(batch.map(item => item.method)); return batch.map(item => answer(item.method, item.params));
  });
  const grouped = rpc.prepareEthereumWeth();
  const balance = await grouped.balance(WALLET, selection);
  const { nonce, estimated } = await grouped.nonceEstimate(WALLET, transfer);
  const quote = await grouped.feeQuote(economics(estimated));
  assert.equal(posts.length, 8); assert.equal(nonce, "7"); assert.equal(balance.assetAtomic, "1000000000");
  assert.equal(balance.asset.address, token); assert.equal(balance.asset.decimalsSource, "onchain");
  assert.equal(quote.chainId, 1); assert.equal(quote.l1DataFeeUpperWei, "0");
  assert.deepEqual(posts[1], ["eth_getBalance", "eth_getCode", "eth_call", "eth_call"]);
  assert.ok(posts.every(batch => batch.length > 0));
  await assert.rejects(rpc.prepareEthereumWeth().balance(WALLET, { chainId: 1, token: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48", decimals: 6 }),
    { code: "APN_INVALID_INPUT" });
  await assert.rejects(rpc.prepareEthereumWeth().balance(WALLET, { chainId: 8453, token: "0x4200000000000000000000000000000000000006", decimals: 18 }),
    { code: "APN_INVALID_INPUT" });
  assert.equal(posts.length, 8, "wrong token and chain fail before a physical POST");
});

test("Ethereum WETH batch errors, wrong chain, reorg and missing funds stop without scalar fallback", async () => {
  for (const scenario of ["429", "chain", "reorg", "balance", "gas"] as const) {
    let posts = 0; let scalar = 0;
    const rpc = new EvmRpc(async () => { scalar += 1; throw new Error("scalar fallback"); }, "https://rpc.example", undefined,
      async batch => {
        posts += 1;
        if (scenario === "429" && posts === 2) throw new ApnError("APN_RPC_RATE_LIMITED", "rate limited", { httpStatus: 429 });
        return batch.map(item => answer(item.method, item.params, { wrongChain: scenario === "chain", reorg: scenario === "reorg",
          ...(scenario === "balance" ? { balance: 0n } : {}), ...(scenario === "gas" ? { native: 0n } : {}) }));
      });
    if (scenario === "429" || scenario === "chain" || scenario === "reorg") {
      await assert.rejects(rpc.prepareEthereumWeth().balance(WALLET, selection), {
        code: scenario === "429" ? "APN_RPC_RATE_LIMITED" : scenario === "chain" ? "APN_CHAIN_MISMATCH" : "APN_RPC_PROTOCOL",
      });
    } else {
      const value = await rpc.prepareEthereumWeth().balance(WALLET, selection);
      assert.equal(scenario === "balance" ? value.assetAtomic : value.nativeAtomic, "0");
    }
    assert.equal(scalar, 0); assert.ok(posts <= 3);
  }
});

test("production HTTPS 429 rejects the batch after one physical POST without a scalar retry", async t => {
  const temporary = await temporaryState(); t.after(temporary.cleanup);
  const setup = evmCore(temporary.root);
  await setup.state.initialize();
  let posts = 0;
  t.mock.method(https, "request", (_endpoint: URL, _options: unknown, receive: (response: unknown) => void) => {
    posts += 1;
    const request = new EventEmitter() as any; request.setTimeout = () => request;
    request.end = (body: string) => {
      assert.ok(Array.isArray(JSON.parse(body)));
      queueMicrotask(() => {
        const response = new EventEmitter() as any; response.statusCode = 429;
        response.headers = { "content-length": "0" };
        response.resume = () => { response.emit("end"); }; receive(response); response.emit("end");
      });
      return request;
    };
    return request;
  });
  syncBuiltinESMExports(); t.after(() => { t.mock.restoreAll(); syncBuiltinESMExports(); });
  const rpc = new HttpsBaseRpc("https://8.8.8.8/ethereum", { directGuardState: setup.state });
  rpc.armEvmDirectRpcGuard();
  await assert.rejects(rpc.evm.prepareEthereumWeth().balance(WALLET, selection), { code: "APN_RPC_RATE_LIMITED" });
  assert.equal(posts, 1);
});

test("production HTTPS batches use 8 prepare, 8 pre-sign and 5 post-sign physical POSTs with reversed IDs", async t => {
  const temporary = await temporaryState(); t.after(temporary.cleanup);
  const setup = evmCore(temporary.root); setup.rpc.chainId = 1; setup.rpc.l1Fee = 0n; setup.rpc.operatorFee = 0n;
  const wallet = await ensureDirectWallet(setup);
  setup.rpc.assetAtomic = "1000000000"; setup.rpc.decimals = 18;
  await activateDirectPolicy(setup.state.root, "default", { accounts: { evm: wallet.address },
    admissions: [...evmDirectAdmissions(), directAdmission("eip155:1", token, { maximumPerTransferAtomic: "1000000000000", dailyLimitAtomic: "1000000000000" })],
    now: setup.clock.now() });
  const prepared = await setup.core.transfer.prepare({ ...EVM_REQUEST, asset: selection, amount: "0.0000000001" }) as { operation_id: string };
  const operation = await setup.state.findOperation(prepared.operation_id); assert.ok(operation);
  const bodies: { id: number; method: string; params: unknown[] }[][] = [];
  let sends = 0;
  t.mock.method(https, "request", (_endpoint: URL, _options: unknown, receive: (response: unknown) => void) => {
    const request = new EventEmitter() as any; request.setTimeout = () => request;
    request.end = (body: string) => {
      const envelope = JSON.parse(body) as { id: number; method: string; params: unknown[] } | { id: number; method: string; params: unknown[] }[];
      if (Array.isArray(envelope)) bodies.push(envelope);
      else { assert.equal(envelope.method, "eth_sendRawTransaction"); sends += 1; }
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
  const rpc = new HttpsBaseRpc("https://8.8.8.8/ethereum", { directGuardState: setup.state });
  rpc.armEvmDirectRpcGuard();
  const grouped = rpc.evm.prepareEthereumWeth();
  await grouped.balance(operation.walletAddress, selection);
  const { estimated } = await grouped.nonceEstimate(operation.walletAddress, transfer);
  await grouped.feeQuote(economics(estimated));
  assert.equal(bodies.length, 8);
  await checkEvmTransferFunding(rpc, operation, true, setup.state.root);
  assert.equal(bodies.length, 16);
  await checkEvmTransferFunding(rpc, operation, false, setup.state.root);
  assert.equal(bodies.length, 21);
  assert.equal(bodies.slice(16).flat().some(item => item.method === "eth_estimateGas"), false,
    "post-sign funding checks the frozen gas envelope without a new estimate");
  assert.equal(await rpc.submitRawTransaction("0x01"), `0x${"3".repeat(64)}`);
  assert.equal(sends, 1); assert.equal(bodies.length + sends, 22);
});
