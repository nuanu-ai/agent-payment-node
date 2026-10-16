import assert from "node:assert/strict";
import test from "node:test";
import { USDC_IMPLEMENTATION_PIN, USDC_IMPLEMENTATION_SLOT, verifyUniswapV3MutablePins, verifyUniswapWbtcMutablePins } from "../../src/swap/uniswap-v3/pins.js";
import { UNISWAP_USDC } from "../../src/swap/uniswap-pin.js";

const word = (address: string) => `0x${"0".repeat(24)}${address.slice(2).toLowerCase()}`;

// SWAP-17: immutable router, quoter, factory, WETH9 and pool code is verified once at quote; the send re-reads only the
// USDC proxy implementation and USDT's deprecation flag.
test("send-time Uniswap verifier reads only the USDC implementation and USDT flag, never immutable code", async () => {
  const reads: string[] = [];
  const call = (implementation: string, code: string) => async (method: string, params: readonly unknown[]) => {
    reads.push(`${method}:${String(params[0] instanceof Object ? (params[0] as { to: string }).to : params[0])}`);
    if (method === "eth_getStorageAt") { assert.deepEqual(params.slice(0, 2), [UNISWAP_USDC, USDC_IMPLEMENTATION_SLOT]); return word(implementation); }
    if (method === "eth_getCode") return code;
    return `0x${"0".repeat(64)}`;
  };
  await assert.rejects(verifyUniswapV3MutablePins(call("0x1111111111111111111111111111111111111111", "0x00"), "0x64"),
    { code: "APN_OPERATION_BLOCKED", details: { reason: "uniswap_code_pin_drift" } });
  assert.deepEqual(reads.splice(0), [`eth_getStorageAt:${UNISWAP_USDC}`]);
  await assert.rejects(verifyUniswapV3MutablePins(call(USDC_IMPLEMENTATION_PIN.address, "0x6080"), "0x64"),
    { code: "APN_OPERATION_BLOCKED", details: { reason: "uniswap_code_pin_drift" } });
  assert.deepEqual(reads.splice(0), [`eth_getStorageAt:${UNISWAP_USDC}`, `eth_getCode:${USDC_IMPLEMENTATION_PIN.address}`]);
  assert.deepEqual(await verifyUniswapWbtcMutablePins(async () => { throw new Error("no read expected"); }, "0x64"), []);
});
