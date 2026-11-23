import assert from "node:assert/strict";
import test from "node:test";
import { encodeFunctionData, getAddress, parseAbi, type Hex } from "viem";
import type { CandidateAsset } from "../../src/allowlist-inventory.js";
import { binancePegPolicyAsset } from "../../src/binance-peg-policy-assets.js";
import { GUARDED_SWAP_INVENTORY } from "../../src/swap/owner-admission.js";
import { swapMechanismDigest, validateSwapMechanismPin } from "../../src/swap/pin.js";
import { assetAdmitsSwapMechanism, swapRouteDigest, swapRouteOf } from "../../src/swap/route-admission.js";
import { validateSwapQuote } from "../../src/swap/quote.js";
import { UNISWAP_ROUTER, UNISWAP_USDC } from "../../src/swap/uniswap-pin.js";
import { BnbUniswapQuoteBuilder } from "../../src/swap/uniswap-bnb/runtime-factory.js";
import type { UniswapKeylessQuoteRequest } from "../../src/swap/uniswap-v3/builder.js";
import { assertBnbPairMatchesAsset, BNB_UNISWAP_CODE_PINS, BNB_UNISWAP_MECHANISM_PIN, BNB_UNISWAP_PAIRS, BNB_UNISWAP_PROTOCOL_REGISTRY,
  BNB_UNISWAP_QUOTER_V2, BNB_UNISWAP_SWAP_ROUTER_02, BNB_UNISWAP_USDC_WBNB_500, BNB_UNISWAP_USDT_WBNB_500, BNB_UNISWAP_V3_FACTORY, BNB_USDC,
  BNB_USDT, BNB_WBNB, bnbUniswapPair, verifyBnbUniswapCodePins, verifyBnbUniswapMutablePins } from "../../src/swap/uniswap-bnb/pins.js";
import { decodeBnbUniswapRouterCalldataFor, encodeBnbUniswapExactInput } from "../../src/swap/uniswap-bnb/router.js";
import { SavedUniswapQuoteStore, validateUniswapKeylessMaterial } from "../../src/swap/uniswap-v3/material.js";
import { UNISWAP_V3_KEYLESS_MECHANISM_PIN, UNISWAP_WBTC_MECHANISM_PIN, type UniswapV3PairPin } from "../../src/swap/uniswap-v3/pins.js";
import { temporaryState } from "./helpers.js";
import { BNB_AMOUNT_IN, BnbRpc } from "./uniswap-bnb-helpers.js";
import { ACCOUNT, PROFILE } from "./uniswap-keyless-helpers.js";

const NOW = new Date("2026-11-23T12:00:00.000Z"), DEADLINE = Math.floor(NOW.getTime() / 1000) + 900, noPins = async () => [];
const REQUEST: UniswapKeylessQuoteRequest = { profile: PROFILE, account: ACCOUNT, recipient: ACCOUNT, outputToken: BNB_USDT, amountAtomic: BNB_AMOUNT_IN, slippageBps: 50,
  ownerSlippageCapBps: 100, deadline: DEADLINE, maxGasLimit: "300000", maxFeePerGas: "1000000000", maxPriorityFeePerGas: "100000000" };
const ROUTER_ABI = parseAbi([
  "function multicall(uint256 deadline, bytes[] data) payable returns (bytes[] results)",
  "function multicall(bytes[] data) payable returns (bytes[] results)",
  "function exactInputSingle((address tokenIn, address tokenOut, uint24 fee, address recipient, uint256 amountIn, uint256 amountOutMinimum, uint160 sqrtPriceLimitX96) params) payable returns (uint256 amountOut)",
  "function unwrapWETH9(uint256 amountMinimum, address recipient) payable",
]);
/**
 * Encoded by an independent ABI encoder (not viem) for these exact inputs; the same encoder's calldata, with the recipient,
 * floor and deadline of each run, executed on BNB Smart Chain at block 135273443 by eth_call: amountOutMinimum equal to the
 * QuoterV2 output succeeded, quoted + 1 reverted "Too little received", a past deadline reverted "Transaction too old".
 */
const VECTOR = { recipient: "0x1a642f0E3c3aF545E7AcBD38b07251B3990914F1", amountIn: "10000000000000000", minimum: "5500000000000000000",
  deadline: 1_795_440_000,
  data: "0x5ae401dc000000000000000000000000000000000000000000000000000000006b043d8000000000000000000000000000000000000000000000000000000000000000400000000000000000000000000000000000000000000000000000000000000001000000000000000000000000000000000000000000000000000000000000002000000000000000000000000000000000000000000000000000000000000000e404e45aaf000000000000000000000000bb4cdb9cbd36b01bd1cbaebf2de08d9173bc095c00000000000000000000000055d398326f99059ff775485246999027b319795500000000000000000000000000000000000000000000000000000000000001f40000000000000000000000001a642f0e3c3af545e7acbd38b07251b3990914f1000000000000000000000000000000000000000000000000002386f26fc100000000000000000000000000000000000000000000000000004c53ecdc18a60000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000" } as const;
const blockedBy = (reason: string) => (error: any) => error.code === "APN_OPERATION_BLOCKED" && error.details?.reason === reason;

test("BNB pins: own protocol family, chain, registry and route digest, distinct from every Ethereum route", () => {
  const pin = validateSwapMechanismPin(BNB_UNISWAP_MECHANISM_PIN);
  assert.deepEqual([pin.protocolFamily, pin.networkFamily, pin.chain, pin.routerProgramIdentity], ["uniswap_bnb", "evm", "eip155:56", BNB_UNISWAP_SWAP_ROUTER_02]);
  assert.deepEqual(pin.auxiliaryContractProgramIdentities, [BNB_UNISWAP_QUOTER_V2, BNB_UNISWAP_V3_FACTORY, BNB_WBNB, BNB_UNISWAP_USDT_WBNB_500, BNB_UNISWAP_USDC_WBNB_500]);
  assert.deepEqual(BNB_UNISWAP_PROTOCOL_REGISTRY.records.map((row) => row.mechanismDigest), [swapMechanismDigest(pin)]);
  const route = swapRouteOf(pin);
  assert.deepEqual(route, { schemaVersion: "apn.swap-route.v1", protocolFamily: "uniswap_bnb", chain: "eip155:56",
    routerProgramIdentity: BNB_UNISWAP_SWAP_ROUTER_02, auxiliaryContractProgramIdentities: pin.auxiliaryContractProgramIdentities });
  // The owner admits the route: a later APN version of the lane keeps it, the order of the pools does not matter.
  assert.equal(swapRouteDigest({ ...pin, constructorVersion: "1.1.0", validationPolicyVersion: "2.0.0" }), swapRouteDigest(pin));
  assert.equal(swapRouteDigest({ ...route, auxiliaryContractProgramIdentities: [...route.auxiliaryContractProgramIdentities].reverse() }), swapRouteDigest(pin));
  for (const other of [UNISWAP_V3_KEYLESS_MECHANISM_PIN, UNISWAP_WBTC_MECHANISM_PIN]) assert.notEqual(swapRouteDigest(other), swapRouteDigest(pin));
  assert.throws(() => validateSwapMechanismPin({ ...pin, chain: "eip155:1" }), { code: "APN_INVALID_INPUT" });
  assert.throws(() => validateSwapMechanismPin({ ...pin, protocolFamily: "uniswap_ethereum" }), { code: "APN_INVALID_INPUT" });
  const row = (mechanism: unknown) => ({ rails: { direct: false, gasless: false, x402: false, bridge: false, swap: true }, mechanismPins: { swap: mechanism } }) as never;
  assert.equal(assetAdmitsSwapMechanism(row(route), pin), true);
  assert.equal(assetAdmitsSwapMechanism(row({ ...route, auxiliaryContractProgramIdentities: route.auxiliaryContractProgramIdentities.slice(0, 4) }), pin), false);
  assert.equal(GUARDED_SWAP_INVENTORY.uniswap_bnb, "apn swap bnb uniswap inventory");
  for (const code of BNB_UNISWAP_CODE_PINS) { assert.equal(getAddress(code.address), code.address); assert.match(code.codeHash, /^0x[0-9a-f]{64}$/u); }
  assert.deepEqual(BNB_UNISWAP_PAIRS.map((pair) => [pair.outputToken, pair.outputSymbol, pair.outputDecimals, pair.pool, pair.fee, pair.wethIsToken0]),
    [[BNB_USDT, "USDT", 18, BNB_UNISWAP_USDT_WBNB_500, 500, false], [BNB_USDC, "USDC", 18, BNB_UNISWAP_USDC_WBNB_500, 500, false]]);
});

test("each BNB pair agrees with the reviewed Binance-Peg row; another scale, symbol or token refuses", () => {
  for (const pair of BNB_UNISWAP_PAIRS) {
    assert.equal(bnbUniswapPair(pair.outputToken), pair);
    assert.doesNotThrow(() => assertBnbPairMatchesAsset(pair, binancePegPolicyAsset("eip155:56", "token", pair.outputToken)));
  }
  const pair = BNB_UNISWAP_PAIRS[0]!, asset = binancePegPolicyAsset("eip155:56", "token", BNB_USDT)!;
  const cases: readonly (readonly [UniswapV3PairPin, CandidateAsset | undefined])[] = [[{ ...pair, outputDecimals: 6 }, asset],
    [pair, { ...asset, decimals: 6 }], [pair, { ...asset, symbol: "USDC" }], [pair, binancePegPolicyAsset("eip155:56", "token", BNB_USDC)], [pair, undefined]];
  for (const [candidate, row] of cases) {
    assert.throws(() => assertBnbPairMatchesAsset(candidate, row), blockedBy("uniswap_bnb_decimals_mismatch"));
  }
  for (const token of [UNISWAP_USDC, BNB_USDT.toLowerCase(), BNB_WBNB]) assert.throws(() => bnbUniswapPair(token), blockedBy("uniswap_pair_unpinned"));
});

test("SwapRouter02 calldata equals the vector the real router executed, and the strict decoder refuses every substitution", () => {
  const pair = bnbUniswapPair(BNB_USDT), input = { recipient: VECTOR.recipient, inputAmountAtomic: VECTOR.amountIn,
    minimumOutputAtomic: VECTOR.minimum, deadline: VECTOR.deadline, pair };
  const { data, route } = encodeBnbUniswapExactInput(input);
  assert.equal(data, VECTOR.data);
  const expected = { recipient: VECTOR.recipient, inputAmountAtomic: VECTOR.amountIn, minimumOutputAtomic: VECTOR.minimum, deadline: VECTOR.deadline, outputToken: BNB_USDT };
  assert.deepEqual(decodeBnbUniswapRouterCalldataFor(data, expected), route);
  assert.deepEqual([route.recipient, route.inputAmountAtomic, route.minimumOutputAtomic, route.deadline], [VECTOR.recipient, VECTOR.amountIn, VECTOR.minimum, VECTOR.deadline]);
  assert.equal(encodeBnbUniswapExactInput({ ...input, inputAmountAtomic: "1", minimumOutputAtomic: "1" }).route.routeHash, route.routeHash, "route identity, not amounts");
  assert.notEqual(encodeBnbUniswapExactInput({ ...input, pair: bnbUniswapPair(BNB_USDC) }).route.routeHash, route.routeHash);
  // A higher floor than the quote's is the owner's gain; anything else must match exactly.
  assert.doesNotThrow(() => decodeBnbUniswapRouterCalldataFor(data, { ...expected, minimumOutputAtomic: "5499999999999999999" }));
  for (const patch of [{ minimumOutputAtomic: "5500000000000000001" }, { recipient: ACCOUNT }, { inputAmountAtomic: "10000000000000001" },
    { deadline: VECTOR.deadline + 1 }, { outputToken: BNB_USDC }]) {
    assert.throws(() => decodeBnbUniswapRouterCalldataFor(data, { ...expected, ...patch }), { code: "APN_PROVIDER_PROTOCOL" });
  }
  const params = { tokenIn: BNB_WBNB as Hex, tokenOut: BNB_USDT as Hex, fee: 500, recipient: VECTOR.recipient as Hex, amountIn: BigInt(VECTOR.amountIn),
    amountOutMinimum: BigInt(VECTOR.minimum), sqrtPriceLimitX96: 0n };
  const swap = (patch: Partial<typeof params>) => encodeFunctionData({ abi: ROUTER_ABI, functionName: "exactInputSingle", args: [{ ...params, ...patch }] });
  const multicall = (calls: readonly Hex[], deadline = BigInt(VECTOR.deadline)) => encodeFunctionData({ abi: ROUTER_ABI, functionName: "multicall", args: [deadline, calls] });
  assert.equal(multicall([swap({})]), VECTOR.data);
  const unwrap = encodeFunctionData({ abi: ROUTER_ABI, functionName: "unwrapWETH9", args: [1n, VECTOR.recipient as Hex] });
  for (const forged of [multicall([swap({ fee: 100 })]), multicall([swap({ tokenIn: BNB_USDC as Hex })]), multicall([swap({ sqrtPriceLimitX96: 1n })]),
    multicall([swap({ recipient: "0x0000000000000000000000000000000000000002" })]), multicall([swap({}), swap({})]), multicall([swap({}), unwrap]),
    multicall([]), swap({}), encodeFunctionData({ abi: ROUTER_ABI, functionName: "multicall", args: [[swap({})]] }), `${VECTOR.data}00` as Hex]) {
    assert.throws(() => decodeBnbUniswapRouterCalldataFor(forged, expected), { code: "APN_PROVIDER_PROTOCOL" });
  }
  // The encoder builds only the pinned pool's route to an account.
  for (const patch of [{ pair: { ...pair, pool: BNB_UNISWAP_USDC_WBNB_500 } }, { pair: { ...pair, fee: 100 } }]) {
    assert.throws(() => encodeBnbUniswapExactInput({ ...input, ...patch }), { code: "APN_INVALID_INPUT" });
  }
  for (const recipient of ["0x0000000000000000000000000000000000000001", "0x0000000000000000000000000000000000000002", BNB_UNISWAP_SWAP_ROUTER_02, BNB_WBNB]) {
    assert.throws(() => encodeBnbUniswapExactInput({ ...input, recipient }), { code: "APN_INVALID_INPUT" });
  }
  assert.throws(() => encodeBnbUniswapExactInput({ ...input, pair: { ...pair, outputToken: UNISWAP_USDC } }), blockedBy("uniswap_pair_unpinned"));
});

test("a BNB quote reads QuoterV2 with 18-decimal output, binds chain 56 and SwapRouter02, and saves exact material", async (t) => {
  const temporary = await temporaryState(); t.after(temporary.cleanup);
  const rpc = new BnbRpc(), quotes = new SavedUniswapQuoteStore(temporary.root);
  const result: any = await new BnbUniswapQuoteBuilder(rpc.call, quotes, noPins).quote({ ...REQUEST, now: NOW });
  assert.deepEqual([result.price.outputSymbol, result.price.outputDecimals, result.price.pool, result.price.feeTier], ["USDT", 18, BNB_UNISWAP_USDT_WBNB_500, 500]);
  assert.equal(result.price.expectedOutputAtomic, "5559204179861381185");
  assert.equal(result.price.minimumOutputAtomic, "5531408158962074280", "50 bps under the quote, rounded up");
  assert.equal(result.price.spotOutputPerEthAtomic, "556244165378667309413", "one whole BNB at the slot0 spot price");
  assert.equal(result.price.priceImpactBps, 1);
  const data = encodeBnbUniswapExactInput({ recipient: ACCOUNT, inputAmountAtomic: BNB_AMOUNT_IN, minimumOutputAtomic: "5531408158962074280",
    deadline: DEADLINE, pair: bnbUniswapPair(BNB_USDT) }).data;
  assert.deepEqual(result.unsignedTransaction, { from: ACCOUNT, to: BNB_UNISWAP_SWAP_ROUTER_02, data, value: BNB_AMOUNT_IN, gasLimit: "194069",
    chainId: 56, maxFeePerGas: "1000000000", maxPriorityFeePerGas: "100000000" });
  assert.deepEqual(result.gas, { gasLimit: "194069", maxFeePerGas: "1000000000", maxPriorityFeePerGas: "100000000", maximumGasCostWei: "194069000000000" });
  assert.deepEqual([result.quote.sourceAsset, result.quote.destinationAsset], [{ chain: "eip155:56", kind: "native", identifier: null },
    { chain: "eip155:56", kind: "token", identifier: BNB_USDT }]);
  assert.equal(result.quote.simulation.maxHeadDrift, 256);
  assert.equal(result.mechanism.digest, swapMechanismDigest(BNB_UNISWAP_MECHANISM_PIN));
  assert.equal(validateSwapQuote(result.quote).quoteHash, result.quoteHash, "native BNB and Binance-Peg USDT resolve through the reviewed supplement");
  const saved = await quotes.load(result.quoteHash);
  assert.equal(saved?.execution.evidence.chainId, 56); assert.equal(saved?.execution.envelope.to, BNB_UNISWAP_SWAP_ROUTER_02); assert.equal(rpc.sends.length, 0);
  // Prepared material is bound to its own lane: the Ethereum router, chain or route cannot stand in.
  for (const tamper of [{ to: UNISWAP_ROUTER }, { chainId: 1 }]) {
    assert.throws(() => validateUniswapKeylessMaterial({ ...saved!, execution: { ...saved!.execution, envelope: { ...saved!.execution.envelope, ...tamper } } }));
  }
  assert.throws(() => validateUniswapKeylessMaterial({ ...saved!, execution: { ...saved!.execution, evidence: { ...saved!.execution.evidence, chainId: 1 } } }));
  const usdc: any = await new BnbUniswapQuoteBuilder(Object.assign(new BnbRpc(), { pool: BNB_UNISWAP_USDC_WBNB_500 }).call, quotes, noPins)
    .quote({ ...REQUEST, outputToken: BNB_USDC, now: NOW });
  assert.deepEqual([usdc.price.outputSymbol, usdc.price.outputDecimals, usdc.price.pool], ["USDC", 18, BNB_UNISWAP_USDC_WBNB_500]);
});

test("BNB quote refusals: wrong chain, unpinned token, zero gas price, price impact, simulation, balance and sentinel recipient", async (t) => {
  const temporary = await temporaryState(); t.after(temporary.cleanup);
  const quote = (rpc: BnbRpc, patch: Partial<typeof REQUEST> = {}) =>
    new BnbUniswapQuoteBuilder(rpc.call, new SavedUniswapQuoteStore(temporary.root), noPins).quote({ ...REQUEST, ...patch, now: NOW });
  await assert.rejects(quote(Object.assign(new BnbRpc(), { chainId: "0x1" })), { code: "APN_CHAIN_MISMATCH" });
  await assert.rejects(quote(new BnbRpc(), { outputToken: UNISWAP_USDC }), blockedBy("uniswap_pair_unpinned"));
  await assert.rejects(quote(new BnbRpc(), { maxPriorityFeePerGas: "0" }), blockedBy("uniswap_zero_gas_price"));
  await assert.rejects(quote(Object.assign(new BnbRpc(), { quoted: 5_000_000_000_000_000_000n })), blockedBy("uniswap_price_impact"));
  await assert.rejects(quote(Object.assign(new BnbRpc(), { routerReverts: true })), blockedBy("uniswap_simulation"));
  await assert.rejects(quote(Object.assign(new BnbRpc(), { balance: 10_000_000_000_000_000n })), blockedBy("uniswap_native_balance"));
  await assert.rejects(quote(new BnbRpc(), { maxGasLimit: "194068" }), blockedBy("uniswap_gas_cap"));
  await assert.rejects(quote(new BnbRpc(), { recipient: "0x0000000000000000000000000000000000000002" }), { code: "APN_INVALID_INPUT" });
  await assert.rejects(quote(new BnbRpc(), { deadline: Math.floor(NOW.getTime() / 1000) + 1_801 }), { code: "APN_INVALID_INPUT" });
});

test("the BNB pin verifiers refuse other decimals, another factory pool, drifted code and a moved USDC implementation", async () => {
  await assert.rejects(verifyBnbUniswapCodePins(Object.assign(new BnbRpc(), { decimals: 6n }).call, "0x3e8"), blockedBy("uniswap_bnb_decimals_mismatch"));
  await assert.rejects(verifyBnbUniswapCodePins(Object.assign(new BnbRpc(), { pool: BNB_UNISWAP_USDC_WBNB_500 }).call, "0x3e8"), blockedBy("uniswap_code_pin_drift"));
  const drifted = new BnbRpc();
  await assert.rejects(verifyBnbUniswapCodePins(drifted.call, "0x3e8"), blockedBy("uniswap_code_pin_drift"));
  assert.deepEqual(drifted.calls.slice(0, 4), ["eth_call", "eth_call", "eth_call", "eth_call"], "decimals and factory pools are read first");
  await assert.rejects(verifyBnbUniswapMutablePins(Object.assign(new BnbRpc(), { implementation: BNB_UNISWAP_QUOTER_V2 }).call, "0x3e8"),
    blockedBy("uniswap_code_pin_drift"));
  await assert.rejects(verifyBnbUniswapMutablePins(new BnbRpc().call, "0x3e8"), blockedBy("uniswap_code_pin_drift"), "the pinned address with other code");
});
