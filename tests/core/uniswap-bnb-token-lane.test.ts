import assert from "node:assert/strict";
import test from "node:test";
import { decodeFunctionData, encodeFunctionData, getAddress, parseAbi, type Hex } from "viem";
import { canonicalJson, domainHash } from "../../src/canonical.js";
import { swapMechanismDigest, validateSwapMechanismPin } from "../../src/swap/pin.js";
import { assetAdmitsSwapMechanism, swapRouteDigest, swapRouteOf } from "../../src/swap/route-admission.js";
import { BNB_UNISWAP_CODE_PINS, BNB_UNISWAP_MECHANISM_PIN, BNB_UNISWAP_QUOTER_V2, BNB_UNISWAP_SWAP_ROUTER_02, BNB_UNISWAP_USDC_WBNB_500,
  BNB_UNISWAP_USDT_WBNB_500, BNB_UNISWAP_V3_FACTORY, BNB_USDC, BNB_USDT, BNB_WBNB } from "../../src/swap/uniswap-bnb/pins.js";
import { BNB_UNISWAP_TOKEN_LANE } from "../../src/swap/uniswap-bnb/token-lane.js";
import { BNB_UNISWAP_TOKEN_CODE_PINS, BNB_UNISWAP_TOKEN_MECHANISM_PIN, BNB_UNISWAP_TOKEN_PAIRS, BNB_UNISWAP_TOKEN_ROUTE_SCHEMA, BNB_UNISWAP_USDT_USDC_100,
  bnbUniswapTokenPair, createBnbUniswapTokenRoute, decodeBnbUniswapTokenCalldata, encodeBnbUniswapTokenApproval, validateBnbUniswapTokenRoute,
  verifyBnbUniswapTokenRoutePins } from "../../src/swap/uniswap-bnb/token-route.js";
import { UNISWAP_USDC } from "../../src/swap/uniswap-pin.js";
import { ETHEREUM_USDT } from "../../src/swap/uniswap-v3/pins.js";
import { UniswapTokenLaneQuoteBuilder, UniswapTokenQuoteBuilder } from "../../src/swap/uniswap-v3/token-builder.js";
import { ETHEREUM_UNISWAP_TOKEN_LANE, tokenLaneOf, tokenLaneOfCommand } from "../../src/swap/uniswap-v3/token-lane.js";
import { SavedUniswapTokenMaterialStore } from "../../src/swap/uniswap-v3/token-material.js";
import { newUniswapTokenOperation } from "../../src/swap/uniswap-v3/token-operation.js";
import { createUniswapTokenRoute, UNISWAP_TOKEN_MECHANISM_PIN, UNISWAP_TOKEN_ROUTE_SCHEMA, UNISWAP_V3_SWAP_ROUTER, UNISWAP_V3_USDC_USDT_100,
  validateUniswapTokenRoute } from "../../src/swap/uniswap-v3/token-route.js";
import type { TokenRpcCall } from "../../src/swap/uniswap-v3/token-rpc.js";
import { temporaryState } from "./helpers.js";
import { BNB_TOKEN_ACCOUNT, BNB_TOKEN_AMOUNT_IN, BNB_TOKEN_QUOTES, BnbTokenChain, bnbTokenQuoteRequest } from "./uniswap-bnb-token-helpers.js";

const ACCOUNT = "0x1a642f0E3c3aF545E7AcBD38b07251B3990914F1", ADDRESS_THIS = "0x0000000000000000000000000000000000000002";
const blocked = (reason: string) => (error: any) => error.code === "APN_OPERATION_BLOCKED" && error.details?.reason === reason;
const ROUTER_ABI = parseAbi([
  "function multicall(uint256 deadline, bytes[] data) payable returns (bytes[] results)",
  "function multicall(bytes[] data) payable returns (bytes[] results)",
  "function exactInputSingle((address tokenIn, address tokenOut, uint24 fee, address recipient, uint256 amountIn, uint256 amountOutMinimum, uint160 sqrtPriceLimitX96) params) payable returns (uint256 amountOut)",
  "function unwrapWETH9(uint256 amountMinimum, address recipient) payable",
  "function sweepToken(address token, uint256 amountMinimum, address recipient) payable",
]);
const ERC20 = parseAbi(["function approve(address spender, uint256 amount) returns (bool)"]);
const QUOTER = parseAbi(["function quoteExactInputSingle((address tokenIn, address tokenOut, uint256 amountIn, uint24 fee, uint160 sqrtPriceLimitX96) params) returns (uint256 amountOut, uint160 sqrtPriceX96After, uint32 initializedTicksCrossed, uint256 gasEstimate)"]);
const swapCall = (tokenIn: string, tokenOut: string, fee: number, recipient: string, minimum: bigint, sqrtPriceLimitX96 = 0n) =>
  encodeFunctionData({ abi: ROUTER_ABI, functionName: "exactInputSingle", args: [{ tokenIn: tokenIn as Hex, tokenOut: tokenOut as Hex, fee,
    recipient: recipient as Hex, amountIn: 10n ** 19n, amountOutMinimum: minimum, sqrtPriceLimitX96 }] });
const unwrapCall = (minimum: bigint, recipient: string) => encodeFunctionData({ abi: ROUTER_ABI, functionName: "unwrapWETH9", args: [minimum, recipient as Hex] });
const multicall = (calls: readonly Hex[], deadline = 1_795_625_000n) => encodeFunctionData({ abi: ROUTER_ABI, functionName: "multicall", args: [deadline, calls] });

/**
 * SwapRouter02 calldata of each direction for ten units in, recipient ACCOUNT, deadline 1795625000 (2026-11-25T16:43:20Z),
 * floors 0.017 BNB and 9.9 tokens, encoded by an independent ABI encoder (not viem). The same bytes ran on BNB Smart Chain
 * by eth_call at block 135308231 (0x61a02005…119a53, 2026-11-24) from ACCOUNT, its token balance and router allowance
 * set by a state override: all four succeeded.
 */
const VECTORS = {
  usdtToBnb: { input: BNB_USDT, output: "native", minimum: "17000000000000000",
    data: "0x5ae401dc000000000000000000000000000000000000000000000000000000006b071028000000000000000000000000000000000000000000000000000000000000004000000000000000000000000000000000000000000000000000000000000000020000000000000000000000000000000000000000000000000000000000000040000000000000000000000000000000000000000000000000000000000000016000000000000000000000000000000000000000000000000000000000000000e404e45aaf00000000000000000000000055d398326f99059ff775485246999027b3197955000000000000000000000000bb4cdb9cbd36b01bd1cbaebf2de08d9173bc095c00000000000000000000000000000000000000000000000000000000000001f400000000000000000000000000000000000000000000000000000000000000020000000000000000000000000000000000000000000000008ac7230489e80000000000000000000000000000000000000000000000000000003c6568f12e8000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000004449404b7c000000000000000000000000000000000000000000000000003c6568f12e80000000000000000000000000001a642f0e3c3af545e7acbd38b07251b3990914f100000000000000000000000000000000000000000000000000000000" },
  usdcToBnb: { input: BNB_USDC, output: "native", minimum: "17000000000000000",
    data: "0x5ae401dc000000000000000000000000000000000000000000000000000000006b071028000000000000000000000000000000000000000000000000000000000000004000000000000000000000000000000000000000000000000000000000000000020000000000000000000000000000000000000000000000000000000000000040000000000000000000000000000000000000000000000000000000000000016000000000000000000000000000000000000000000000000000000000000000e404e45aaf0000000000000000000000008ac76a51cc950d9822d68b83fe1ad97b32cd580d000000000000000000000000bb4cdb9cbd36b01bd1cbaebf2de08d9173bc095c00000000000000000000000000000000000000000000000000000000000001f400000000000000000000000000000000000000000000000000000000000000020000000000000000000000000000000000000000000000008ac7230489e80000000000000000000000000000000000000000000000000000003c6568f12e8000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000004449404b7c000000000000000000000000000000000000000000000000003c6568f12e80000000000000000000000000001a642f0e3c3af545e7acbd38b07251b3990914f100000000000000000000000000000000000000000000000000000000" },
  usdtToUsdc: { input: BNB_USDT, output: BNB_USDC, minimum: "9900000000000000000",
    data: "0x5ae401dc000000000000000000000000000000000000000000000000000000006b07102800000000000000000000000000000000000000000000000000000000000000400000000000000000000000000000000000000000000000000000000000000001000000000000000000000000000000000000000000000000000000000000002000000000000000000000000000000000000000000000000000000000000000e404e45aaf00000000000000000000000055d398326f99059ff775485246999027b31979550000000000000000000000008ac76a51cc950d9822d68b83fe1ad97b32cd580d00000000000000000000000000000000000000000000000000000000000000640000000000000000000000001a642f0e3c3af545e7acbd38b07251b3990914f10000000000000000000000000000000000000000000000008ac7230489e800000000000000000000000000000000000000000000000000008963dd8c2c5e0000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000" },
  usdcToUsdt: { input: BNB_USDC, output: BNB_USDT, minimum: "9900000000000000000",
    data: "0x5ae401dc000000000000000000000000000000000000000000000000000000006b07102800000000000000000000000000000000000000000000000000000000000000400000000000000000000000000000000000000000000000000000000000000001000000000000000000000000000000000000000000000000000000000000002000000000000000000000000000000000000000000000000000000000000000e404e45aaf0000000000000000000000008ac76a51cc950d9822d68b83fe1ad97b32cd580d00000000000000000000000055d398326f99059ff775485246999027b319795500000000000000000000000000000000000000000000000000000000000000640000000000000000000000001a642f0e3c3af545e7acbd38b07251b3990914f10000000000000000000000000000000000000000000000008ac7230489e800000000000000000000000000000000000000000000000000008963dd8c2c5e0000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000" },
} as const;
const routeOf = (vector: (typeof VECTORS)[keyof typeof VECTORS]) => createBnbUniswapTokenRoute({ inputToken: vector.input, outputToken: vector.output,
  recipient: ACCOUNT, amountIn: BNB_TOKEN_AMOUNT_IN, amountOutMinimum: vector.minimum, deadline: 1_795_625_000 });

test("BNB token pins: own mechanism pin and route over SwapRouter02, the factory, WBNB and three pools", () => {
  const pin = validateSwapMechanismPin(BNB_UNISWAP_TOKEN_MECHANISM_PIN);
  assert.deepEqual([pin.protocolFamily, pin.networkFamily, pin.chain, pin.routerProgramIdentity, pin.transactionSchemaVersion],
    ["uniswap_bnb", "evm", "eip155:56", BNB_UNISWAP_SWAP_ROUTER_02, BNB_UNISWAP_TOKEN_ROUTE_SCHEMA]);
  assert.deepEqual(pin.auxiliaryContractProgramIdentities,
    [BNB_UNISWAP_V3_FACTORY, BNB_WBNB, BNB_UNISWAP_USDT_WBNB_500, BNB_UNISWAP_USDC_WBNB_500, BNB_UNISWAP_USDT_USDC_100]);
  // The owner admits token input separately: neither the native BNB route nor the Ethereum token route admits it.
  for (const other of [BNB_UNISWAP_MECHANISM_PIN, UNISWAP_TOKEN_MECHANISM_PIN]) assert.notEqual(swapRouteDigest(other), swapRouteDigest(pin));
  const row = (mechanism: unknown) => ({ rails: { direct: false, gasless: false, x402: false, bridge: false, swap: true }, mechanismPins: { swap: mechanism } }) as never;
  assert.equal(assetAdmitsSwapMechanism(row(swapRouteOf(pin)), pin), true);
  assert.equal(assetAdmitsSwapMechanism(row(swapRouteOf(BNB_UNISWAP_MECHANISM_PIN)), pin), false);
  // Every contract a token swap touches is pinned to its runtime code hash: the native lane's six plus the USDT/USDC pool.
  const native = (role: string) => BNB_UNISWAP_CODE_PINS.find((row) => row.role === role);
  assert.deepEqual(BNB_UNISWAP_TOKEN_CODE_PINS.slice(0, 6), ["swap_router_02", "wbnb", "usdt", "usdc_proxy", "pool_usdt_wbnb_500", "pool_usdc_wbnb_500"].map(native));
  assert.deepEqual(BNB_UNISWAP_TOKEN_CODE_PINS[6], { role: "pool_usdt_usdc_100", address: "0x2C3c320D49019D4f9A92352e947c7e5AcFE47D68",
    codeHash: "0xb64a9a26b8d4480df318b2488a78fb0dc3aab462bb97c7aff51ddfd6479c03c1" });
  for (const code of BNB_UNISWAP_TOKEN_CODE_PINS) { assert.equal(getAddress(code.address), code.address); assert.match(code.codeHash, /^0x[0-9a-f]{64}$/u); }
  assert.deepEqual(BNB_UNISWAP_TOKEN_PAIRS.map((row) => [row.inputSymbol, row.outputSymbol, row.output, row.pool, row.fee]), [
    ["USDT", "BNB", "native", BNB_UNISWAP_USDT_WBNB_500, 500], ["USDC", "BNB", "native", BNB_UNISWAP_USDC_WBNB_500, 500],
    ["USDT", "USDC", "token", BNB_UNISWAP_USDT_USDC_100, 100], ["USDC", "USDT", "token", BNB_UNISWAP_USDT_USDC_100, 100]]);
  assert.equal(bnbUniswapTokenPair(BNB_USDT, "native").outputToken, BNB_WBNB);
  for (const [input, output] of [[BNB_USDT, BNB_USDT], [BNB_WBNB, BNB_USDT], [BNB_USDT, BNB_WBNB], [UNISWAP_USDC, "native"]] as const) {
    assert.throws(() => bnbUniswapTokenPair(input, output), blocked("uniswap_pair_unpinned"));
  }
});

test("BNB token routes are exactly the calldata an independent encoder ran on chain 56", () => {
  for (const [name, vector] of Object.entries(VECTORS)) {
    const route = routeOf(vector), { routeHash, ...body } = route;
    assert.equal(route.calldata, vector.data, name);
    assert.equal(routeHash, domainHash(BNB_UNISWAP_TOKEN_ROUTE_SCHEMA, canonicalJson(body)));
    assert.deepEqual(decodeBnbUniswapTokenCalldata(route.calldata), body);
    assert.deepEqual(validateUniswapTokenRoute(route), route, "the shared validator dispatches on the BNB schema");
    assert.equal(tokenLaneOf(route), BNB_UNISWAP_TOKEN_LANE);
    assert.deepEqual([route.router, route.recipient, route.amountIn, route.amountOutMinimum, route.deadline],
      [BNB_UNISWAP_SWAP_ROUTER_02, ACCOUNT, BNB_TOKEN_AMOUNT_IN, vector.minimum, 1_795_625_000]);
    const outer = decodeFunctionData({ abi: ROUTER_ABI, data: route.calldata });
    assert.equal(outer.functionName, "multicall");
    const calls = outer.args.at(-1) as readonly Hex[], swap = decodeFunctionData({ abi: ROUTER_ABI, data: calls[0]! });
    assert.equal(swap.functionName, "exactInputSingle");
    const params = (swap.args as unknown as readonly [{ readonly tokenOut: string; readonly recipient: string }])[0];
    if (vector.output === "native") {
      // The pool pays WBNB to the router (ADDRESS_THIS); the router unwraps all of it to the recipient at the same floor.
      assert.deepEqual([route.output, route.outputToken, route.fee, getAddress(params.tokenOut), getAddress(params.recipient)], ["native", BNB_WBNB, 500, BNB_WBNB, ADDRESS_THIS]);
      const unwrap = decodeFunctionData({ abi: ROUTER_ABI, data: calls[1]! });
      assert.equal(unwrap.functionName, "unwrapWETH9");
      assert.deepEqual(unwrap.args, [BigInt(vector.minimum), ACCOUNT]);
    } else {
      assert.equal(calls.length, 1);
      assert.deepEqual([route.output, route.outputToken, route.pool, route.fee, getAddress(params.recipient)], ["token", vector.output, BNB_UNISWAP_USDT_USDC_100, 100, ACCOUNT]);
    }
  }
});

test("the strict SwapRouter02 decoder refuses every other shape, and a stored route bound to other calldata", () => {
  const invalid = { code: "APN_INVALID_INPUT" }, floor = 17_000_000_000_000_000n;
  for (const data of [
    multicall([swapCall(BNB_USDT, BNB_WBNB, 500, ADDRESS_THIS, floor), unwrapCall(floor, ACCOUNT),
      encodeFunctionData({ abi: ROUTER_ABI, functionName: "sweepToken", args: [BNB_USDT, 0n, ACCOUNT] })]),
    multicall([swapCall(BNB_USDT, BNB_WBNB, 500, ACCOUNT, floor), unwrapCall(floor, ACCOUNT)]),
    multicall([swapCall(BNB_USDT, BNB_WBNB, 500, ADDRESS_THIS, floor), unwrapCall(floor - 1n, ACCOUNT)]),
    multicall([swapCall(BNB_USDT, BNB_WBNB, 500, ADDRESS_THIS, floor)]),
    multicall([swapCall(BNB_USDT, BNB_WBNB, 100, ADDRESS_THIS, floor), unwrapCall(floor, ACCOUNT)]),
    multicall([swapCall(BNB_USDT, BNB_USDC, 500, ACCOUNT, floor)]),
    multicall([swapCall(BNB_USDT, BNB_USDC, 100, ACCOUNT, floor, 1n)]),
    multicall([swapCall(BNB_USDT, BNB_USDC, 100, ADDRESS_THIS, floor)]),
    multicall([swapCall(BNB_WBNB, BNB_USDT, 500, ACCOUNT, floor)]),
    multicall([swapCall(BNB_USDT, BNB_USDC, 100, ACCOUNT, floor), swapCall(BNB_USDT, BNB_USDC, 100, ACCOUNT, floor)]),
    multicall([swapCall(BNB_USDT, BNB_WBNB, 500, ADDRESS_THIS, floor), unwrapCall(floor, BNB_UNISWAP_SWAP_ROUTER_02)]),
    multicall([swapCall(BNB_USDT, BNB_USDC, 100, ACCOUNT, floor)], 0n),
    encodeFunctionData({ abi: ROUTER_ABI, functionName: "multicall", args: [[swapCall(BNB_USDT, BNB_USDC, 100, ACCOUNT, floor)]] }),
    swapCall(BNB_USDT, BNB_USDC, 100, ACCOUNT, floor),
    `${VECTORS.usdtToUsdc.data}00` as Hex,
  ]) assert.throws(() => decodeBnbUniswapTokenCalldata(data), invalid);
  const route = routeOf(VECTORS.usdtToBnb);
  for (const tampered of [{ ...route, amountOutMinimum: "1" }, { ...route, output: "token" }, { ...route, outputToken: BNB_USDC },
    { ...route, routeHash: "0".repeat(64) }, { ...route, extra: true }]) assert.throws(() => validateBnbUniswapTokenRoute(tampered), invalid);
  for (const recipient of [ADDRESS_THIS, "0x0000000000000000000000000000000000000001", BNB_UNISWAP_SWAP_ROUTER_02, BNB_WBNB, ACCOUNT.toLowerCase()]) {
    assert.throws(() => createBnbUniswapTokenRoute({ inputToken: BNB_USDT, outputToken: "native", recipient, amountIn: BNB_TOKEN_AMOUNT_IN,
      amountOutMinimum: "1", deadline: 1_795_625_000 }), invalid);
  }
  for (const [inputToken, outputToken] of [[UNISWAP_USDC, "native"], [BNB_USDT.toLowerCase(), BNB_USDC], [BNB_USDT, ETHEREUM_USDT]]) {
    assert.throws(() => createBnbUniswapTokenRoute({ inputToken, outputToken, recipient: ACCOUNT, amountIn: BNB_TOKEN_AMOUNT_IN, amountOutMinimum: "1",
      deadline: 1_795_625_000 }), invalid);
  }
  assert.throws(() => createBnbUniswapTokenRoute({ inputToken: BNB_USDT, outputToken: BNB_USDC, recipient: ACCOUNT, amountIn: BNB_TOKEN_AMOUNT_IN,
    amountOutMinimum: "0", deadline: 1_795_625_000 }), invalid);
  // A BNB schema stamped on an Ethereum route, and an Ethereum route's schema on a BNB one, are refused by the shared validator.
  const ethereum = createUniswapTokenRoute({ inputToken: UNISWAP_USDC, outputToken: ETHEREUM_USDT, recipient: ACCOUNT, amountIn: "1000000",
    amountOutMinimum: "990000", deadline: 1_900_000_000 });
  assert.throws(() => validateUniswapTokenRoute({ ...ethereum, schemaVersion: BNB_UNISWAP_TOKEN_ROUTE_SCHEMA }), invalid);
  assert.throws(() => validateUniswapTokenRoute({ ...route, schemaVersion: UNISWAP_TOKEN_ROUTE_SCHEMA }), invalid);
});

test("the BNB approval is exact, to SwapRouter02 only, and zero for the cleanup", () => {
  for (const [token, amount] of [[BNB_USDT, BNB_TOKEN_AMOUNT_IN], [BNB_USDC, "0"]] as const) {
    const approval = encodeBnbUniswapTokenApproval(token, amount);
    assert.deepEqual([approval.to, approval.spender, approval.amount], [token, BNB_UNISWAP_SWAP_ROUTER_02, amount]);
    assert.deepEqual(decodeFunctionData({ abi: ERC20, data: approval.data }).args, [BNB_UNISWAP_SWAP_ROUTER_02, BigInt(amount)]);
  }
  for (const token of [UNISWAP_USDC, BNB_WBNB, BNB_USDT.toLowerCase()]) assert.throws(() => encodeBnbUniswapTokenApproval(token, "1"), { code: "APN_INVALID_INPUT" });
  assert.equal(BNB_UNISWAP_TOKEN_LANE.encodeApproval, encodeBnbUniswapTokenApproval);
});

test("the Ethereum token lane keeps its route, names, nonce space, inventory and screens byte for byte", () => {
  const lane = ETHEREUM_UNISWAP_TOKEN_LANE;
  assert.deepEqual([lane.chain, lane.chainId, lane.chainLabel, lane.commandPrefix, lane.requestFamily, lane.archiveEnvironment, lane.refusesZeroGasPrice],
    ["eip155:1", 1, "Ethereum chain 1", "apn swap ethereum uniswap-token", "swap.uniswap-token", "APN_ETHEREUM_ARCHIVE_RPC_URL", false]);
  assert.deepEqual(lane.nonceSpace, { directory: "uniswap-token-nonces", accountDomain: "apn.uniswap-token-nonce-account.v1" });
  assert.equal(lane.mechanismPin, UNISWAP_TOKEN_MECHANISM_PIN);
  assert.deepEqual(lane.inventory(), { chain: "eip155:1", router: UNISWAP_V3_SWAP_ROUTER, pair: "USDC/USDT", fee: 100, mechanism: UNISWAP_TOKEN_MECHANISM_PIN,
    route: swapRouteOf(UNISWAP_TOKEN_MECHANISM_PIN), routeDigest: swapRouteDigest(UNISWAP_TOKEN_MECHANISM_PIN), approval: "exact_input_only", transactionValue: "0" });
  const route = createUniswapTokenRoute({ inputToken: UNISWAP_USDC, outputToken: ETHEREUM_USDT, recipient: ACCOUNT, amountIn: "1000000",
    amountOutMinimum: "990000", deadline: 1_900_000_000 });
  assert.deepEqual([route.schemaVersion, route.router, route.pool, route.fee, route.calldata.slice(0, 10)],
    [UNISWAP_TOKEN_ROUTE_SCHEMA, UNISWAP_V3_SWAP_ROUTER, UNISWAP_V3_USDC_USDT_100, 100, "0x414bf389"]);
  assert.equal(tokenLaneOf(validateUniswapTokenRoute(route)), lane);
  assert.equal(tokenLaneOfCommand("swap.uniswap-token.quote"), lane);
  assert.equal(tokenLaneOfCommand("swap.uniswap-bnb-token.status"), BNB_UNISWAP_TOKEN_LANE);
  const gas = { gasLimit: "100000", maxFeePerGas: "2", maxPriorityFeePerGas: "1" };
  const op = newUniswapTokenOperation({ operationId: "a".repeat(64), profile: "token-swap", account: ACCOUNT, route, approvalCapAtomic: "1000000",
    allowanceAtPrepare: "0", approvalGas: gas, swapGas: gas, cleanupGas: gas, maximumNativeDebitWei: "600000", policyDigest: "b".repeat(64),
    mechanismDigest: swapMechanismDigest(UNISWAP_TOKEN_MECHANISM_PIN), now: new Date("2026-11-24T00:00:00.000Z") });
  assert.deepEqual(lane.screen(op, false), ["Agent Payment Node Uniswap V3 token swap approval", "Profile: token-swap", `Operation: ${"a".repeat(64)}`,
    `Signer: ${ACCOUNT}`, "Exact input: 1000000 atomic at 0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48",
    "Minimum output: 990000 atomic at 0xdAC17F958D2ee523a2206206994597C13D831ec7", `Recipient: ${ACCOUNT}`,
    "Router: 0xE592427A0AEce92De3Edee1F18E0157C05861564", "Exact approval cap: 1000000", "Aggregate native debit cap: 600000 wei",
    "Deadline: 2030-03-17T17:46:40.000Z", "Approval, swap, and any explicit cleanup are independently signed and broadcast at most once."]);
  assert.deepEqual(lane.screen(op, true), ["Agent Payment Node Uniswap token allowance cleanup", "Profile: token-swap", `Operation: ${"a".repeat(64)}`,
    "Token/spender: 0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48 / 0xE592427A0AEce92De3Edee1F18E0157C05861564", "Replacement allowance: 0",
    "Reason: residual_allowance", "Native debit so far: 0 wei; aggregate cap with this cleanup: 600000 wei"]);
  assert.deepEqual(lane.outputAsset(route), { kind: "token", identifier: ETHEREUM_USDT });
});

test("the BNB lane names its own chain, commands, nonce space and screens", () => {
  const lane = BNB_UNISWAP_TOKEN_LANE;
  assert.deepEqual([lane.chain, lane.chainId, lane.chainLabel, lane.nativeSymbol, lane.commandPrefix, lane.requestFamily, lane.archiveEnvironment,
    lane.quoter, lane.refusesZeroGasPrice], ["eip155:56", 56, "BNB Smart Chain chain 56", "BNB", "apn swap bnb uniswap-token", "swap.uniswap-bnb-token",
    "APN_BNB_ARCHIVE_RPC_URL", BNB_UNISWAP_QUOTER_V2, true]);
  assert.deepEqual(lane.nonceSpace, { directory: "uniswap-bnb-token-nonces", accountDomain: "apn.uniswap-bnb-token-nonce-account.v1" });
  assert.notEqual(lane.nonceSpace.directory, ETHEREUM_UNISWAP_TOKEN_LANE.nonceSpace.directory);
  const inventory = lane.inventory() as any;
  assert.deepEqual([inventory.chain, inventory.router, inventory.decimals, inventory.routeDigest, inventory.pairs.length],
    ["eip155:56", BNB_UNISWAP_SWAP_ROUTER_02, 18, swapRouteDigest(BNB_UNISWAP_TOKEN_MECHANISM_PIN), 4]);
  assert.deepEqual(inventory.pairs.map((row: any) => `${row.inputSymbol}>${row.outputSymbol}:${row.output}`),
    [`USDT>BNB:native`, `USDC>BNB:native`, `USDT>USDC:${BNB_USDC}`, `USDC>USDT:${BNB_USDT}`]);
  const native = routeOf(VECTORS.usdcToBnb), token = routeOf(VECTORS.usdtToUsdc);
  assert.deepEqual(lane.outputAsset(native), { kind: "native", identifier: null });
  assert.deepEqual(lane.outputAsset(token), { kind: "token", identifier: BNB_USDC });
  const gas = { gasLimit: "100000", maxFeePerGas: "2", maxPriorityFeePerGas: "1" };
  const op = newUniswapTokenOperation({ operationId: "c".repeat(64), profile: "bnb-token-swap", account: ACCOUNT, route: native, approvalCapAtomic: BNB_TOKEN_AMOUNT_IN,
    allowanceAtPrepare: "0", approvalGas: gas, swapGas: gas, cleanupGas: gas, maximumNativeDebitWei: "600000", policyDigest: "b".repeat(64),
    mechanismDigest: swapMechanismDigest(BNB_UNISWAP_TOKEN_MECHANISM_PIN), now: new Date("2026-11-24T00:00:00.000Z") });
  const screen = lane.screen(op, false);
  for (const line of ["Agent Payment Node Uniswap V3 token swap approval (BNB Smart Chain)", "Network: BNB Smart Chain (eip155:56)",
    `Exact input: ${BNB_TOKEN_AMOUNT_IN} atomic (18 decimals) of USDC ${BNB_USDC}`,
    `Minimum output: 17000000000000000 wei of native BNB (the router unwraps WBNB ${BNB_WBNB})`,
    `Router: ${BNB_UNISWAP_SWAP_ROUTER_02} (SwapRouter02); pool ${BNB_UNISWAP_USDC_WBNB_500}, fee 500`, "Aggregate native debit cap: 600000 wei of BNB",
    "Deadline: 2026-11-25T16:43:20.000Z"]) assert.ok(screen.includes(line), line);
  assert.ok(lane.screen(op, true).includes(`Token/spender: USDC ${BNB_USDC} / ${BNB_UNISWAP_SWAP_ROUTER_02}`));
});

test("the BNB pin check refuses another chain and drifted code at its first batch", async () => {
  const batches: (readonly string[])[] = [];
  const fake = (chainId: string) => { const call = (async () => { throw new Error("scalar reads are not used"); }) as unknown as TokenRpcCall;
    Object.defineProperty(call, "batch", { value: async (_route: string, items: readonly { method: string; params: readonly unknown[] }[]) => {
      batches.push(items.map((item) => `${item.method}:${String(item.params[0] ?? "")}`));
      return items.map((item) => item.method === "eth_chainId" ? chainId : "0x6000"); } }); return call; };
  await assert.rejects(verifyBnbUniswapTokenRoutePins(fake("0x1"), "0x64"), { code: "APN_CHAIN_MISMATCH" });
  batches.length = 0;
  await assert.rejects(verifyBnbUniswapTokenRoutePins(fake("0x38"), "0x64"), blocked("uniswap_code_pin_drift"));
  assert.deepEqual(batches, [["eth_chainId:", `eth_getCode:${BNB_UNISWAP_SWAP_ROUTER_02}`, `eth_getCode:${BNB_WBNB}`]]);
  assert.equal(BNB_UNISWAP_TOKEN_LANE.verifyPins, verifyBnbUniswapTokenRoutePins);
});

test("a BNB token quote refuses before any read: zero priority fee, another lane's command, an unpinned direction", async (t) => {
  const temporary = await temporaryState(); t.after(temporary.cleanup);
  const now = new Date(), chain = new BnbTokenChain(BNB_USDT, BNB_WBNB, BNB_TOKEN_QUOTES.usdtToBnb), store = new SavedUniswapTokenMaterialStore(temporary.root);
  const builder = new UniswapTokenLaneQuoteBuilder(BNB_UNISWAP_TOKEN_LANE, chain.call(), store, async () => "a".repeat(64), () => now, async () => undefined);
  const request = bnbTokenQuoteRequest(now, BNB_USDT, "native", "17000000000000000");
  await assert.rejects(builder.quote({ ...request, maxPriorityFeePerGas: "0" }), blocked("uniswap_zero_gas_price"));
  await assert.rejects(builder.quote({ ...request, command: "swap.uniswap-token.quote" }), { code: "APN_INVALID_INPUT" });
  await assert.rejects(builder.quote({ ...request, outputToken: BNB_USDT }), blocked("uniswap_pair_unpinned"));
  await assert.rejects(builder.quote({ ...request, recipient: BNB_UNISWAP_SWAP_ROUTER_02 }), { code: "APN_INVALID_INPUT" });
  await assert.rejects(builder.quote({ ...request, approvalCapAtomic: "1" }), { code: "APN_INVALID_INPUT" });
  assert.deepEqual(chain.chainCalls, []);
  // The Ethereum builder never takes `native` as an output.
  const ethereum = new UniswapTokenQuoteBuilder(chain.call(), store, async () => "a".repeat(64), () => now, async () => undefined);
  await assert.rejects(ethereum.quote({ ...request, command: "swap.uniswap-token.quote", sourceToken: UNISWAP_USDC }), { code: "APN_INVALID_INPUT" });
  assert.deepEqual(chain.chainCalls, []);
});

test("a BNB token quote reads the route's own pool on chain 56 and saves a BNB-pinned material", async (t) => {
  const temporary = await temporaryState(); t.after(temporary.cleanup);
  const now = new Date(), store = new SavedUniswapTokenMaterialStore(temporary.root);
  for (const [input, output, poolOutput, fee, quoted, minimum] of [
    [BNB_USDT, "native", BNB_WBNB, 500, BNB_TOKEN_QUOTES.usdtToBnb, "17000000000000000"],
    [BNB_USDC, "native", BNB_WBNB, 500, BNB_TOKEN_QUOTES.usdcToBnb, "17000000000000000"],
    [BNB_USDT, BNB_USDC, BNB_USDC, 100, BNB_TOKEN_QUOTES.usdtToUsdc, "9900000000000000000"],
    [BNB_USDC, BNB_USDT, BNB_USDT, 100, BNB_TOKEN_QUOTES.usdcToUsdt, "9900000000000000000"],
  ] as const) {
    const chain = new BnbTokenChain(input, poolOutput, quoted);
    const builder = new UniswapTokenLaneQuoteBuilder(BNB_UNISWAP_TOKEN_LANE, chain.call(), store, async () => "a".repeat(64), () => now, async () => undefined);
    const quote = await builder.quote(bnbTokenQuoteRequest(now, input, output, minimum)) as any;
    assert.deepEqual([quote.route.inputToken, quote.route.outputToken, quote.route.fee, quote.route.router, quote.route.recipient],
      [input, poolOutput, fee, BNB_UNISWAP_SWAP_ROUTER_02, BNB_TOKEN_ACCOUNT]);
    assert.deepEqual([quote.expectedOutputAtomic, quote.approval.spender, quote.approval.capAtomic, quote.mechanismDigest, quote.simulation.swap],
      [quoted.toString(), BNB_UNISWAP_SWAP_ROUTER_02, BNB_TOKEN_AMOUNT_IN, swapMechanismDigest(BNB_UNISWAP_TOKEN_MECHANISM_PIN), "staged_after_exact_approval"]);
    const params = decodeFunctionData({ abi: QUOTER, data: chain.quoterCalls[0]! }).args[0];
    assert.deepEqual([getAddress(params.tokenIn), getAddress(params.tokenOut), params.amountIn, params.fee, params.sqrtPriceLimitX96],
      [input, poolOutput, BigInt(BNB_TOKEN_AMOUNT_IN), fee, 0n]);
    assert.equal((await store.load(quote.quoteHash))?.route.routeHash, quote.route.routeHash);
  }
  const below = new BnbTokenChain(BNB_USDT, BNB_WBNB, 16_999_999_999_999_999n);
  await assert.rejects(new UniswapTokenLaneQuoteBuilder(BNB_UNISWAP_TOKEN_LANE, below.call(), store, async () => "a".repeat(64), () => now, async () => undefined)
    .quote(bnbTokenQuoteRequest(now, BNB_USDT, "native", "17000000000000000")), blocked("uniswap_output_floor"));
  const drifted = new BnbTokenChain(BNB_USDT, BNB_WBNB, BNB_TOKEN_QUOTES.usdtToBnb); drifted.allowance = 1n;
  await assert.rejects(new UniswapTokenLaneQuoteBuilder(BNB_UNISWAP_TOKEN_LANE, drifted.call(), store, async () => "a".repeat(64), () => now, async () => undefined)
    .quote(bnbTokenQuoteRequest(now, BNB_USDT, "native", "17000000000000000")), blocked("uniswap_allowance_mismatch"));
  const ethereumRpc = new BnbTokenChain(BNB_USDT, BNB_WBNB, BNB_TOKEN_QUOTES.usdtToBnb); ethereumRpc.chainId = "0x1";
  await assert.rejects(new UniswapTokenLaneQuoteBuilder(BNB_UNISWAP_TOKEN_LANE, ethereumRpc.call(), store, async () => "a".repeat(64), () => now, async () => undefined)
    .quote(bnbTokenQuoteRequest(now, BNB_USDT, "native", "17000000000000000")), { code: "APN_CHAIN_MISMATCH",
    message: "Uniswap token route requires BNB Smart Chain chain 56." });
});
