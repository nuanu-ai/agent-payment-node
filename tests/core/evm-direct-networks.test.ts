import assert from "node:assert/strict";
import test from "node:test";
import { decodeFunctionData, parseTransaction, toHex } from "viem";
import { loadAllowlistInventory } from "../../src/allowlist-inventory.js";
import { ApnError } from "../../src/errors.js";
import { EVM_NETWORKS } from "../../src/evm-asset.js";
import { requireEvmFunding, validateEvmFeeQuote } from "../../src/evm-direct.js";
import { listedEvmAsset } from "../../src/evm-direct-allowlist.js";
import { DIRECT_EVM_NETWORKS, directEvmListRows, type DirectEvmChainId } from "../../src/evm-direct-networks.js";
import type { EvmRpcCall } from "../../src/evm-ports.js";
import { EvmRpc } from "../../src/evm-rpc.js";
import type { Address } from "../../src/model.js";
import { activateDirectPolicy, directAdmission, directUsage } from "./direct-allowlist-helpers.js";
import { EVM_BLOCK_HASH, EVM_REQUEST, evmCore } from "./evm-helpers.js";
import { RECIPIENT, WALLET, temporaryState } from "./helpers.js";

const EIGHT = [10, 137, 56, 43114, 130, 59144, 143, 1329] as const;
/** Pinned here independently of the dataset so a list revision cannot silently change what these networks accept. */
const LIST_TOKENS: Readonly<Record<typeof EIGHT[number], readonly [string, Address][]>> = {
  10: [["USDC", "0x0b2C639c533813f4Aa9D7837CAf62653d097Ff85"]],
  137: [["USDC", "0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359"]],
  56: [],
  43114: [["USDC", "0xB97EF9Ef8734C71904D8002F8b6Bc66Dd9c48a6E"], ["USDT", "0x9702230A8Ea53601f5cD2dc00fDBc13d4dF4A8c7"]],
  130: [["USDC", "0x078D782b760474a361dDA0AF3839290b0EF57AD6"]],
  59144: [["USDC", "0x176211869cA2b568f2A7D4EE941E073a821EE1ff"]],
  143: [["USDC", "0x754704Bc059F8C67012fEd69BC8A327a5aafb603"]],
  1329: [["USDC", "0xe15fC38F6D8c56aF07bbCBe3BAf5708A2Bf42392"]],
};
const NATIVE: Readonly<Record<typeof EIGHT[number], string>> = { 10: "ETH", 137: "POL", 56: "BNB", 43114: "AVAX", 130: "ETH", 59144: "ETH", 143: "MON", 1329: "SEI" };
const ECONOMICS = { nonceAtomic: "7", gasLimitAtomic: "21000", maxFeePerGasAtomic: "0", maxPriorityFeePerGasAtomic: "0", maximumGasCostAtomic: "0" };
const refused = (reason: string) => (error: unknown) => error instanceof ApnError && error.code === "APN_ALLOWLIST_REFUSED" && error.details?.reason === reason;

/** A JSON-RPC wire for the production EvmRpc: fixed head, the selected fee market and the OP-stack GasPriceOracle. */
function wire(chainId: number, market: { readonly baseFee: bigint; readonly priority: bigint }) {
  const calls: { method: string; params: readonly unknown[] }[] = [];
  const call: EvmRpcCall = async (method, params) => {
    calls.push({ method, params });
    if (method === "eth_chainId") return toHex(chainId);
    if (method === "eth_getBlockByNumber") return { number: "0x3039", hash: EVM_BLOCK_HASH, baseFeePerGas: toHex(market.baseFee), transactions: [] };
    if (method === "eth_maxPriorityFeePerGas") return toHex(market.priority);
    if (method === "eth_estimateGas") return "0x5208";
    if (method === "eth_call") {
      const input = params[0] as { to: Address; data: `0x${string}` };
      assert.equal(input.to, "0x420000000000000000000000000000000000000F");
      const decoded = decodeFunctionData({ abi: [
        { type: "function", name: "getL1FeeUpperBound", inputs: [{ name: "size", type: "uint256" }], outputs: [{ type: "uint256" }] },
        { type: "function", name: "getOperatorFee", inputs: [{ name: "gas", type: "uint256" }], outputs: [{ type: "uint256" }] },
      ], data: input.data });
      return toHex(decoded.functionName === "getL1FeeUpperBound" ? 4644311739n : 7n, { size: 32 });
    }
    throw new Error(`unexpected ${method}`);
  };
  return { calls, rpc: new EvmRpc(call, "https://rpc.example") };
}

async function quoted(chainId: DirectEvmChainId, market: { readonly baseFee: bigint; readonly priority: bigint }) {
  const { calls, rpc } = wire(chainId, market);
  const fees = await rpc.estimate({ chainId, from: WALLET, to: RECIPIENT, valueAtomic: "1", data: "0x" });
  const economics = { ...ECONOMICS, ...fees, maximumGasCostAtomic: (BigInt(fees.gasLimitAtomic) * BigInt(fees.maxFeePerGasAtomic)).toString() };
  return { calls, fees, economics, quote: await rpc.feeQuote(chainId, economics) };
}

test("the direct registry enables the eight remaining list networks with their list rows only, and leaves the shared EVM set alone", () => {
  assert.deepEqual(EVM_NETWORKS.map((network) => network.chainId), [8453, 1, 42161]);
  const listed = loadAllowlistInventory().networks.filter((network) => network.family === "evm").map((network) => network.chain).sort();
  assert.deepEqual(DIRECT_EVM_NETWORKS.map((network) => network.caip2).sort(), listed);
  for (const chainId of EIGHT) {
    const chain = `eip155:${chainId}`, rows = directEvmListRows(chainId);
    assert.deepEqual(rows.map((row) => [row.kind, row.symbol, row.identifier, row.decimals]),
      [["native", NATIVE[chainId], null, 18], ...LIST_TOKENS[chainId].map(([symbol, address]) => ["token", symbol, address, 6])], chain);
    assert.deepEqual(listedEvmAsset(chain, "native"), { selection: { chainId, token: "native" }, decimals: 18 });
    for (const [, address] of LIST_TOKENS[chainId]) assert.deepEqual(listedEvmAsset(chain, address.toLowerCase(), 6), { selection: { chainId, token: address, decimals: 6 }, decimals: 6 });
  }
  // A token listed on another network, or not listed at all, is refused on these networks before any RPC.
  assert.throws(() => listedEvmAsset("eip155:10", LIST_TOKENS[130][0]![1]), refused("allowlist_asset_unlisted"));
  assert.throws(() => listedEvmAsset("eip155:56", "0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d"), refused("allowlist_asset_unlisted"));
  assert.throws(() => listedEvmAsset("eip155:137", "0xc2132D05D31c914a87C6611C10748AEb04B58e8F"), refused("allowlist_asset_unlisted"));
  assert.throws(() => listedEvmAsset("eip155:43114", LIST_TOKENS[43114][1]![1], 18), refused("allowlist_decimals_mismatch"));
  assert.throws(() => listedEvmAsset("eip155:10", "native", 6), refused("allowlist_decimals_mismatch"));
});

for (const chainId of [10, 130] as const) test(`OP-stack chain ${chainId} adds the oracle L1 data and operator fees, and the owner budget caps the sum`, async () => {
  const { calls, fees, economics, quote } = await quoted(chainId, { baseFee: 523n, priority: 1_000_000n });
  assert.equal(fees.maxFeePerGasAtomic, "1001046");
  assert.equal(quote.maximumExecutionFeeWei, (21000n * 1001046n).toString());
  assert.equal(quote.l1DataFeeUpperWei, "4644311739"); assert.equal(quote.operatorFeeUpperWei, "7");
  assert.equal(quote.totalQuoteWei, (21000n * 1001046n + 4644311739n + 7n).toString());
  assert.equal(quote.feeModel, undefined); assert.equal(calls.filter(({ method }) => method === "eth_call").length, 2);
  assert.equal(validateEvmFeeQuote(quote, economics), quote);
  const balance = { address: WALLET, asset: { schemaVersion: "apn.evm-asset.v1" as const, chainId, kind: "native" as const, address: "0x0000000000000000000000000000000000000000" as Address, decimals: 18, decimalsSource: "native" as const },
    assetAtomic: "10000000000000000", nativeAtomic: "10000000000000000", blockNumberAtomic: "12345", blockHash: EVM_BLOCK_HASH, rpcOrigin: "https://rpc.example", observedAt: new Date().toISOString() };
  requireEvmFunding(balance, "1", quote, quote.totalQuoteWei);
  // A budget that covers execution but not the L1 data fee is refused: the cap is on the total native network fee.
  assert.throws(() => requireEvmFunding(balance, "1", quote, quote.maximumExecutionFeeWei), { code: "APN_FEE_BUDGET_EXCEEDED" });
  assert.throws(() => validateEvmFeeQuote({ ...quote, feeModel: "monad-gas-limit" }, economics), { code: "APN_STATE_CORRUPT" });
});

test("EIP-1559 list networks quote execution only; an L1 or operator fee on them is a corrupt quote", async () => {
  for (const chainId of [137, 43114, 59144, 1329] as const) {
    const { calls, economics, quote } = await quoted(chainId, { baseFee: 7n, priority: 510_038_659n });
    assert.equal(quote.totalQuoteWei, (21000n * (14n + 510_038_659n)).toString(), String(chainId));
    assert.equal(quote.l1DataFeeUpperWei, "0"); assert.equal(quote.feeModel, undefined);
    assert.equal(calls.some(({ method }) => method === "eth_call"), false);
    assert.throws(() => validateEvmFeeQuote({ ...quote, l1DataFeeUpperWei: "1", totalQuoteWei: (BigInt(quote.totalQuoteWei) + 1n).toString() }, economics), { code: "APN_STATE_CORRUPT" });
  }
});

test("Monad bills the gas limit: the quote names that model and budgets limit x max fee", async () => {
  const { economics, quote } = await quoted(143, { baseFee: 100_000_000_000n, priority: 2_000_000_000n });
  assert.equal(quote.feeModel, "monad-gas-limit");
  assert.equal(quote.maximumExecutionFeeWei, (21000n * 202_000_000_000n).toString()); assert.equal(quote.totalQuoteWei, quote.maximumExecutionFeeWei);
  assert.equal(validateEvmFeeQuote(quote, economics), quote);
  const unlabelled: Record<string, unknown> = { ...quote };
  delete unlabelled.feeModel;
  assert.throws(() => validateEvmFeeQuote(unlabelled, economics), { code: "APN_STATE_CORRUPT" });
  assert.throws(() => validateEvmFeeQuote({ ...quote, chainId: 1329 }, economics), { code: "APN_STATE_CORRUPT" });
});

test("BNB Smart Chain's zero base fee prices at the priority fee, and a zero total price is refused", async () => {
  const { fees, quote } = await quoted(56, { baseFee: 0n, priority: 50_000_000n });
  assert.equal(fees.maxFeePerGasAtomic, "50000000"); assert.equal(quote.totalQuoteWei, (21000n * 50_000_000n).toString());
  const { rpc } = wire(56, { baseFee: 0n, priority: 0n });
  await assert.rejects(rpc.estimate({ chainId: 56, from: WALLET, to: RECIPIENT, valueAtomic: "1", data: "0x" }), { code: "APN_RPC_PROTOCOL" });
});

test("supersession scans start at the safe head on safe-finality networks and at latest on inclusion networks", async () => {
  for (const [chainId, tag] of [[143, "safe"], [43114, "safe"], [59144, "latest"], [10, "latest"]] as const) {
    const { calls, rpc } = wire(chainId, { baseFee: 1n, priority: 1n });
    assert.equal(await rpc.confirmedAtNonce(chainId, WALLET, "7", "12345"), null);
    assert.equal(calls.find(({ method }) => method === "eth_getBlockByNumber")?.params[0], tag, String(chainId));
  }
});

for (const chainId of EIGHT) test(`chain ${chainId}: native and list tokens prepare within owner caps, sign for the chain and complete`, async (context) => {
  const temporary = await temporaryState(); context.after(temporary.cleanup);
  const setup = evmCore(temporary.root);
  setup.rpc.chainId = chainId;
  if (chainId !== 10 && chainId !== 130) { setup.rpc.l1Fee = 0n; setup.rpc.operatorFee = 0n; }
  const wallet = await setup.core.wallet.ensure("default") as { address: Address };
  setup.rpc.sender = wallet.address;
  const chain = `eip155:${chainId}`, assets: readonly (Address | "native")[] = ["native", ...LIST_TOKENS[chainId].map(([, address]) => address)];
  const caps = { maximumPerTransferAtomic: "2000000", dailyLimitAtomic: "2500000" };
  await activateDirectPolicy(temporary.root, "default", { accounts: { evm: wallet.address }, now: setup.clock.now(),
    admissions: assets.map((asset) => directAdmission(chain, asset === "native" ? null : asset, caps)) });
  for (const [index, token] of assets.entries()) {
    const request = { ...EVM_REQUEST, asset: { chainId, token }, amount: token === "native" ? "0.0000000000015" : "1.5", idempotencyKey: `evm8-${chainId}-${index}-ok` };
    const calls = setup.rpc.genericBalanceCalls;
    await assert.rejects(setup.core.transfer.prepare({ ...request, amount: token === "native" ? "0.000000000002000001" : "2.000001", idempotencyKey: `evm8-${chainId}-${index}-cap` }),
      refused("allowlist_per_transfer_cap_exceeded"));
    assert.equal(setup.rpc.genericBalanceCalls, calls, "caps refuse before any RPC read");
    const prepared = await setup.core.transfer.prepare(request) as { operation_id: string; state: string };
    assert.equal(prepared.state, "awaiting_approval");
    const approved = await setup.core.transfer.approve(prepared.operation_id) as { state: string };
    assert.equal(approved.state, "completed", `${chain} ${token}`);
    const transaction = parseTransaction(setup.rpc.submissions.at(-1)!);
    assert.equal(transaction.chainId, chainId);
    assert.equal(transaction.to?.toLowerCase(), (token === "native" ? EVM_REQUEST.recipient : token).toLowerCase());
    assert.equal(await directUsage(temporary.root, wallet.address, chain, token === "native" ? null : token, setup.clock.now()), "1500000");
    await assert.rejects(setup.core.transfer.prepare({ ...request, idempotencyKey: `evm8-${chainId}-${index}-day` }), refused("allowlist_daily_cap_exceeded"));
  }
  if (chainId === 56) {
    await assert.rejects(setup.core.transfer.prepare({ ...EVM_REQUEST, asset: { chainId, token: "0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d" }, amount: "1", idempotencyKey: "evm8-56-unlisted" }),
      refused("allowlist_asset_unlisted"));
  }
});

test("an asset admitted on one new network is not admitted on another, and an amount above the balance refuses before estimating gas", async (context) => {
  const temporary = await temporaryState(); context.after(temporary.cleanup);
  const setup = evmCore(temporary.root);
  setup.rpc.chainId = 43114; setup.rpc.l1Fee = 0n; setup.rpc.operatorFee = 0n;
  const wallet = await setup.core.wallet.ensure("default") as { address: Address };
  await activateDirectPolicy(temporary.root, "default", { accounts: { evm: wallet.address }, now: setup.clock.now(), admissions: [directAdmission("eip155:43114", null)] });
  const usdt = LIST_TOKENS[43114][1]![1];
  await assert.rejects(setup.core.transfer.prepare({ ...EVM_REQUEST, asset: { chainId: 43114, token: usdt }, amount: "1", idempotencyKey: "evm8-avax-usdt" }), refused("allowlist_direct_not_admitted"));
  await assert.rejects(setup.core.transfer.prepare({ ...EVM_REQUEST, asset: { chainId: 137, token: "native" }, amount: "1", idempotencyKey: "evm8-pol-native" }), refused("allowlist_direct_not_admitted"));
  setup.rpc.nativeAtomic = "1";
  let estimated = false;
  const estimate = setup.rpc.evm.estimate;
  (setup.rpc.evm as { estimate: typeof estimate }).estimate = async (input) => { estimated = true; return await estimate(input); };
  await assert.rejects(setup.core.transfer.prepare({ ...EVM_REQUEST, asset: { chainId: 43114, token: "native" }, amount: "0.000001", idempotencyKey: "evm8-avax-poor" }), { code: "APN_INSUFFICIENT_ASSET" });
  assert.equal(estimated, false);
});
