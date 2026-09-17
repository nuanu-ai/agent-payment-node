import assert from "node:assert/strict";
import test from "node:test";
import { encodeAbiParameters, encodeFunctionData, parseAbi } from "viem";
import { bindArgv } from "../../src/command-binder.js";
import { MCP_TOOLS } from "../../src/mcp-projection.js";
import { ApnCore } from "../../src/core.js";
import { StateStore } from "../../src/state.js";
import { temporaryState } from "./helpers.js";
import {
  UNISWAP_MECHANISM_PIN, UNISWAP_NATIVE, UNISWAP_OFFICIAL_PIN_CATALOG, UNISWAP_ROUTER, UNISWAP_USDC,
  UniswapEvmSimulator, UniswapGuardedSwapBuilder, UniswapTradingApi, createUniswapQuoteRequest,
  decodeUniswapQuoteResponse, decodeUniswapRouterCalldata, decodeUniswapSwapResponse, validateUniswapOfficialPinCatalog,
  validateUniswapReceipt,
} from "../../src/swap/index.js";

const ACCOUNT = "0x1a642f0E3c3aF545E7AcBD38b07251B3990914F1", RECIPIENT = "0x2222222222222222222222222222222222222222";
const WETH = "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2", H = (c: string) => c.repeat(64);
const deadline = 1_790_000_600, input = "1000000000000000", output = "2000000", minimum = "1980000";
const executeAbi = parseAbi(["function execute(bytes commands, bytes[] inputs, uint256 deadline) payable"]);
function calldata(command = 0x00, recipient = RECIPIENT, amountOutMin = minimum) {
  const path = `0x${WETH.slice(2)}000bb8${UNISWAP_USDC.slice(2)}` as `0x${string}`;
  const wrap = encodeAbiParameters([{ type: "address" }, { type: "uint256" }], ["0x0000000000000000000000000000000000000002", BigInt(input)]);
  const swap = encodeAbiParameters([{ type: "address" }, { type: "uint256" }, { type: "uint256" }, { type: "bytes" }, { type: "bool" }],
    [recipient as `0x${string}`, BigInt(input), BigInt(amountOutMin), path, false]);
  const commands = `0x0b${command.toString(16).padStart(2, "0")}` as `0x${string}`;
  return encodeFunctionData({ abi: executeAbi, functionName: "execute", args: [commands, [wrap, swap], BigInt(deadline)] });
}
function quoteRequest() { return createUniswapQuoteRequest({ amountAtomic: input, swapper: ACCOUNT, recipient: RECIPIENT,
  slippageBps: 100, ownerSlippageCapBps: 100 }); }
function quoteResponse() { return { requestId: "quote-1", routing: "CLASSIC", isTokenApprovalApplicable: false, permitData: null,
  quote: { chainId: 1, input: { token: UNISWAP_NATIVE, amount: input }, output: { token: UNISWAP_USDC, amount: output, recipient: RECIPIENT },
    swapper: ACCOUNT, tradeType: "EXACT_INPUT", slippageTolerance: 1, route: [{ protocol: "V3" }] } }; }
function envelope() { return { from: ACCOUNT, to: UNISWAP_ROUTER, data: calldata(), value: input, gasLimit: "150000", chainId: 1,
  maxFeePerGas: "2000000000", maxPriorityFeePerGas: "100000000" } as const; }
function swapResponse() { return { requestId: "swap-1", swap: envelope(), gasFee: "300000000000000" }; }

test("bundled official catalog is deterministic and rejects every exact identity substitution", () => {
  assert.equal(UNISWAP_OFFICIAL_PIN_CATALOG.mechanismPin, UNISWAP_MECHANISM_PIN);
  for (const patch of [{ routerProgramIdentity: "0x1111111111111111111111111111111111111111" },
    { auxiliaryContractProgramIdentities: ["0x2222222222222222222222222222222222222222"] },
    { constructorIdentity: "https://example.com/v1" }, { protocolVersion: "2.1.1" }]) {
    const changed: any = structuredClone(UNISWAP_OFFICIAL_PIN_CATALOG); Object.assign(changed.mechanismPin, patch);
    assert.throws(() => validateUniswapOfficialPinCatalog(changed), { code: "APN_STATE_CORRUPT" });
  }
});

test("quote and unsigned envelope codecs bind exact chain, account, pair, permit policy, slippage and gas", () => {
  const request = quoteRequest(); assert.equal(request.permitAmount, "EXACT");
  assert.equal(decodeUniswapQuoteResponse(quoteResponse(), request).isTokenApprovalApplicable, false);
  assert.equal(decodeUniswapSwapResponse(swapResponse(), { account: ACCOUNT, amountAtomic: input, maxGasLimit: "150000",
    maxFeePerGas: "2000000000", maxPriorityFeePerGas: "100000000" }).swap.to, UNISWAP_ROUTER);
  for (const mutate of [(v: any) => { v.quote.chainId = 8453; }, (v: any) => { v.quote.output.token = WETH; },
    (v: any) => { v.isTokenApprovalApplicable = true; }, (v: any) => { v.permitData = {}; }]) {
    const value: any = structuredClone(quoteResponse()); mutate(value); assert.throws(() => decodeUniswapQuoteResponse(value, request), { code: "APN_PROVIDER_PROTOCOL" });
  }
  for (const mutate of [(v: any) => { v.swap.to = WETH; }, (v: any) => { v.swap.from = RECIPIENT; },
    (v: any) => { v.swap.chainId = 8453; }, (v: any) => { v.swap.value = "1"; }, (v: any) => { v.swap.extra = true; }]) {
    const value: any = structuredClone(swapResponse()); mutate(value); assert.throws(() => decodeUniswapSwapResponse(value,
      { account: ACCOUNT, amountAtomic: input, maxGasLimit: "150000", maxFeePerGas: "2000000000", maxPriorityFeePerGas: "100000000" }),
    { code: "APN_PROVIDER_PROTOCOL" });
  }
});

test("Universal Router decoder proves recipient, input, output floor and deadline and rejects command extension or subplan", () => {
  const decoded = decodeUniswapRouterCalldata(calldata(), { recipient: RECIPIENT, inputAmountAtomic: input, minimumOutputAtomic: minimum, deadline });
  assert.equal(decoded.command, "V3_SWAP_EXACT_IN"); assert.equal(decoded.minimumOutputAtomic, minimum);
  assert.throws(() => decodeUniswapRouterCalldata(calldata(0x21), { recipient: RECIPIENT, inputAmountAtomic: input, minimumOutputAtomic: minimum, deadline }), { code: "APN_PROVIDER_PROTOCOL" });
  assert.throws(() => decodeUniswapRouterCalldata(calldata(0x00, ACCOUNT), { recipient: RECIPIENT, inputAmountAtomic: input, minimumOutputAtomic: minimum, deadline }), { code: "APN_PROVIDER_PROTOCOL" });
  assert.throws(() => decodeUniswapRouterCalldata(calldata(0x00, RECIPIENT, "1"), { recipient: RECIPIENT, inputAmountAtomic: input, minimumOutputAtomic: minimum, deadline }), { code: "APN_PROVIDER_PROTOCOL" });
});

test("exact simulation binds safe block, eth_call, estimateGas and bounded head drift", async () => {
  const calls: string[] = [], block = (number: string, hash: string) => ({ number, hash, timestamp: "0x1", baseFeePerGas: "0x1" });
  const rpc = async (method: string, params: readonly unknown[]) => { calls.push(method);
    if (method === "eth_chainId") return "0x1"; if (method === "eth_call") return "0x"; if (method === "eth_estimateGas") return "0x186a0";
    const tag = params[0]; return tag === "latest" ? block("0x65", `0x${H("b")}`) : block("0x64", `0x${H("a")}`); };
  const proof = await new UniswapEvmSimulator(rpc, 2).simulate(envelope());
  assert.equal(proof.blockNumber, "100"); assert.equal(proof.headBlockNumber, "101"); assert.equal(proof.gasEstimate, "100000");
  assert.deepEqual(calls, ["eth_chainId", "eth_getBlockByNumber", "eth_call", "eth_estimateGas", "eth_getBlockByNumber", "eth_getBlockByNumber", "eth_chainId"]);
  const driftRpc = async (method: string, params: readonly unknown[]) => method === "eth_chainId" ? "0x1" : method === "eth_call" ? "0x" :
    method === "eth_estimateGas" ? "0x186a0" : params[0] === "latest" ? block("0x70", `0x${H("b")}`) : block("0x64", `0x${H("a")}`);
  await assert.rejects(new UniswapEvmSimulator(driftRpc, 2).simulate(envelope()), { code: "APN_OPERATION_BLOCKED" });
});

test("Trading API retries only bounded unsigned reads and native approval is impossible", async () => {
  let calls = 0; const api = new UniswapTradingApi("test-api-key", { post: async (_url, headers) => {
    calls++; assert.equal(headers["x-universal-router-version"], "2.2.0"); return calls === 1 ? { status: 503, body: "{}" } : { status: 200, body: JSON.stringify(quoteResponse()) }; } }, 500, 1);
  assert.deepEqual(await api.quote(quoteRequest()), quoteResponse()); assert.equal(calls, 2);
  assert.throws(() => api.checkApproval(), { code: "APN_OPERATION_BLOCKED" });
});

test("guarded builder hashes quote, route, unsigned transaction and exact simulation before prepare", async () => {
  const simulator = { simulate: async () => ({ requestHash: H("1"), resultHash: H("2"), success: true as const,
    blockNumber: "100", blockHash: `0x${H("a")}` as `0x${string}`, headBlockNumber: "101", maxHeadDrift: 2, gasEstimate: "100000" }) };
  const builder = new UniswapGuardedSwapBuilder({ quote: async () => quoteResponse(), swap: async () => swapResponse() }, simulator);
  const result = await builder.quote({ profile: "swap-test", account: ACCOUNT, recipient: RECIPIENT, amountAtomic: input,
    slippageBps: 100, ownerSlippageCapBps: 100, deadline, maxGasLimit: "150000", maxFeePerGas: "2000000000",
    maxPriorityFeePerGas: "100000000", now: new Date((deadline - 300) * 1000) });
  assert.equal(result.quote.minimumOutputAtomic, minimum); assert.match(result.quote.providerResponseHash, /^[a-f0-9]{64}$/u);
  assert.match(result.quote.routeHash, /^[a-f0-9]{64}$/u); assert.match(result.quote.unsignedTransactionPayloadHash, /^[a-f0-9]{64}$/u);
});

test("final receipt requires exact transaction, successful receipt, output log, balance deltas and finalized head", () => {
  const txHash = `0x${H("c")}` as const, blockHash = `0x${H("d")}` as const;
  const recipientTopic = `0x${RECIPIENT.slice(2).toLowerCase().padStart(64, "0")}` as `0x${string}`;
  const proof = validateUniswapReceipt({ transactionHash: txHash, transaction: { hash: txHash, from: ACCOUNT, to: UNISWAP_ROUTER,
    input: calldata(), value: input, blockNumber: "100", blockHash }, receipt: { transactionHash: txHash, status: "0x1",
    blockNumber: "100", blockHash, logs: [{ address: UNISWAP_USDC, topics: [
      "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef", `0x${H("0")}`, recipientTopic],
      data: `0x${BigInt(minimum).toString(16).padStart(64, "0")}` }] }, beforeNative: "2000000000000000", afterNative: "900000000000000",
    beforeOutput: "0", afterOutput: minimum, finalizedHead: { number: "110", hash: `0x${H("e")}` }, observedAt: "2026-09-17T00:00:00.000Z" },
  envelope(), { transactionHash: txHash, account: ACCOUNT, recipient: RECIPIENT, inputAmountAtomic: input, minimumOutputAtomic: minimum });
  assert.equal(proof.finalized, true);
});

test("CLI and MCP expose identical dormant surface; inventory grants no admission and prepare/execute refuse stably", async (t) => {
  const paths = ["inventory", "quote", "prepare", "status", "approve", "execute"];
  for (const action of paths) assert.ok(MCP_TOOLS.some((row) => row.name === `apn_swap_ethereum_uniswap_${action}`));
  assert.equal(bindArgv(["swap", "ethereum", "uniswap", "inventory"]).request.command, "swap.uniswap.inventory");
  const temporary = await temporaryState(); t.after(temporary.cleanup); const core = new ApnCore({ state: new StateStore(temporary.root) });
  const inventory = await core.execute({ command: "swap.uniswap.inventory" }); assert.equal(inventory.ok, true);
  assert.equal((inventory.data as any).admitted, false); assert.equal((inventory.data as any).execution, "dormant");
  const prepare = await core.execute({ command: "swap.uniswap.prepare", profile: "swap-test", quoteHash: H("1"), idempotencyKey: "uniswap-test-0001" });
  assert.equal(prepare.error?.code, "APN_OPERATION_BLOCKED");
  const execute = await core.execute({ command: "swap.uniswap.execute", operationId: H("2") });
  assert.equal(execute.error?.details?.reason, "uniswap_execution_dormant");
});
