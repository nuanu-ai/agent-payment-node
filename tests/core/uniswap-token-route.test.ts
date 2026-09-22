import assert from "node:assert/strict";
import test from "node:test";
import { decodeFunctionData, parseAbi } from "viem";
import { UNISWAP_USDC } from "../../src/swap/uniswap-pin.js";
import { ETHEREUM_USDT } from "../../src/swap/uniswap-v3/pins.js";
import { createUniswapTokenRoute, encodeUniswapTokenApproval, UNISWAP_V3_SWAP_ROUTER,
  validateUniswapTokenRoute } from "../../src/swap/uniswap-v3/token-route.js";

const RECIPIENT = "0x2222222222222222222222222222222222222222";
const exact = parseAbi(["function exactInputSingle((address tokenIn,address tokenOut,uint24 fee,address recipient,uint256 deadline,uint256 amountIn,uint256 amountOutMinimum,uint160 sqrtPriceLimitX96) params) payable returns (uint256 amountOut)"]);
const approve = parseAbi(["function approve(address spender,uint256 amount) returns (bool)"]);

test("token route binds the exact bidirectional fee-100 SwapRouter call", () => {
  for (const [inputToken, outputToken] of [[UNISWAP_USDC, ETHEREUM_USDT], [ETHEREUM_USDT, UNISWAP_USDC]] as const) {
    const route = createUniswapTokenRoute({ inputToken, outputToken, recipient: RECIPIENT, amountIn: "1000000", amountOutMinimum: "990000", deadline: 1_900_000_000 });
    assert.equal(route.calldata.slice(0, 10), "0x414bf389"); assert.equal(validateUniswapTokenRoute(route).routeHash, route.routeHash);
    const decoded = decodeFunctionData({ abi: exact, data: route.calldata }).args[0];
    assert.equal(decoded.tokenIn, inputToken); assert.equal(decoded.tokenOut, outputToken); assert.equal(decoded.fee, 100);
    assert.equal(decoded.recipient, RECIPIENT); assert.equal(decoded.amountIn, 1_000_000n); assert.equal(decoded.amountOutMinimum, 990_000n);
    assert.equal(decoded.sqrtPriceLimitX96, 0n);
  }
});

test("approval is exact input to the admitted router and route mutation is rejected", () => {
  const approval = encodeUniswapTokenApproval(UNISWAP_USDC, "1000000");
  const decoded = decodeFunctionData({ abi: approve, data: approval.data });
  assert.equal(approval.to, UNISWAP_USDC); assert.equal(approval.spender, UNISWAP_V3_SWAP_ROUTER);
  assert.deepEqual(decoded.args, [UNISWAP_V3_SWAP_ROUTER, 1_000_000n]);
  const route = createUniswapTokenRoute({ inputToken: UNISWAP_USDC, outputToken: ETHEREUM_USDT, recipient: RECIPIENT,
    amountIn: "1000000", amountOutMinimum: "990000", deadline: 1_900_000_000 });
  assert.throws(() => validateUniswapTokenRoute({ ...route, amountIn: "1000001" }), { code: "APN_INVALID_INPUT" });
  assert.throws(() => createUniswapTokenRoute({ inputToken: UNISWAP_USDC, outputToken: UNISWAP_USDC, recipient: RECIPIENT,
    amountIn: "1000000", amountOutMinimum: "990000", deadline: 1_900_000_000 }), { code: "APN_INVALID_INPUT" });
});
